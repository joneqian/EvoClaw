import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  handleSlashCommand,
  isSlashCommand,
} from '../channel/adapters/weixin-slash-commands.js';
import type { SlashCommandContext } from '../channel/adapters/weixin-slash-commands.js';

// Mock weixin-api 的 sendTextMessage
vi.mock('../channel/adapters/weixin-api.js', () => ({
  sendTextMessage: vi.fn().mockResolvedValue(undefined),
}));

// Mock logger
vi.mock('../infrastructure/logger.js', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock weixin-debug
const mockToggle = vi.fn();
vi.mock('../channel/adapters/weixin-debug.js', () => ({
  toggleDebugMode: (...args: unknown[]) => mockToggle(...args),
}));

function makeContext(overrides?: Partial<SlashCommandContext>): SlashCommandContext {
  return {
    toUserId: 'user-123',
    contextToken: 'ctx-token-abc',
    credentials: {
      botToken: 'bot-token-xyz',
      ilinkBotId: 'bot-001',
      baseUrl: 'https://ilinkai.weixin.qq.com',
    },
    stateRepo: {
      getState: vi.fn().mockReturnValue(null),
      setState: vi.fn(),
      deleteState: vi.fn(),
    } as any,
    accountId: 'account-001',
    receivedAt: Date.now(),
    eventTimeMs: Date.now() - 100,
    ...overrides,
  };
}

describe('weixin-slash-commands', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // isSlashCommand
  // -----------------------------------------------------------------------

  describe('isSlashCommand', () => {
    it('应识别斜杠开头的文本', () => {
      expect(isSlashCommand('/echo hello')).toBe(true);
      expect(isSlashCommand('/toggle-debug')).toBe(true);
      expect(isSlashCommand('  /echo hello')).toBe(true);
    });

    it('非斜杠开头应返回 false', () => {
      expect(isSlashCommand('hello')).toBe(false);
      expect(isSlashCommand('hello /echo')).toBe(false);
      expect(isSlashCommand('')).toBe(false);
    });
  });

  // -----------------------------------------------------------------------
  // handleSlashCommand
  // -----------------------------------------------------------------------

  describe('handleSlashCommand', () => {
    it('/echo 应回显消息并返回 handled=true', async () => {
      const ctx = makeContext();
      const result = await handleSlashCommand('/echo hello world', ctx);

      expect(result.handled).toBe(true);
      expect(result.response).toBe('hello world');
    });

    it('/echo 无参数时仍返回 handled=true', async () => {
      const ctx = makeContext();
      const result = await handleSlashCommand('/echo', ctx);

      expect(result.handled).toBe(true);
    });

    it('/toggle-debug 应切换 debug 模式', async () => {
      mockToggle.mockReturnValue(true);
      const ctx = makeContext();
      const result = await handleSlashCommand('/toggle-debug', ctx);

      expect(result.handled).toBe(true);
      expect(result.response).toBe('Debug 模式已开启');
      expect(mockToggle).toHaveBeenCalledWith('account-001', ctx.stateRepo);
    });

    it('/toggle-debug 关闭时应返回关闭消息', async () => {
      mockToggle.mockReturnValue(false);
      const ctx = makeContext();
      const result = await handleSlashCommand('/toggle-debug', ctx);

      expect(result.handled).toBe(true);
      expect(result.response).toBe('Debug 模式已关闭');
    });

    it('非斜杠文本应返回 handled=false', async () => {
      const ctx = makeContext();
      const result = await handleSlashCommand('hello world', ctx);

      expect(result.handled).toBe(false);
    });

    it('未知指令应返回 handled=false', async () => {
      const ctx = makeContext();
      const result = await handleSlashCommand('/unknown-cmd', ctx);

      expect(result.handled).toBe(false);
    });

    it('指令应忽略大小写', async () => {
      mockToggle.mockReturnValue(true);
      const ctx = makeContext();
      const result = await handleSlashCommand('/TOGGLE-DEBUG', ctx);

      expect(result.handled).toBe(true);
    });
  });
});
