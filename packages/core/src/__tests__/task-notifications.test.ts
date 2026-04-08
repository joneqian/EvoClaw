import { describe, it, expect, beforeEach } from 'vitest';
import {
  formatTaskNotification,
  enqueueTaskNotification,
} from '../infrastructure/task-notifications.js';
import {
  drainFormattedSystemEvents,
  peekSystemEvents,
  resetSystemEventsForTest,
} from '../infrastructure/system-events.js';

describe('task-notifications', () => {
  const sessionKey = 'agent:test:local:direct:user';

  beforeEach(() => {
    resetSystemEventsForTest();
  });

  describe('formatTaskNotification', () => {
    it('应格式化 subagent 完成通知为 XML', () => {
      const text = formatTaskNotification({
        taskId: 't-abc',
        kind: 'subagent',
        status: 'completed',
        title: '处理发票 1-10',
        result: '共 10 张，已全部分类',
        durationMs: 5230,
        tokenUsage: { inputTokens: 1200, outputTokens: 450 },
        agentType: 'researcher',
      });
      expect(text).toContain('<task-notification>');
      expect(text).toContain('<task-id>t-abc</task-id>');
      expect(text).toContain('<kind>subagent</kind>');
      expect(text).toContain('<status>completed</status>');
      expect(text).toContain('<title>处理发票 1-10</title>');
      expect(text).toContain('<agent-type>researcher</agent-type>');
      expect(text).toContain('<duration-ms>5230</duration-ms>');
      expect(text).toContain('<tokens input="1200" output="450" />');
      expect(text).toContain('<result>共 10 张，已全部分类</result>');
      expect(text).toContain('</task-notification>');
    });

    it('应格式化失败通知（含 error，无 result）', () => {
      const text = formatTaskNotification({
        taskId: 't-fail',
        kind: 'subagent',
        status: 'failed',
        title: '下载文件',
        error: '网络超时',
        durationMs: 30000,
      });
      expect(text).toContain('<status>failed</status>');
      expect(text).toContain('<error>网络超时</error>');
      expect(text).not.toContain('<result');
    });

    it('应对 XML 特殊字符 & < > 转义', () => {
      const text = formatTaskNotification({
        taskId: 't-esc',
        kind: 'subagent',
        status: 'completed',
        title: '处理 <script> & "危险" 内容',
        result: 'AT&T 报价 < $100',
        durationMs: 100,
      });
      // 本实现只转义 & < >，不转 "（足够防止 XML 注入）
      expect(text).toContain('&lt;script&gt;');
      expect(text).toContain('&amp; "危险" 内容');
      expect(text).toContain('AT&amp;T 报价 &lt; $100');
    });

    it('result 超长应截断并打 truncated 标记', () => {
      const longResult = 'x'.repeat(2000);
      const text = formatTaskNotification({
        taskId: 't-long',
        kind: 'subagent',
        status: 'completed',
        title: 't',
        result: longResult,
        durationMs: 100,
      });
      expect(text).toContain('truncated="true"');
      expect(text.length).toBeLessThan(longResult.length);
      expect(text).toContain('…');
    });

    it('error 超长应截断', () => {
      const longErr = 'e'.repeat(1000);
      const text = formatTaskNotification({
        taskId: 't-err-long',
        kind: 'subagent',
        status: 'failed',
        title: 't',
        error: longErr,
        durationMs: 100,
      });
      // error 截断到 400 字符 + '…'
      expect(text).toContain('…');
    });

    it('无 agentType / tokenUsage 时应省略相关字段', () => {
      const text = formatTaskNotification({
        taskId: 't-min',
        kind: 'cron',
        status: 'completed',
        title: '每日报告',
        durationMs: 500,
      });
      expect(text).not.toContain('<agent-type>');
      expect(text).not.toContain('<tokens');
      expect(text).toContain('<kind>cron</kind>');
    });

    it('负 duration 应规整为 0', () => {
      const text = formatTaskNotification({
        taskId: 't-neg',
        kind: 'subagent',
        status: 'completed',
        title: 't',
        durationMs: -5,
      });
      expect(text).toContain('<duration-ms>0</duration-ms>');
    });
  });

  describe('enqueueTaskNotification', () => {
    it('enqueue 后能从 drainFormattedSystemEvents 消费出来', () => {
      enqueueTaskNotification(
        {
          taskId: 't-1',
          kind: 'subagent',
          status: 'completed',
          title: '任务一',
          durationMs: 100,
        },
        sessionKey,
      );
      const lines = drainFormattedSystemEvents(sessionKey);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('<task-notification>');
      expect(lines[0]).toContain('<task-id>t-1</task-id>');
      // 时间戳前缀由 drainFormattedSystemEvents 添加
      expect(lines[0]).toMatch(/^\[\d{2}:\d{2}:\d{2}\]/);
    });

    it('contextKey 幂等：同一 taskId 重复 enqueue 只保留最新', () => {
      enqueueTaskNotification(
        { taskId: 't-1', kind: 'subagent', status: 'completed', title: 'v1', durationMs: 100 },
        sessionKey,
      );
      enqueueTaskNotification(
        { taskId: 't-1', kind: 'subagent', status: 'completed', title: 'v2', durationMs: 200 },
        sessionKey,
      );
      const events = peekSystemEvents(sessionKey);
      expect(events).toHaveLength(1);
      expect(events[0]).toContain('<title>v2</title>');
      expect(events[0]).toContain('<duration-ms>200</duration-ms>');
    });

    it('不同 taskId 应独立入队', () => {
      enqueueTaskNotification(
        { taskId: 't-1', kind: 'subagent', status: 'completed', title: 'a', durationMs: 10 },
        sessionKey,
      );
      enqueueTaskNotification(
        { taskId: 't-2', kind: 'subagent', status: 'completed', title: 'b', durationMs: 20 },
        sessionKey,
      );
      const events = peekSystemEvents(sessionKey);
      expect(events).toHaveLength(2);
    });

    it('空 sessionKey 应静默跳过', () => {
      enqueueTaskNotification(
        { taskId: 't-1', kind: 'subagent', status: 'completed', title: 't', durationMs: 100 },
        '',
      );
      expect(peekSystemEvents('')).toHaveLength(0);
    });

    it('多 session 隔离', () => {
      const s1 = 'agent:a:local:direct:user';
      const s2 = 'agent:b:local:direct:user';
      enqueueTaskNotification(
        { taskId: 't-1', kind: 'subagent', status: 'completed', title: 'a', durationMs: 10 },
        s1,
      );
      enqueueTaskNotification(
        { taskId: 't-2', kind: 'subagent', status: 'completed', title: 'b', durationMs: 20 },
        s2,
      );
      expect(peekSystemEvents(s1)).toHaveLength(1);
      expect(peekSystemEvents(s2)).toHaveLength(1);
    });
  });
});
