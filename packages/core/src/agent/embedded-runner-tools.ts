/**
 * 工具构建模块 — 自研 Kernel 版本
 *
 * 保留:
 * - createEnhancedExecTool() — 增强版 bash 工具 (异步执行，基于 asyncExec)
 * - AuditLogEntry 类型 — 审计接口
 *
 * 移除 (PI 相关):
 * - buildPIBuiltInTools() — 替换为 kernel/builtin-tools.ts
 * - wrapPITool() — 不再有 4 参签名
 * - wrapEvoclawTool() — 移入 kernel/tool-adapter.ts
 * - createToolXmlFilter() — kernel 不产生 XML
 * - PIToolResult 类型 — 不再需要
 * - runGuards() / postProcess() — 移入 kernel/tool-adapter.ts
 */

import {
  asyncExec,
  truncateOutput,
  maybePersistOutput,
  type AsyncExecOptions,
  type DetectedImage,
} from '../infrastructure/async-exec.js';
import type { ToolExecContext } from '../bridge/tool-injector.js';

// ─── Types ───

/** 审计日志条目 */
export interface AuditLogEntry {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  status: 'success' | 'error' | 'denied';
  durationMs: number;
}

// BashExecContext 已统一为 ToolExecContext (bridge/tool-injector.ts)

// ─── createEnhancedExecTool ───

const DEFAULT_TIMEOUT_SEC = 120;
const MAX_OUTPUT_CHARS = 200_000;

/**
 * 增强版 exec 工具（异步执行，替代旧版 execSync 实现）
 *
 * 增强点:
 * - 异步执行 (不阻塞事件循环)
 * - AbortController 支持
 * - 流式进度回调
 * - 超时 → SIGTERM → 3s grace → SIGKILL
 * - 大输出持久化到磁盘 (>30K)
 * - 图片输出检测
 * - 自动后台化 (>15s 阻塞)
 */
export function createEnhancedExecTool() {
  return {
    name: 'bash',  // 保持名称为 bash，模型更熟悉
    description: `执行 shell 命令。输出截断到 ${MAX_OUTPUT_CHARS / 1000}K 字符。大输出请重定向到文件再用 read 查看。长时间任务用 exec_background 工具。`,
    parameters: {
      type: 'object' as const,
      properties: {
        command: { type: 'string', description: '要执行的 shell 命令' },
        workdir: { type: 'string', description: '工作目录（默认当前目录）' },
        timeout: { type: 'number', description: `超时秒数（默认 ${DEFAULT_TIMEOUT_SEC}）` },
        run_in_background: { type: 'boolean', description: '在后台运行命令（不阻塞）' },
      },
      required: ['command'],
    },
    execute: async (args: Record<string, unknown>, ctx?: ToolExecContext): Promise<string> => {
      const command = args.command as string;
      const workdir = (args.workdir as string) || process.cwd();
      const timeoutSec = (args.timeout as number) || DEFAULT_TIMEOUT_SEC;
      const runInBackground = args.run_in_background as boolean | undefined;

      if (!command) return '错误：缺少 command 参数';

      // 危险命令检测 (参考 Claude Code destructiveCommandWarning.ts)
      const destructiveWarning = detectDestructiveCommand(command);
      if (destructiveWarning) {
        return `⚠️ 危险命令检测: ${destructiveWarning}\n命令: ${command}\n\n如需执行，请通过权限系统确认。`;
      }

      // 显式后台执行
      if (runInBackground) {
        return runAsBackground(command, workdir);
      }

      // 异步执行
      const execOptions: AsyncExecOptions = {
        cwd: workdir,
        timeoutMs: timeoutSec * 1000,
        signal: ctx?.signal,
        maxOutputChars: MAX_OUTPUT_CHARS,
        onProgress: ctx?.onProgress
          ? (p) => ctx.onProgress!({ message: p.lastLines, data: { totalLines: p.totalLines, totalBytes: p.totalBytes } })
          : undefined,
      };

      const result = await asyncExec(command, execOptions);

      // 取消
      if (result.aborted) {
        return '命令已取消。';
      }

      // 超时 → 自动转后台
      if (result.timedOut) {
        const partial = result.stdout.slice(0, 2000);
        return `命令超时（${timeoutSec} 秒），已终止。\n${partial ? `部分输出:\n${partial}\n` : ''}可使用 exec_background 工具手动重启。`;
      }

      // 图片输出
      if (result.detectedImages?.length) {
        return formatImageResult(result.detectedImages, result.stdout);
      }

      // 成功
      if (result.exitCode === 0) {
        const output = result.stdout || '(无输出)';
        // 大输出持久化
        const { text } = await maybePersistOutput(output);
        return truncateOutput(text, MAX_OUTPUT_CHARS);
      }

      // 错误
      const combined = [result.stdout, result.stderr].filter(Boolean).join('\n');
      const truncated = truncateOutput(combined || '命令执行失败', MAX_OUTPUT_CHARS);
      return `${truncated}\n\n(退出码 ${result.exitCode})`;
    },
  };
}

/** 后台执行命令 (detached, unref) */
function runAsBackground(command: string, cwd: string): string {
  const { spawn } = require('node:child_process') as typeof import('node:child_process');
  const { sanitizeEnv } = require('@evoclaw/shared') as typeof import('@evoclaw/shared');
  try {
    // M8: 敏感凭据不继承到 background 子进程
    const { env: sanitizedEnv } = sanitizeEnv(process.env, {
      mode: 'inherit',
      extraEnv: { EVOCLAW_SHELL: 'background' },
    });
    const bg = spawn('bash', ['-c', command], {
      cwd,
      detached: true,
      stdio: 'ignore',
      env: sanitizedEnv,
    });
    bg.unref();
    return `后台进程已启动 (PID: ${bg.pid})。\n使用 process 工具查看输出。`;
  } catch (err) {
    return `后台启动失败: ${err instanceof Error ? err.message : String(err)}`;
  }
}

/** 格式化图片检测结果 */
function formatImageResult(images: DetectedImage[], rawOutput: string): string {
  const summary = images.map((img, i) => `[图片 ${i + 1}] ${img.mimeType} (${Math.round(img.base64.length * 0.75 / 1024)}KB)`).join('\n');
  const textPart = rawOutput.replace(/[A-Za-z0-9+/=]{100,}/g, '[base64 图片数据]');
  return `检测到 ${images.length} 张图片:\n${summary}\n\n${truncateOutput(textPart, MAX_OUTPUT_CHARS / 2)}`;
}

// ─── P0-4: 危险命令检测 ───

/** 危险命令模式 (参考 Claude Code BashTool/destructiveCommandWarning.ts) */
const DESTRUCTIVE_PATTERNS: Array<{ pattern: RegExp; warning: string }> = [
  // 文件删除
  { pattern: /\brm\s+(-[rf]+\s+|.*--force|.*--recursive)/i, warning: '删除文件 (rm -rf)' },
  { pattern: /\brm\s+-[a-z]*r[a-z]*f|rm\s+-[a-z]*f[a-z]*r/i, warning: '删除文件 (rm -rf)' },
  // Git 不可逆操作
  { pattern: /\bgit\s+reset\s+--hard/i, warning: '不可逆 git 操作 (reset --hard)' },
  { pattern: /\bgit\s+push\s+.*--force/i, warning: '强制推送 (push --force)' },
  { pattern: /\bgit\s+clean\s+-[a-z]*f/i, warning: '清理未跟踪文件 (clean -f)' },
  { pattern: /\bgit\s+checkout\s+--\s+\./i, warning: '丢弃所有本地更改' },
  // 数据库
  { pattern: /\bdrop\s+(table|database|schema)/i, warning: '删除数据库对象 (DROP)' },
  { pattern: /\btruncate\s+table/i, warning: '清空数据表 (TRUNCATE)' },
  // 基础设施
  { pattern: /\bkubectl\s+delete/i, warning: '删除 K8s 资源' },
  { pattern: /\bterraform\s+destroy/i, warning: '销毁基础设施' },
  // 危险 shell 操作
  { pattern: /\bchmod\s+777/i, warning: '设置全局可写权限' },
  { pattern: /\bmkfs\b/i, warning: '格式化磁盘' },
  { pattern: /\bdd\s+if=.*of=\/dev\//i, warning: '直接写入设备' },
];

/**
 * 检测命令是否包含危险操作
 * @returns 危险描述（null 表示安全）
 */
function detectDestructiveCommand(command: string): string | null {
  for (const { pattern, warning } of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(command)) {
      return warning;
    }
  }
  return null;
}

/** @internal 仅供测试使用 */
export const _testing = {
  detectDestructiveCommand,
  DESTRUCTIVE_PATTERNS,
};
