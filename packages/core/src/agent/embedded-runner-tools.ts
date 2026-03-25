import type { ToolDefinition } from '../bridge/tool-injector.js';
import type { RuntimeEvent } from './types.js';
import type { ToolSafetyGuard } from './tool-safety.js';
import { normalizeToolSchema } from './schema-adapter.js';
import { createAdaptiveReadTool } from './adaptive-read.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('embedded-runner-tools');

// ─── Types ───

type EventCallback = (event: RuntimeEvent) => void;

/** 审计日志条目 */
export interface AuditLogEntry {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  status: 'success' | 'error' | 'denied';
  durationMs: number;
}

/** PI AgentToolResult 格式 */
export interface PIToolResult {
  content: [{ type: string; text: string }];
  details?: unknown;
}

/** wrapToolsForPI 所需的依赖项 */
export interface ToolWrappingDeps {
  /** 权限拦截函数 — 返回 null 表示允许，返回字符串表示拒绝原因 */
  permissionFn?: (toolName: string, args: Record<string, unknown>) => Promise<string | null>;
  /** 工具安全守卫实例（循环检测 + 结果截断） */
  toolSafety: ToolSafetyGuard;
  /** 事件回调 */
  onEvent: EventCallback;
  /** 审计日志回调 */
  auditFn?: (entry: AuditLogEntry) => void;
  /** Provider ID（用于 schema 适配） */
  provider: string;
  /** Context window 大小（用于 adaptive read） */
  contextWindow?: number;
  /** EvoClaw 自定义工具 */
  evoClawTools?: ToolDefinition[];
}

// ─── createEnhancedExecTool ───

/**
 * 增强版 exec 工具（替代 PI 内置 bash，参考 OpenClaw exec-tool）
 * 增强点: 超时控制、工作目录、输出限制、退出码格式化
 */
export function createEnhancedExecTool() {
  const { execSync } = require('node:child_process') as typeof import('node:child_process');
  const DEFAULT_TIMEOUT_SEC = 120;
  const MAX_OUTPUT_CHARS = 200_000;

  return {
    name: 'bash',  // 保持名称为 bash，模型更熟悉
    description: `执行 shell 命令。输出截断到 ${MAX_OUTPUT_CHARS / 1000}K 字符。大输出请重定向到文件再用 read 查看。长时间任务用 exec_background 工具。`,
    parameters: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: '要执行的 shell 命令' },
        workdir: { type: 'string', description: '工作目录（默认当前目录）' },
        timeout: { type: 'number', description: `超时秒数（默认 ${DEFAULT_TIMEOUT_SEC}）` },
      },
      required: ['command'],
    },
    execute: async (args: Record<string, unknown>): Promise<string> => {
      const command = args.command as string;
      const workdir = (args.workdir as string) || process.cwd();
      const timeoutSec = (args.timeout as number) || DEFAULT_TIMEOUT_SEC;

      if (!command) return '错误：缺少 command 参数';

      try {
        const output = execSync(command, {
          cwd: workdir,
          timeout: timeoutSec * 1000,
          maxBuffer: 10 * 1024 * 1024,  // 10MB buffer
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env, EVOCLAW_SHELL: 'exec' },
        });

        const result = (output ?? '').toString();

        if (result.length > MAX_OUTPUT_CHARS) {
          // 头尾保留截断
          const head = result.slice(0, Math.floor(MAX_OUTPUT_CHARS * 0.7));
          const tail = result.slice(-Math.floor(MAX_OUTPUT_CHARS * 0.3));
          return `${head}\n\n... [省略 ${result.length - MAX_OUTPUT_CHARS} 字符] ...\n\n${tail}`;
        }

        return result || '(无输出)';
      } catch (err: unknown) {
        const e = err as { status?: number; stdout?: string; stderr?: string; message?: string; killed?: boolean };

        if (e.killed) {
          return `命令超时（${timeoutSec} 秒），已终止。如需更长时间，请使用 exec_background 工具后台执行。`;
        }

        const stdout = e.stdout?.toString() ?? '';
        const stderr = e.stderr?.toString() ?? '';
        const combined = [stdout, stderr].filter(Boolean).join('\n');
        const exitCode = e.status ?? -1;

        // 输出截断
        const truncated = combined.length > MAX_OUTPUT_CHARS
          ? combined.slice(0, MAX_OUTPUT_CHARS) + `\n... [输出已截断]`
          : combined;

        return `${truncated || e.message || '命令执行失败'}\n\n(退出码 ${exitCode})`;
      }
    },
  };
}

// ─── Tool XML Filter（状态机） ───

/**
 * 创建 Tool XML 过滤器（状态机）。
 * PI 框架会将模型输出的 tool_call/tool_result XML 标签混入 text_delta，
 * 这些在 CLI 模式下用于显示工具调用过程，但 GUI 中不应展示给用户
 * （工具调用信息已通过 tool_execution_start/end 事件单独处理）
 *
 * 返回两个函数：
 * - filterToolXml(delta) — 处理增量文本，自动 emit 过滤后的 text_delta
 * - flushTextBuffer() — 强制 flush 缓冲区（在 message_end 时调用）
 */
export function createToolXmlFilter(onEvent: EventCallback): {
  filterToolXml: (delta: string) => void;
  flushTextBuffer: () => void;
} {
  const TOOL_XML_TAGS = ['tool_call', 'tool_result'];
  let xmlFilterBuffer = '';  // 缓冲可能是 XML 标签开头的文本
  let xmlFilterDepth = 0;    // 嵌套深度，>0 表示在 tool XML 块内部

  function emit(event: Omit<RuntimeEvent, 'timestamp'>): void {
    onEvent({ ...event, timestamp: Date.now() } as RuntimeEvent);
  }

  function flushTextBuffer(): void {
    if (xmlFilterBuffer && xmlFilterDepth === 0) {
      emit({ type: 'text_delta', delta: xmlFilterBuffer });
    }
    xmlFilterBuffer = '';
  }

  function filterToolXml(delta: string): void {
    for (let i = 0; i < delta.length; i++) {
      const ch = delta[i];

      if (ch === '<') {
        // 先 flush 之前累积的安全文本
        flushTextBuffer();
        xmlFilterBuffer = '<';
        continue;
      }

      if (xmlFilterBuffer.startsWith('<')) {
        xmlFilterBuffer += ch;

        if (ch === '>') {
          // 标签闭合，判断是否是 tool XML 标签
          const tagContent = xmlFilterBuffer.slice(1, -1).trim();
          const isClosing = tagContent.startsWith('/');
          const tagName = (isClosing ? tagContent.slice(1) : tagContent.split(/\s/)[0]).toLowerCase();

          if (TOOL_XML_TAGS.includes(tagName)) {
            if (isClosing) {
              xmlFilterDepth = Math.max(0, xmlFilterDepth - 1);
            } else {
              xmlFilterDepth++;
            }
            xmlFilterBuffer = '';
          } else if (xmlFilterDepth > 0) {
            // 在 tool XML 块内部的其它标签，也丢弃
            xmlFilterBuffer = '';
          } else {
            // 非 tool XML 标签，正常输出
            flushTextBuffer();
          }
          continue;
        }

        // 缓冲区过长说明不是标签，flush 出去
        if (xmlFilterBuffer.length > 50) {
          if (xmlFilterDepth === 0) {
            flushTextBuffer();
          } else {
            xmlFilterBuffer = '';
          }
        }
        continue;
      }

      // 普通字符
      if (xmlFilterDepth > 0) {
        // 在 tool XML 块内部，丢弃
        continue;
      }
      xmlFilterBuffer += ch;
    }

    // flush 不以 < 开头的累积文本
    if (xmlFilterBuffer && !xmlFilterBuffer.startsWith('<')) {
      flushTextBuffer();
    }
  }

  return { filterToolXml, flushTextBuffer };
}

// ─── Tool Wrapping ───

/** 权限检查 + 安全守卫的公共逻辑 */
async function runGuards(
  toolName: string,
  args: Record<string, unknown>,
  permissionFn: ToolWrappingDeps['permissionFn'],
  toolSafety: ToolSafetyGuard,
): Promise<PIToolResult | null> {
  if (permissionFn) {
    log.debug(`[权限检查] 工具=${toolName}`);
    const rejection = await permissionFn(toolName, args);
    if (rejection) {
      log.info(`权限拦截 ${toolName}: ${rejection}`);
      return { content: [{ type: 'text', text: `[权限拒绝] ${rejection}` }] };
    }
  }
  const check = toolSafety.checkBeforeExecution(toolName, args);
  if (check.blocked) {
    log.warn(`阻止工具执行: ${check.reason}`);
    return { content: [{ type: 'text', text: `⚠️ ${check.reason}` }] };
  }
  return null;
}

/** 安全守卫：结果截断和无进展检测 */
function postProcess(rawResult: unknown, toolSafety: ToolSafetyGuard): PIToolResult {
  const resultText = typeof rawResult === 'string'
    ? rawResult
    : (rawResult as any)?.content?.[0]?.text ?? JSON.stringify(rawResult);
  const noProgress = toolSafety.recordResult(resultText);
  if (noProgress.blocked) {
    log.warn(`无进展检测: ${noProgress.reason}`);
    return { content: [{ type: 'text', text: `⚠️ ${noProgress.reason}` }] };
  }
  const truncated = toolSafety.truncateResult(resultText);
  if (typeof rawResult === 'object' && (rawResult as any)?.content) {
    if (truncated !== resultText && (rawResult as any).content[0]) {
      (rawResult as any).content[0].text = truncated;
    }
    return rawResult as any;
  }
  return { content: [{ type: 'text', text: truncated }] };
}

/**
 * 包装 PI 内置工具（4 参数 execute 签名）
 * PI: execute(toolCallId, params, signal, onUpdate) => AgentToolResult
 */
function wrapPITool(
  tool: any,
  permissionFn: ToolWrappingDeps['permissionFn'],
  toolSafety: ToolSafetyGuard,
  auditFn: ToolWrappingDeps['auditFn'],
) {
  const originalExecute = tool.execute;
  return {
    name: tool.name,
    label: tool.label ?? tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: async (toolCallId: string, params: unknown, signal?: AbortSignal, onUpdate?: unknown) => {
      const args = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
      const start = Date.now();
      const blocked = await runGuards(tool.name, args, permissionFn, toolSafety);
      if (blocked) {
        auditFn?.({ toolName: tool.name, args, result: blocked.content[0].text, status: 'denied', durationMs: Date.now() - start });
        return blocked;
      }
      try {
        const rawResult = await originalExecute(toolCallId, params, signal, onUpdate);
        const processed = postProcess(rawResult, toolSafety);
        auditFn?.({ toolName: tool.name, args, result: processed.content[0]?.text ?? '', status: 'success', durationMs: Date.now() - start });
        return processed;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        auditFn?.({ toolName: tool.name, args, result: msg, status: 'error', durationMs: Date.now() - start });
        throw err;
      }
    },
  };
}

/**
 * 包装 EvoClaw 自定义工具（1 参数 execute 签名）
 * EvoClaw: execute(args) => string
 */
function wrapEvoclawTool(
  tool: any,
  permissionFn: ToolWrappingDeps['permissionFn'],
  toolSafety: ToolSafetyGuard,
  auditFn: ToolWrappingDeps['auditFn'],
) {
  const originalExecute = tool.execute;
  return {
    name: tool.name,
    label: tool.label ?? tool.name,
    description: tool.description,
    parameters: tool.parameters,
    execute: async (toolCallId: string, params: unknown, _signal?: AbortSignal, _onUpdate?: unknown) => {
      const args = (params && typeof params === 'object' ? params : {}) as Record<string, unknown>;
      const start = Date.now();
      const blocked = await runGuards(tool.name, args, permissionFn, toolSafety);
      if (blocked) {
        auditFn?.({ toolName: tool.name, args, result: blocked.content[0].text, status: 'denied', durationMs: Date.now() - start });
        return blocked;
      }
      try {
        const rawResult = await originalExecute(args);
        const processed = postProcess(rawResult, toolSafety);
        auditFn?.({ toolName: tool.name, args, result: processed.content[0]?.text ?? '', status: 'success', durationMs: Date.now() - start });
        return processed;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        auditFn?.({ toolName: tool.name, args, result: msg, status: 'error', durationMs: Date.now() - start });
        throw err;
      }
    },
  };
}

/**
 * 将所有工具（PI 内置 + EvoClaw 自定义）统一转为 PI customTools 格式。
 *
 * 关键：OpenClaw 发现 PI 对 `tools` 参数用内部实现，绕过 execute()
 * 只有 `customTools` 参数的工具才走 execute() —— 所以全部放进 customTools
 *
 * @param piBuiltInTools - PI 内置工具列表（read/edit/write/grep/find/ls/bash 等）
 * @param deps - 依赖项（权限函数、安全守卫、审计回调、provider 等）
 * @returns 包装后的 PI customTools 数组
 */
export function wrapToolsForPI(piBuiltInTools: any[], deps: ToolWrappingDeps): any[] {
  const { permissionFn, toolSafety, auditFn, provider, evoClawTools } = deps;

  // 所有工具统一包装为 PI customTools 格式
  // PI 内置工具（read/edit/write/grep/find/ls）用 4 参数签名
  // EvoClaw 工具（bash/web_fetch/image/...）和 config.tools 用 1 参数签名
  const allCustomTools = [
    ...piBuiltInTools.filter((t: any) => t.name !== 'bash').map(
      (t: any) => wrapPITool(t, permissionFn, toolSafety, auditFn),
    ),
    ...piBuiltInTools.filter((t: any) => t.name === 'bash').map(
      (t: any) => wrapEvoclawTool(t, permissionFn, toolSafety, auditFn),
    ), // createEnhancedExecTool 是 1 参数
    ...(evoClawTools ?? []).map(
      (t: any) => wrapEvoclawTool(t, permissionFn, toolSafety, auditFn),
    ),
  ].map((tool: any) => ({
    ...tool,
    // Schema 适配：根据 provider 剥离不支持的 JSON Schema 关键字
    parameters: tool.parameters
      ? normalizeToolSchema(tool.parameters as Record<string, unknown>, provider)
      : tool.parameters,
  }));

  log.debug(
    `注入工具: ${allCustomTools.map((t: any) => t.name).join(', ')}`,
  );

  return allCustomTools;
}

/**
 * 构建 PI 内置工具列表（含增强 bash 和 adaptive read）。
 *
 * @param piCoding - 动态导入的 pi-coding-agent 模块
 * @param contextWindow - 模型 context window 大小
 * @returns PI 内置工具数组
 */
export function buildPIBuiltInTools(piCoding: any, contextWindow: number): any[] {
  return [
    ...(piCoding.codingTools as any[]).filter((t: any) => t.name !== 'bash'),
    piCoding.grepTool,
    piCoding.findTool,
    piCoding.lsTool,
    createEnhancedExecTool(),
  ].map((t: any) => {
    const tool = { ...t };
    // Adaptive Read: 根据 context window 自适应调整读取上限
    if (tool.name === 'read') {
      return createAdaptiveReadTool(tool, contextWindow);
    }
    return tool;
  });
}
