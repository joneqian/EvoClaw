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

      // P0-4: 危险命令检测 (参考 Claude Code destructiveCommandWarning.ts)
      const destructiveWarning = detectDestructiveCommand(command);
      if (destructiveWarning) {
        return `⚠️ 危险命令检测: ${destructiveWarning}\n命令: ${command}\n\n如需执行，请通过权限系统确认。`;
      }



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
          // 超时后自动转后台继续执行（参考 Claude Code BashTool 超时→后台）
          try {
            const { spawn } = require('node:child_process') as typeof import('node:child_process');
            const bg = spawn(command, [], {
              cwd: workdir,
              shell: true,
              detached: true,
              stdio: 'ignore',
              env: { ...process.env, EVOCLAW_SHELL: 'background' },
            });
            bg.unref();
            const partialOut = (e.stdout?.toString() ?? '').slice(0, 2000);
            return `命令超时（${timeoutSec} 秒），已自动转为后台继续执行 (PID: ${bg.pid})。\n${partialOut ? `部分输出:\n${partialOut}\n` : ''}后续输出可通过 process 工具查看。`;
          } catch {
            return `命令超时（${timeoutSec} 秒），已终止。转后台执行失败，请使用 exec_background 工具手动重试。`;
          }
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
