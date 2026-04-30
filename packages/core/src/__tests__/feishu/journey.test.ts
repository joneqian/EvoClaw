/**
 * 飞书 channel E2E 关键路径（journey）测试
 *
 * 用 _harness.ts 提供的 FeishuTestHarness 跑完整流程：
 *   boot → 模拟入站 → 断言 handler 调用 / 出站 SDK 调用 → shutdown
 *
 * 这是 mock-based E2E：不接真飞书，但走真实的 inbound/outbound/normalizer/retry 代码。
 * 主要价值是把"真机灰度时手动跑的关键路径"自动化，回归阻挡核心 channel 行为破坏。
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FeishuTestHarness } from './_harness.js';

describe('飞书 E2E journey', () => {
  let h: FeishuTestHarness;

  beforeEach(() => {
    h = new FeishuTestHarness();
  });

  afterEach(async () => {
    await h.shutdown();
  });

  describe('入站', () => {
    it('p2p 文本：handler 收到 normalized ChannelMessage', async () => {
      await h.boot();
      await h.simulateP2PText({ text: '你好 bot' });

      expect(h.inboundMessages).toHaveLength(1);
      const msg = h.inboundMessages[0]!;
      expect(msg.channel).toBe('feishu');
      expect(msg.chatType).toBe('private');
      expect(msg.content).toBe('你好 bot');
      expect(msg.senderId).toBe('ou_user_1');
    });

    it('群聊 @ bot：handler 收到消息', async () => {
      await h.boot();
      await h.simulateGroupText({
        chatId: 'oc_team',
        text: '@Bot 帮我查个东西',
      });

      expect(h.inboundMessages).toHaveLength(1);
      expect(h.inboundMessages[0]!.chatType).toBe('group');
    });

    it('群聊未 @ bot：handler 不触发', async () => {
      await h.boot();
      await h.simulateGroupText({
        chatId: 'oc_team',
        text: '这是给别人的',
        mentionBot: false,
      });

      expect(h.inboundMessages).toHaveLength(0);
    });

    it('混合场景：群里 3 条消息，仅 @ 的 1 条触发', async () => {
      await h.boot();
      await h.simulateGroupText({ text: '路过 1', mentionBot: false });
      await h.simulateGroupText({ text: '@Bot 这条要处理' });
      await h.simulateGroupText({ text: '路过 2', mentionBot: false });

      expect(h.inboundMessages).toHaveLength(1);
      expect(h.inboundMessages[0]!.content).toContain('这条要处理');
    });
  });

  describe('出站', () => {
    it('adapter.sendMessage 私聊 → SDK message.create 收到 open_id', async () => {
      await h.boot();
      await h.adapter.sendMessage('ou_target', '回复内容', 'private');

      expect(h.outboundCalls).toHaveLength(1);
      const call = h.outboundCalls[0]!;
      expect(call.params.receive_id_type).toBe('open_id');
      expect(call.data.receive_id).toBe('ou_target');
      expect(call.data.msg_type).toBe('text');
      // content 是 JSON 字符串，里面包了 text
      const content = JSON.parse(call.data.content as string);
      expect(content.text).toBe('回复内容');
    });

    it('adapter.sendMessage 群聊 → SDK message.create 收到 chat_id', async () => {
      await h.boot();
      await h.adapter.sendMessage('oc_team', '群里说一句', 'group');

      expect(h.outboundCalls).toHaveLength(1);
      const call = h.outboundCalls[0]!;
      expect(call.params.receive_id_type).toBe('chat_id');
      expect(call.data.receive_id).toBe('oc_team');
    });
  });

  describe('生命周期', () => {
    it('disconnect 后入站事件不应触发 handler', async () => {
      await h.boot();
      await h.simulateP2PText({ text: '第一条' });
      expect(h.inboundMessages).toHaveLength(1);

      await h.shutdown();
      // shutdown 后 dispatcher 句柄应已失效；adapter 状态变为 disconnected
      expect(h.adapter.getStatus().status).toBe('disconnected');
      // 重复 shutdown 应幂等（afterEach 还会再调一次）
      await h.shutdown();
    });
  });

  describe('飞书文档评论 → agent dispatch (M13 Phase 5 C1)', () => {
    it('用户在 docx 上评论 → handler 收到带 feishuDoc 的 ChannelMessage', async () => {
      await h.boot();
      await h.simulateDocComment({
        fileToken: 'doc_tok_a',
        fileType: 'docx',
        commentId: 'cmt_1',
        fromOpenId: 'ou_alice',
        content: '这段写得不对',
      });

      expect(h.inboundMessages).toHaveLength(1);
      const msg = h.inboundMessages[0]!;
      expect(msg.peerId).toBe('doc:doc_tok_a');
      expect(msg.content).toBe('这段写得不对');
      expect(msg.feishuDoc).toEqual({
        fileToken: 'doc_tok_a',
        fileType: 'docx',
        commentId: 'cmt_1',
        isWhole: false,
      });
    });

    it('bot 自己写的评论被过滤（防回灌死循环）', async () => {
      await h.boot();
      await h.simulateDocComment({
        fileToken: 'tok',
        fromOpenId: 'ou_bot', // 与 harness 默认 botOpenId 一致
        content: 'bot self',
      });
      expect(h.inboundMessages).toHaveLength(0);
    });
  });

  describe('debounce coalescer 端到端', () => {
    it('启用 debounce 后连发 3 条文本：handler 只调 1 次（合并）', async () => {
      vi.useFakeTimers();
      const h2 = new FeishuTestHarness({ debounceEnabled: true });
      try {
        await h2.boot();
        await h2.simulateP2PText({ text: '你好' });
        await vi.advanceTimersByTimeAsync(1000);
        await h2.simulateP2PText({ text: '我想问一下' });
        await vi.advanceTimersByTimeAsync(1000);
        await h2.simulateP2PText({ text: '天气怎么样' });
        // 还在安静窗口内：handler 未被调用
        expect(h2.inboundMessages).toHaveLength(0);

        // 推进过安静窗口
        await vi.advanceTimersByTimeAsync(5000);
        expect(h2.inboundMessages).toHaveLength(1);
        expect(h2.inboundMessages[0]!.content).toBe('你好\n我想问一下\n天气怎么样');
      } finally {
        await h2.shutdown();
        vi.useRealTimers();
      }
    });
  });
});
