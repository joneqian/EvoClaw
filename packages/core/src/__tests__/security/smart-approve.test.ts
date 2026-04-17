import { describe, it, expect, vi } from 'vitest';
import {
  evaluateRisk,
  parseSmartDecision,
  shouldEvaluate,
  SmartDecisionCache,
  type SmartLLMCall,
} from '../../security/smart-approve.js';

describe('shouldEvaluate', () => {
  it('high-risk 工具应评估', () => {
    expect(shouldEvaluate('bash')).toBe(true);
    expect(shouldEvaluate('write')).toBe(true);
    expect(shouldEvaluate('edit')).toBe(true);
    expect(shouldEvaluate('web_fetch')).toBe(true);
    expect(shouldEvaluate('send_message')).toBe(true);
  });
  it('low-risk 工具不评估（应通过 AUTO_ALLOW 放行）', () => {
    expect(shouldEvaluate('read')).toBe(false);
    expect(shouldEvaluate('grep')).toBe(false);
    expect(shouldEvaluate('ls')).toBe(false);
    expect(shouldEvaluate('memory_search')).toBe(false);
  });
});

describe('parseSmartDecision', () => {
  it('合法 JSON → 正常解析', () => {
    const r = parseSmartDecision('{"intent":"explore","risk":"none","decision":"approve","reason":"安全"}');
    expect(r.decision).toBe('approve');
    expect(r.reason).toBe('安全');
  });
  it('JSON 包裹在 markdown 中也能提取', () => {
    const r = parseSmartDecision('```json\n{"decision":"deny","reason":"危险"}\n```');
    expect(r.decision).toBe('deny');
  });
  it('非 JSON → escalate', () => {
    const r = parseSmartDecision('I think this is safe.');
    expect(r.decision).toBe('escalate');
  });
  it('decision 字段非法 → escalate', () => {
    const r = parseSmartDecision('{"decision":"maybe","reason":"x"}');
    expect(r.decision).toBe('escalate');
  });
  it('JSON 解析失败 → escalate', () => {
    const r = parseSmartDecision('{not valid json}');
    expect(r.decision).toBe('escalate');
  });
});

describe('SmartDecisionCache', () => {
  it('相同 ctx 命中缓存', () => {
    const cache = new SmartDecisionCache();
    cache.set({ toolName: 'bash', params: { command: 'ls' } }, { decision: 'approve', reason: 'safe' });
    const r = cache.get({ toolName: 'bash', params: { command: 'ls' } });
    expect(r?.decision).toBe('approve');
    expect(r?.cached).toBe(true);
  });
  it('不同 toolName 不互相命中', () => {
    const cache = new SmartDecisionCache();
    cache.set({ toolName: 'bash', params: { command: 'ls' } }, { decision: 'approve', reason: '' });
    expect(cache.get({ toolName: 'write', params: { command: 'ls' } })).toBeUndefined();
  });
  it('不同 params 不互相命中', () => {
    const cache = new SmartDecisionCache();
    cache.set({ toolName: 'bash', params: { command: 'ls' } }, { decision: 'approve', reason: '' });
    expect(cache.get({ toolName: 'bash', params: { command: 'rm -rf /' } })).toBeUndefined();
  });
  it('params key 顺序不影响 cache key', () => {
    const cache = new SmartDecisionCache();
    cache.set({ toolName: 'bash', params: { a: 1, b: 2 } }, { decision: 'approve', reason: '' });
    expect(cache.get({ toolName: 'bash', params: { b: 2, a: 1 } })).toBeDefined();
  });
});

describe('evaluateRisk', () => {
  const mkLLM = (response: string): SmartLLMCall => async () => response;
  const slowLLM = (delayMs: number): SmartLLMCall =>
    () => new Promise((resolve) => setTimeout(() => resolve('{"decision":"approve","reason":"x"}'), delayMs));
  const failLLM: SmartLLMCall = async () => {
    throw new Error('LLM unavailable');
  };

  it('LLM approve → decision approve', async () => {
    const r = await evaluateRisk(
      { toolName: 'bash', params: { command: 'ls -la' } },
      mkLLM('{"decision":"approve","reason":"只读列目录"}'),
    );
    expect(r.decision).toBe('approve');
    expect(r.reason).toContain('只读');
  });

  it('LLM deny → decision deny', async () => {
    const r = await evaluateRisk(
      { toolName: 'bash', params: { command: 'rm -rf /etc' } },
      mkLLM('{"decision":"deny","reason":"破坏系统"}'),
    );
    expect(r.decision).toBe('deny');
  });

  it('LLM escalate → 升级人工', async () => {
    const r = await evaluateRisk(
      { toolName: 'web_fetch', params: { url: 'https://unknown.com' } },
      mkLLM('{"decision":"escalate","reason":"未知域名"}'),
    );
    expect(r.decision).toBe('escalate');
  });

  it('LLM 异常 → escalate（不替用户决策）', async () => {
    const r = await evaluateRisk(
      { toolName: 'bash', params: { command: 'ls' } },
      failLLM,
    );
    expect(r.decision).toBe('escalate');
    expect(r.reason).toContain('LLM unavailable');
  });

  it('LLM 超时 → escalate', async () => {
    const r = await evaluateRisk(
      { toolName: 'bash', params: { command: 'ls' } },
      slowLLM(500),
      undefined,
      100, // 100ms 超时
    );
    expect(r.decision).toBe('escalate');
    expect(r.reason).toContain('超时');
  });

  it('缓存命中跳过 LLM 调用', async () => {
    const cache = new SmartDecisionCache();
    const llm = vi.fn(mkLLM('{"decision":"approve","reason":"x"}'));
    await evaluateRisk({ toolName: 'bash', params: { command: 'ls' } }, llm, cache);
    await evaluateRisk({ toolName: 'bash', params: { command: 'ls' } }, llm, cache);
    await evaluateRisk({ toolName: 'bash', params: { command: 'ls' } }, llm, cache);
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it('escalate 也走缓存（避免重复调用）', async () => {
    const cache = new SmartDecisionCache();
    const llm = vi.fn(mkLLM('{"decision":"escalate","reason":"模糊"}'));
    await evaluateRisk({ toolName: 'bash', params: { command: 'foo' } }, llm, cache);
    await evaluateRisk({ toolName: 'bash', params: { command: 'foo' } }, llm, cache);
    expect(llm).toHaveBeenCalledTimes(1);
  });
});
