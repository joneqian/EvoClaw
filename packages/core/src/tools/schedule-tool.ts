/**
 * schedule — Agent 可用的定时调度工具
 *
 * 支持两种模式：
 * 1. 一次性提醒（delay）: "5 分钟后提醒我喝水"
 * 2. 周期性任务（cron）: "每天早上 9 点汇报天气"
 *
 * 底层复用 CronRunner，一次性提醒通过计算目标时间的 cron 表达式实现。
 */

import type { ToolDefinition } from '../bridge/tool-injector.js';
import type { CronRunner } from '../scheduler/cron-runner.js';
import { enqueueSystemEvent } from '../infrastructure/system-events.js';

interface ScheduleToolDeps {
  cronRunner: CronRunner;
  agentId: string;
  sessionKey: string;
}

export function createScheduleTool(deps: ScheduleToolDeps): ToolDefinition[] {
  const { cronRunner, agentId, sessionKey } = deps;

  const scheduleTool: ToolDefinition = {
    name: 'schedule',
    description: [
      '创建定时提醒或周期性任务。',
      '',
      '模式 1 — 一次性提醒（设置 delay）:',
      '  delay: "5m" / "1h" / "30s" 等时间表达式',
      '  message: 提醒内容',
      '',
      '模式 2 — 周期性任务（设置 cron）:',
      '  cron: 标准 5 字段 cron 表达式（如 "0 9 * * *" = 每天 9 点）',
      '  message: 任务执行时发送的内容',
      '',
      '可选参数:',
      '  name: 任务名称（默认自动生成）',
      '  mode: "prompt"（独立执行，默认）或 "event"（注入主会话）',
    ].join('\n'),
    parameters: {
      type: 'object',
      properties: {
        delay: {
          type: 'string',
          description: '延迟时间，如 "1m"(1分钟), "5m"(5分钟), "1h"(1小时), "30s"(30秒)。与 cron 二选一。',
        },
        cron: {
          type: 'string',
          description: '标准 5 字段 cron 表达式，如 "0 9 * * *"。与 delay 二选一。',
        },
        message: {
          type: 'string',
          description: '提醒内容或任务执行时的 prompt',
        },
        name: {
          type: 'string',
          description: '任务名称（可选，默认自动生成）',
        },
        mode: {
          type: 'string',
          enum: ['prompt', 'event'],
          description: '"prompt"=独立执行（默认），"event"=注入主会话',
        },
      },
      required: ['message'],
    },
    execute: async (params) => {
      const message = (params.message as string)?.trim();
      if (!message) return '请提供提醒内容（message 参数）';

      const delay = params.delay as string | undefined;
      const cron = params.cron as string | undefined;
      const name = (params.name as string) ?? `提醒: ${message.slice(0, 20)}`;
      const mode = (params.mode as string) ?? 'event';

      if (!delay && !cron) {
        return '请设置 delay（一次性延迟）或 cron（周期性表达式），二选一';
      }

      if (delay) {
        // 一次性提醒：解析 delay → 计算目标时间 → 用 setTimeout + enqueueSystemEvent
        const delayMs = parseDelay(delay);
        if (delayMs <= 0) return `无法解析延迟时间: "${delay}"。支持格式: 30s, 5m, 1h, 2d`;
        if (delayMs > 7 * 24 * 60 * 60 * 1000) return '延迟时间不能超过 7 天';

        const targetTime = new Date(Date.now() + delayMs);
        const formatted = formatTime(targetTime);

        // 使用 setTimeout 实现一次性提醒
        setTimeout(() => {
          enqueueSystemEvent(`[定时提醒] ${message}`, sessionKey);
        }, delayMs);

        return `已设置提醒 ✓\n- 内容: ${message}\n- 将在 ${formatted} 触发（${delay}后）\n- 模式: 注入当前会话`;
      }

      // 周期性任务：创建 cron job
      try {
        const job = cronRunner.scheduleJob(agentId, {
          name,
          cronExpression: cron!,
          actionType: mode === 'event' ? 'event' : 'prompt',
          actionConfig: { prompt: message },
        });
        return `已创建定时任务 ✓\n- 名称: ${name}\n- 表达式: ${cron}\n- 下次执行: ${job.nextRunAt}\n- 模式: ${mode === 'event' ? '注入主会话' : '独立执行'}`;
      } catch (err) {
        return `创建定时任务失败: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };

  const listScheduleTool: ToolDefinition = {
    name: 'schedule_list',
    description: '列出当前 Agent 的所有定时任务',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      const jobs = cronRunner.listJobs(agentId);
      if (jobs.length === 0) return '暂无定时任务';
      return jobs.map((j, i) =>
        `${i + 1}. ${j.name}\n   表达式: ${j.cronExpression} | 类型: ${j.actionType} | 启用: ${j.enabled ? '是' : '否'}${j.nextRunAt ? ` | 下次: ${j.nextRunAt}` : ''}`
      ).join('\n');
    },
  };

  const deleteScheduleTool: ToolDefinition = {
    name: 'schedule_delete',
    description: '删除一个定时任务（通过名称或 ID）',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '任务名称（模糊匹配）' },
        id: { type: 'string', description: '任务 ID（精确匹配）' },
      },
    },
    execute: async (params) => {
      const targetId = params.id as string | undefined;
      const targetName = params.name as string | undefined;

      if (targetId) {
        const ok = cronRunner.removeJob(targetId);
        return ok ? `已删除任务 ${targetId}` : `未找到任务 ${targetId}`;
      }

      if (targetName) {
        const jobs = cronRunner.listJobs(agentId);
        const match = jobs.find(j => j.name.includes(targetName));
        if (!match) return `未找到名称包含 "${targetName}" 的任务`;
        cronRunner.removeJob(match.id);
        return `已删除任务: ${match.name}`;
      }

      return '请提供任务 name 或 id';
    },
  };

  return [scheduleTool, listScheduleTool, deleteScheduleTool];
}

/** 解析延迟字符串为毫秒 */
function parseDelay(s: string): number {
  const match = s.trim().match(/^(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hour|d|day)s?$/i);
  if (!match) return -1;
  const value = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  switch (unit) {
    case 's': case 'sec': return value * 1000;
    case 'm': case 'min': return value * 60 * 1000;
    case 'h': case 'hour': return value * 60 * 60 * 1000;
    case 'd': case 'day': return value * 24 * 60 * 60 * 1000;
    default: return -1;
  }
}

/** 格式化时间为 HH:MM */
function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
