import { describe, it, expect } from 'vitest';
import {
  generateSessionKey,
  parseSessionKey,
  isGroupChat,
  isDirectChat,
  isSubAgentSessionKey,
  isCronSessionKey,
  isHeartbeatSessionKey,
  isPrivilegedSessionKey,
} from '../routing/session-key.js';

describe('session-key', () => {
  describe('generateSessionKey', () => {
    it('应该生成完整的 Session Key', () => {
      const key = generateSessionKey('agent-1', 'wechat', 'group', 'room-123');
      expect(key).toBe('agent:agent-1:wechat:group:room-123');
    });

    it('应该使用默认参数', () => {
      const key = generateSessionKey('agent-1');
      expect(key).toBe('agent:agent-1:default:direct:');
    });

    it('应该支持部分参数', () => {
      const key = generateSessionKey('agent-1', 'telegram');
      expect(key).toBe('agent:agent-1:telegram:direct:');
    });

    it('应该支持 channel + chatType 参数', () => {
      const key = generateSessionKey('agent-1', 'feishu', 'group');
      expect(key).toBe('agent:agent-1:feishu:group:');
    });
  });

  describe('parseSessionKey', () => {
    it('应该解析完整的 Session Key', () => {
      const parsed = parseSessionKey('agent:abc-123:wechat:group:room-456');
      expect(parsed).toEqual({
        agentId: 'abc-123',
        channel: 'wechat',
        chatType: 'group',
        peerId: 'room-456',
      });
    });

    it('应该解析最简 Session Key（缺失字段用默认值）', () => {
      const parsed = parseSessionKey('agent:abc-123');
      expect(parsed).toEqual({
        agentId: 'abc-123',
        channel: 'default',
        chatType: 'direct',
        peerId: '',
      });
    });

    it('应该处理空字符串', () => {
      const parsed = parseSessionKey('');
      expect(parsed.agentId).toBe('');
      expect(parsed.channel).toBe('default');
    });

    it('generateSessionKey 和 parseSessionKey 应该互逆', () => {
      const key = generateSessionKey('agent-1', 'telegram', 'direct', 'user-42');
      const parsed = parseSessionKey(key);
      expect(parsed.agentId).toBe('agent-1');
      expect(parsed.channel).toBe('telegram');
      expect(parsed.chatType).toBe('direct');
      expect(parsed.peerId).toBe('user-42');
    });
  });

  describe('isGroupChat', () => {
    it('群聊 Session Key 应返回 true', () => {
      expect(isGroupChat('agent:a:wechat:group:room')).toBe(true);
    });

    it('私聊 Session Key 应返回 false', () => {
      expect(isGroupChat('agent:a:wechat:direct:user')).toBe(false);
    });

    it('缺失 chatType 的 Key 应返回 false（默认 direct）', () => {
      expect(isGroupChat('agent:a')).toBe(false);
    });
  });

  describe('isDirectChat', () => {
    it('私聊 Session Key 应返回 true', () => {
      expect(isDirectChat('agent:a:wechat:direct:user')).toBe(true);
    });

    it('群聊 Session Key 应返回 false', () => {
      expect(isDirectChat('agent:a:wechat:group:room')).toBe(false);
    });

    it('缺失 chatType 的 Key 应返回 true（默认 direct）', () => {
      expect(isDirectChat('agent:a')).toBe(true);
    });
  });

  // P1-A: 受限/特权会话判定 helpers
  describe('isSubAgentSessionKey', () => {
    it('subagent marker 命中', () => {
      expect(isSubAgentSessionKey('agent:abc:local:subagent:task1')).toBe(true);
    });
    it('主 session 不命中', () => {
      expect(isSubAgentSessionKey('agent:abc:default:direct:')).toBe(false);
      expect(isSubAgentSessionKey('agent:abc:feishu:group:room1')).toBe(false);
    });
  });

  describe('isCronSessionKey', () => {
    it('cron marker 命中', () => {
      expect(isCronSessionKey('agent:abc:cron:job-42')).toBe(true);
    });
    it('subagent / 主 session 不命中', () => {
      expect(isCronSessionKey('agent:abc:local:subagent:t1')).toBe(false);
      expect(isCronSessionKey('agent:abc:default:direct:')).toBe(false);
    });
  });

  describe('isHeartbeatSessionKey', () => {
    it('heartbeat marker 命中', () => {
      expect(isHeartbeatSessionKey('agent:abc:default:direct::heartbeat:p1')).toBe(true);
    });
    it('其它 session 不命中', () => {
      expect(isHeartbeatSessionKey('agent:abc:cron:job1')).toBe(false);
      expect(isHeartbeatSessionKey('agent:abc:local:subagent:t1')).toBe(false);
    });
  });

  describe('isPrivilegedSessionKey', () => {
    it('主 session 是特权', () => {
      expect(isPrivilegedSessionKey('agent:abc:default:direct:')).toBe(true);
    });
    it('heartbeat 仍属特权（主 session 派生）', () => {
      expect(isPrivilegedSessionKey('agent:abc:default:direct::heartbeat:p1')).toBe(true);
    });
    it('subagent 不特权', () => {
      expect(isPrivilegedSessionKey('agent:abc:local:subagent:t1')).toBe(false);
    });
    it('cron 不特权', () => {
      expect(isPrivilegedSessionKey('agent:abc:cron:job1')).toBe(false);
    });
  });
});
