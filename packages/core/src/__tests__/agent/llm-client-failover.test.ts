/**
 * M6 T1: callLLM failover 集成测试
 *
 * mock ConfigManager + fetch，验证：
 * - 401/429/503 触发 markKeyFailed + 用下一把 key 重试一次
 * - 仅走 pool 时才 failover（单 apiKey 不重试）
 * - 非可重试状态码不 failover
 * - 无 pool（keyId=null）时立即抛出
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { callLLM, LLMHttpError } from '../../agent/llm-client.js';
import type { ConfigManager } from '../../infrastructure/config-manager.js';
import {
  getKeyState,
  clearProviderKeyState,
} from '../../infrastructure/provider-key-state.js';

interface PoolKey {
  id: string;
  apiKey: string;
}

function makeConfigManager(opts: {
  provider?: string;
  baseUrl?: string;
  modelId?: string;
  api?: string;
  /** pool 中每把 key；若无则视为 legacy 单 apiKey */
  poolKeys?: PoolKey[];
  singleApiKey?: string;
}): ConfigManager {
  const provider = opts.provider ?? 'openai';
  const pool = opts.poolKeys ?? null;
  // Failover 顺序：按声明顺序返回未被 exclude 的第一把
  // 签名必须匹配真实 ConfigManager.resolveProviderCredential(providerId, excludeKeyId?)
  const resolve = (_providerId: string, excludeKeyId?: string): { apiKey: string; keyId: string | null } => {
    if (pool) {
      const candidate = pool.find((k) => k.id !== excludeKeyId);
      if (!candidate) return { apiKey: '', keyId: null };
      return { apiKey: candidate.apiKey, keyId: candidate.id };
    }
    return { apiKey: opts.singleApiKey ?? 'single-key', keyId: null };
  };
  return {
    getDefaultApiKey: () => resolve(provider).apiKey,
    getDefaultBaseUrl: () => opts.baseUrl ?? 'https://api.example.com/v1',
    getDefaultModelId: () => opts.modelId ?? 'gpt-4o-mini',
    getDefaultApi: () => opts.api ?? 'openai-completions',
    getDefaultProvider: () => provider,
    resolveProviderCredential: resolve,
  } as unknown as ConfigManager;
}

describe('M6 T1 — callLLM failover', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    clearProviderKeyState('openai');
    clearProviderKeyState('anthropic');
  });

  it('401（auth）触发 failover：主 key 永久禁用 + 用备 key 成功', async () => {
    const cm = makeConfigManager({
      poolKeys: [
        { id: 'primary', apiKey: 'sk-bad' },
        { id: 'backup', apiKey: 'sk-good' },
      ],
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Unauthorized' } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: '成功' } }] }),
      } as Response);

    const result = await callLLM(cm, { systemPrompt: 's', userMessage: 'u' });
    expect(result).toBe('成功');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 第一次用 sk-bad，第二次用 sk-good
    const headers0 = fetchMock.mock.calls[0][1]!.headers as Record<string, string>;
    const headers1 = fetchMock.mock.calls[1][1]!.headers as Record<string, string>;
    expect(headers0['Authorization']).toContain('sk-bad');
    expect(headers1['Authorization']).toContain('sk-good');
    // primary 被永久禁用
    expect(getKeyState('openai', 'primary').disabled).toBe(true);
    expect(getKeyState('openai', 'primary').reason).toBe('auth');
    // backup 未受影响
    expect(getKeyState('openai', 'backup').disabled).toBe(false);
  });

  it('429（rate-limit）触发 failover + 主 key cooldown（非永久禁用）', async () => {
    const cm = makeConfigManager({
      poolKeys: [
        { id: 'primary', apiKey: 'sk-limited' },
        { id: 'backup', apiKey: 'sk-good' },
      ],
    });

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 429, text: async () => 'Too Many Requests' } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'OK' } }] }),
      } as Response);

    const result = await callLLM(cm, { systemPrompt: 's', userMessage: 'u' });
    expect(result).toBe('OK');

    const state = getKeyState('openai', 'primary');
    expect(state.disabled).toBe(false);
    expect(state.cooldownUntil).toBeTruthy();
    expect(state.reason).toBe('rate-limit');
  });

  it('503（service-unavailable）触发 failover', async () => {
    const cm = makeConfigManager({
      poolKeys: [
        { id: 'primary', apiKey: 'sk-p' },
        { id: 'backup', apiKey: 'sk-b' },
      ],
    });

    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 503, text: async () => 'Service Unavailable' } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'OK' } }] }),
      } as Response);

    const result = await callLLM(cm, { systemPrompt: 's', userMessage: 'u' });
    expect(result).toBe('OK');
    expect(getKeyState('openai', 'primary').reason).toBe('service-unavailable');
  });

  it('无 pool（keyId=null）时 401 立即抛出，不 failover', async () => {
    const cm = makeConfigManager({ singleApiKey: 'sk-single' });

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' } as Response);

    await expect(callLLM(cm, { systemPrompt: 's', userMessage: 'u' })).rejects.toThrow(LLMHttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('非可重试状态码（500）不 failover', async () => {
    const cm = makeConfigManager({
      poolKeys: [
        { id: 'primary', apiKey: 'sk-p' },
        { id: 'backup', apiKey: 'sk-b' },
      ],
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: false, status: 500, text: async () => 'Server Error' } as Response);

    await expect(callLLM(cm, { systemPrompt: 's', userMessage: 'u' })).rejects.toThrow(LLMHttpError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getKeyState('openai', 'primary').failCount).toBe(0);
  });

  it('两把 key 都失败时抛出（仅重试 1 次）', async () => {
    const cm = makeConfigManager({
      poolKeys: [
        { id: 'primary', apiKey: 'sk-p' },
        { id: 'backup', apiKey: 'sk-b' },
      ],
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' } as Response);

    await expect(callLLM(cm, { systemPrompt: 's', userMessage: 'u' })).rejects.toThrow(LLMHttpError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 两把 key 都被标记失败
    expect(getKeyState('openai', 'primary').disabled).toBe(true);
    expect(getKeyState('openai', 'backup').disabled).toBe(true);
  });

  it('Anthropic 协议的 401 也走同一套 failover', async () => {
    const cm = makeConfigManager({
      api: 'anthropic-messages',
      provider: 'anthropic',
      poolKeys: [
        { id: 'primary', apiKey: 'sk-ant-p' },
        { id: 'backup', apiKey: 'sk-ant-b' },
      ],
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce({ ok: false, status: 401, text: async () => 'Bad' } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ content: [{ type: 'text', text: '好' }] }),
      } as Response);

    const result = await callLLM(cm, { systemPrompt: 's', userMessage: 'u' });
    expect(result).toBe('好');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Anthropic 用 x-api-key 头
    const h0 = fetchMock.mock.calls[0][1]!.headers as Record<string, string>;
    const h1 = fetchMock.mock.calls[1][1]!.headers as Record<string, string>;
    expect(h0['x-api-key']).toBe('sk-ant-p');
    expect(h1['x-api-key']).toBe('sk-ant-b');
  });
});
