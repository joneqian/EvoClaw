/**
 * SSE 新事件类型测试
 *
 * 验证:
 * 1. RuntimeEvent 新类型结构正确
 * 2. subagent_progress 事件数据结构
 * 3. auto_backgrounded 事件数据结构
 * 4. subagent_notification 事件数据结构
 */
import { describe, it, expect } from 'vitest';
import type { RuntimeEvent, RuntimeEventType } from '../agent/types.js';

describe('RuntimeEventType 新增类型', () => {
  it('应包含 subagent_progress 类型', () => {
    const eventType: RuntimeEventType = 'subagent_progress';
    expect(eventType).toBe('subagent_progress');
  });

  it('应包含 auto_backgrounded 类型', () => {
    const eventType: RuntimeEventType = 'auto_backgrounded';
    expect(eventType).toBe('auto_backgrounded');
  });

  it('应包含 subagent_notification 类型', () => {
    const eventType: RuntimeEventType = 'subagent_notification';
    expect(eventType).toBe('subagent_notification');
  });
});

describe('subagent_progress 事件结构', () => {
  it('应包含完整的进度数据', () => {
    const event: RuntimeEvent = {
      type: 'subagent_progress',
      timestamp: Date.now(),
      subagentProgress: {
        taskId: 'task-123',
        agentType: 'researcher',
        task: '搜索竞品信息',
        status: 'running',
        progress: {
          toolUseCount: 3,
          inputTokens: 1500,
          outputTokens: 500,
          recentActivities: [
            { toolName: 'web_search', timestamp: Date.now() - 5000 },
            { toolName: 'web_fetch', timestamp: Date.now() - 2000 },
          ],
          durationMs: 15000,
        },
      },
    };

    expect(event.subagentProgress).toBeDefined();
    expect(event.subagentProgress!.taskId).toBe('task-123');
    expect(event.subagentProgress!.agentType).toBe('researcher');
    expect(event.subagentProgress!.status).toBe('running');
    expect(event.subagentProgress!.progress.toolUseCount).toBe(3);
    expect(event.subagentProgress!.progress.recentActivities).toHaveLength(2);
  });

  it('agentType 可选', () => {
    const event: RuntimeEvent = {
      type: 'subagent_progress',
      timestamp: Date.now(),
      subagentProgress: {
        taskId: 'task-456',
        task: '通用任务',
        status: 'running',
        progress: {
          toolUseCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          recentActivities: [],
          durationMs: 100,
        },
      },
    };

    expect(event.subagentProgress!.agentType).toBeUndefined();
  });

  it('status 支持所有终态', () => {
    const statuses: Array<RuntimeEvent['subagentProgress'] extends { status: infer S } | undefined ? S : never> =
      ['running', 'completed', 'failed', 'cancelled'];

    for (const status of statuses) {
      const event: RuntimeEvent = {
        type: 'subagent_progress',
        timestamp: Date.now(),
        subagentProgress: {
          taskId: `task-${status}`,
          task: `${status} 任务`,
          status,
          progress: {
            toolUseCount: 0,
            inputTokens: 0,
            outputTokens: 0,
            recentActivities: [],
            durationMs: 0,
          },
        },
      };
      expect(event.subagentProgress!.status).toBe(status);
    }
  });
});

describe('auto_backgrounded 事件结构', () => {
  it('应包含后台化原因和耗时', () => {
    const event: RuntimeEvent = {
      type: 'auto_backgrounded',
      timestamp: Date.now(),
      autoBackgrounded: {
        taskId: 'chat-agent-1',
        reason: 'timeout',
        elapsedMs: 60000,
      },
    };

    expect(event.autoBackgrounded).toBeDefined();
    expect(event.autoBackgrounded!.taskId).toBe('chat-agent-1');
    expect(event.autoBackgrounded!.reason).toBe('timeout');
    expect(event.autoBackgrounded!.elapsedMs).toBe(60000);
  });
});

describe('subagent_notification 事件结构', () => {
  it('成功通知应包含结果', () => {
    const event: RuntimeEvent = {
      type: 'subagent_notification',
      timestamp: Date.now(),
      subagentNotification: {
        taskId: 'task-789',
        agentType: 'writer',
        task: '撰写报告',
        success: true,
        result: '报告内容...',
        durationMs: 30000,
      },
    };

    expect(event.subagentNotification!.success).toBe(true);
    expect(event.subagentNotification!.result).toContain('报告内容');
  });

  it('失败通知应标记 success=false', () => {
    const event: RuntimeEvent = {
      type: 'subagent_notification',
      timestamp: Date.now(),
      subagentNotification: {
        taskId: 'task-fail',
        task: '失败的任务',
        success: false,
        durationMs: 5000,
      },
    };

    expect(event.subagentNotification!.success).toBe(false);
    expect(event.subagentNotification!.result).toBeUndefined();
  });
});

describe('SSE 事件 JSON 序列化', () => {
  it('subagent_progress 事件可正确序列化/反序列化', () => {
    const event: RuntimeEvent = {
      type: 'subagent_progress',
      timestamp: 1712500000000,
      subagentProgress: {
        taskId: 'abc-123',
        agentType: 'analyst',
        task: '分析数据',
        status: 'running',
        progress: {
          toolUseCount: 5,
          inputTokens: 2000,
          outputTokens: 800,
          recentActivities: [
            { toolName: 'bash', timestamp: 1712500000000 },
          ],
          durationMs: 10000,
        },
      },
    };

    const json = JSON.stringify(event);
    const parsed = JSON.parse(json) as RuntimeEvent;

    expect(parsed.type).toBe('subagent_progress');
    expect(parsed.subagentProgress!.taskId).toBe('abc-123');
    expect(parsed.subagentProgress!.progress.toolUseCount).toBe(5);
    expect(parsed.subagentProgress!.progress.recentActivities).toHaveLength(1);
  });

  it('auto_backgrounded 事件可正确序列化/反序列化', () => {
    const event: RuntimeEvent = {
      type: 'auto_backgrounded',
      timestamp: 1712500060000,
      autoBackgrounded: {
        taskId: 'chat-xyz',
        reason: 'timeout',
        elapsedMs: 60000,
      },
    };

    const json = JSON.stringify(event);
    const parsed = JSON.parse(json) as RuntimeEvent;

    expect(parsed.type).toBe('auto_backgrounded');
    expect(parsed.autoBackgrounded!.elapsedMs).toBe(60000);
  });
});
