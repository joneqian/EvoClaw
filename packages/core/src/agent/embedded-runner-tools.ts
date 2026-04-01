/**
 * 工具构建模块 — 自研 Kernel 版本
 *
 * 保留:
 * - createEnhancedExecTool() — 增强版 bash 工具 (独立于 PI)
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

// ─── Types ───

/** 审计日志条目 */
export interface AuditLogEntry {
  toolName: string;
  args: Record<string, unknown>;
  result: string;
  status: 'success' | 'error' | 'denied';
  durationMs: number;
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
