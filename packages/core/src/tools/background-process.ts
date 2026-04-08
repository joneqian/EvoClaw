/**
 * 后台进程管理工具
 * exec 后台模式: 启动长时间运行的命令
 * process 工具: 查询/输出/终止后台进程
 */

import { spawn, type ChildProcess } from 'node:child_process';
import type { ToolDefinition } from '../bridge/tool-injector.js';
import { createTask, updateTask } from '../infrastructure/task-registry.js';
import { enqueueTaskNotification } from '../infrastructure/task-notifications.js';

/** 后台进程条目 */
interface BackgroundProcess {
  id: string;
  command: string;
  pid: number;
  startedAt: number;
  status: 'running' | 'exited';
  exitCode?: number;
  outputBuffer: string[];
  maxBufferLines: number;
  process: ChildProcess;
}

/** 进程上下文：用于关联到 TaskRegistry + 通知回流 */
interface ProcessContext {
  agentId: string;
  sessionKey: string;
}

/** 进程管理器 — 追踪后台进程生命周期 */
class ProcessManager {
  private processes = new Map<string, BackgroundProcess>();
  private nextId = 1;

  /** 启动后台命令 */
  start(command: string, ctx?: ProcessContext): BackgroundProcess {
    const id = `bg-${this.nextId++}`;
    const child = spawn('sh', ['-c', command], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    });

    const entry: BackgroundProcess = {
      id,
      command,
      pid: child.pid ?? 0,
      startedAt: Date.now(),
      status: 'running',
      outputBuffer: [],
      maxBufferLines: 200,
      process: child,
    };

    // 注册到 TaskRegistry — 供前端任务面板展示 + 统一 cancel 入口
    if (ctx) {
      createTask({
        taskId: id,
        runtime: 'bash',
        sourceId: command.slice(0, 100),
        status: 'running',
        label: command.slice(0, 100),
        agentId: ctx.agentId,
        sessionKey: ctx.sessionKey,
        startedAt: entry.startedAt,
        cancelFn: () => {
          this.kill(id);
        },
      });
    }

    // 捕获 stdout
    child.stdout?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line) {
          entry.outputBuffer.push(line);
          // 环形缓冲：超过上限时丢弃旧行
          if (entry.outputBuffer.length > entry.maxBufferLines) {
            entry.outputBuffer.shift();
          }
        }
      }
    });

    // 捕获 stderr（合并到同一缓冲）
    child.stderr?.on('data', (data: Buffer) => {
      const lines = data.toString().split('\n');
      for (const line of lines) {
        if (line) {
          entry.outputBuffer.push(`[stderr] ${line}`);
          if (entry.outputBuffer.length > entry.maxBufferLines) {
            entry.outputBuffer.shift();
          }
        }
      }
    });

    // 进程退出
    child.on('exit', (code) => {
      entry.status = 'exited';
      entry.exitCode = code ?? -1;
      if (ctx) {
        const endedAt = Date.now();
        const durationMs = endedAt - entry.startedAt;
        const success = entry.exitCode === 0;
        updateTask(id, {
          status: success ? 'succeeded' : 'failed',
          endedAt,
          error: success ? undefined : `退出码 ${entry.exitCode}`,
        });
        // 通知回流 — 让主 Agent 下一 turn 感知后台进程已结束
        try {
          const tail = entry.outputBuffer.slice(-20).join('\n');
          enqueueTaskNotification({
            taskId: id,
            kind: 'background_process',
            status: success ? 'completed' : 'failed',
            title: command.slice(0, 100),
            result: success ? (tail || undefined) : undefined,
            error: success ? undefined : (tail || `退出码 ${entry.exitCode}`),
            durationMs,
          }, ctx.sessionKey);
        } catch { /* 通知失败不影响主流程 */ }
      }
    });

    child.on('error', (err) => {
      entry.status = 'exited';
      entry.exitCode = -1;
      entry.outputBuffer.push(`[error] ${err.message}`);
      if (ctx) {
        updateTask(id, { status: 'failed', endedAt: Date.now(), error: err.message });
      }
    });

    this.processes.set(id, entry);
    return entry;
  }

  /** 列出所有进程 */
  list(): Array<Omit<BackgroundProcess, 'process' | 'outputBuffer'> & { outputLines: number }> {
    return [...this.processes.values()].map(({ process: _, outputBuffer, ...rest }) => ({
      ...rest,
      outputLines: outputBuffer.length,
    }));
  }

  /** 获取进程输出（最近 N 行） */
  getOutput(id: string, lines?: number): string | null {
    const entry = this.processes.get(id);
    if (!entry) return null;
    const n = lines ?? 50;
    return entry.outputBuffer.slice(-n).join('\n');
  }

  /** 终止进程 */
  kill(id: string): boolean {
    const entry = this.processes.get(id);
    if (!entry || entry.status !== 'running') return false;
    try {
      entry.process.kill('SIGTERM');
      // 3 秒后强制 kill
      setTimeout(() => {
        if (entry.status === 'running') {
          entry.process.kill('SIGKILL');
        }
      }, 3000);
      return true;
    } catch {
      return false;
    }
  }

  /** 向进程发送输入 */
  sendInput(id: string, input: string): boolean {
    const entry = this.processes.get(id);
    if (!entry || entry.status !== 'running') return false;
    try {
      entry.process.stdin?.write(input);
      return true;
    } catch {
      return false;
    }
  }

  /** 获取单个进程 */
  get(id: string): BackgroundProcess | undefined {
    return this.processes.get(id);
  }
}

/** 全局进程管理器实例 */
const globalProcessManager = new ProcessManager();

/** 创建后台执行工具 */
export function createExecBackgroundTool(opts?: { agentId: string; sessionKey: string }): ToolDefinition {
  return {
    name: 'exec_background',
    description: '在后台启动一个长时间运行的命令（如 dev server、watch 进程、构建任务等）。命令会在后台持续运行，不阻塞当前对话。使用 process 工具查看输出和管理后台进程。',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: '要在后台执行的 shell 命令' },
      },
      required: ['command'],
    },
    execute: async (args) => {
      const command = args['command'] as string;
      if (!command) return '错误：缺少 command 参数';

      // 安全检查：禁止危险命令
      if (isDangerousCommand(command)) {
        return `错误：安全检查未通过。命令包含危险操作: "${command}"`;
      }

      try {
        const entry = globalProcessManager.start(command, opts);
        return `后台进程已启动:\n  ID: ${entry.id}\n  PID: ${entry.pid}\n  命令: ${command}\n\n使用 process 工具查看输出: process({ action: "output", id: "${entry.id}" })`;
      } catch (err) {
        return `启动失败: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

/** 创建进程管理工具 */
export function createProcessTool(): ToolDefinition {
  return {
    name: 'process',
    description: '管理后台进程。支持操作: list（列出所有后台进程）、output（查看进程输出）、kill（终止进程）、send（向进程发送输入）。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: '操作类型: list / output / kill / send' },
        id: { type: 'string', description: '进程 ID（output/kill/send 时必需）' },
        lines: { type: 'number', description: '查看最近 N 行输出（默认 50）' },
        input: { type: 'string', description: 'send 操作时要发送的输入文本' },
      },
      required: ['action'],
    },
    execute: async (args) => {
      const action = args['action'] as string;
      const id = args['id'] as string;

      switch (action) {
        case 'list': {
          const processes = globalProcessManager.list();
          if (processes.length === 0) return '当前没有后台进程。';

          const formatted = processes.map(p => {
            const duration = p.status === 'running'
              ? `${((Date.now() - p.startedAt) / 1000).toFixed(0)}s (运行中)`
              : `退出码 ${p.exitCode}`;
            return `  ${p.id} [${p.status}] PID:${p.pid} ${duration}\n    命令: ${p.command}\n    输出: ${p.outputLines} 行`;
          }).join('\n\n');
          return `后台进程列表（${processes.length} 个）:\n\n${formatted}`;
        }

        case 'output': {
          if (!id) return '错误：output 操作需要 id 参数';
          const lines = (args['lines'] as number) ?? 50;
          const output = globalProcessManager.getOutput(id, lines);
          if (output === null) return `未找到进程 ${id}`;
          return output || '（暂无输出）';
        }

        case 'kill': {
          if (!id) return '错误：kill 操作需要 id 参数';
          const killed = globalProcessManager.kill(id);
          return killed ? `已发送终止信号到进程 ${id}` : `无法终止进程 ${id}（可能已退出或不存在）`;
        }

        case 'send': {
          if (!id) return '错误：send 操作需要 id 参数';
          const input = args['input'] as string;
          if (!input) return '错误：send 操作需要 input 参数';
          const sent = globalProcessManager.sendInput(id, input + '\n');
          return sent ? `已发送输入到进程 ${id}` : `无法发送输入（进程可能已退出）`;
        }

        default:
          return `未知操作: ${action}。支持的操作: list, output, kill, send`;
      }
    },
  };
}

/** 危险命令检测 */
function isDangerousCommand(command: string): boolean {
  const dangerous = [
    /\brm\s+(-rf?|--recursive)\s+[\/~]/i,     // rm -rf /
    /\bmkfs\b/i,                                // 格式化磁盘
    /\bdd\s+.*of=\/dev\//i,                     // 覆写设备
    /\b:()\s*\{.*\|\s*:\s*&\s*\}\s*;?\s*:/,    // fork bomb
    />\s*\/dev\/sd/i,                           // 写设备
  ];
  return dangerous.some(p => p.test(command));
}

/** 导出进程管理器供测试 */
export { ProcessManager };
