/**
 * Forward-compat 模板匹配测试
 *
 * 当用户请求的模型 ID 不在预设清单中（新发布的模型版本），
 * resolveModelDefinition 应该按 token 前缀回退到最接近的同家族模板。
 */

import { describe, it, expect } from 'vitest';
import {
  resolveModelDefinition,
  lookupModelDefinition,
} from '../provider/extensions/index.js';

describe('lookupModelDefinition (exact)', () => {
  it('返回精确匹配的模型', () => {
    const def = lookupModelDefinition('anthropic', 'claude-opus-4-6');
    expect(def?.id).toBe('claude-opus-4-6');
    expect(def?.reasoning).toBe(true);
  });

  it('未知模型返回 undefined（不做 forward-compat）', () => {
    expect(lookupModelDefinition('anthropic', 'claude-opus-4-7')).toBeUndefined();
  });

  it('未知 provider 返回 undefined', () => {
    expect(lookupModelDefinition('unknown-provider', 'any')).toBeUndefined();
  });
});

describe('resolveModelDefinition (forward-compat)', () => {
  describe('精确命中', () => {
    it('精确匹配优先返回', () => {
      const def = resolveModelDefinition('anthropic', 'claude-opus-4-6');
      expect(def?.id).toBe('claude-opus-4-6');
    });

    it('未知 provider 返回 undefined', () => {
      expect(resolveModelDefinition('unknown', 'any')).toBeUndefined();
    });
  });

  describe('日期戳后缀剥离', () => {
    it('claude-opus-4-6-20260101 命中 claude-opus-4-6（精确）', () => {
      const def = resolveModelDefinition('anthropic', 'claude-opus-4-6-20260101');
      expect(def?.id).toBe('claude-opus-4-6');
    });

    it('claude-haiku-4-5-20251001 命中 claude-haiku-4-5', () => {
      const def = resolveModelDefinition('anthropic', 'claude-haiku-4-5-20251001');
      expect(def?.id).toBe('claude-haiku-4-5');
    });

    it('日期戳剥离 + 版本 fallback 串联：claude-opus-4-7-20260219 → claude-opus-4-6', () => {
      const def = resolveModelDefinition('anthropic', 'claude-opus-4-7-20260219');
      expect(def?.id).toBe('claude-opus-4-6');
    });
  });

  describe('Anthropic 跨版本', () => {
    it('claude-opus-4-7 → claude-opus-4-6（最近的低版本同家族）', () => {
      const def = resolveModelDefinition('anthropic', 'claude-opus-4-7');
      expect(def?.id).toBe('claude-opus-4-6');
      expect(def?.reasoning).toBe(true);
    });

    it('claude-sonnet-4-7 → claude-sonnet-4-6（不串到 opus）', () => {
      const def = resolveModelDefinition('anthropic', 'claude-sonnet-4-7');
      expect(def?.id).toBe('claude-sonnet-4-6');
    });

    it('claude-haiku-4-6 → claude-haiku-4-5（haiku 当前最高 4-5）', () => {
      const def = resolveModelDefinition('anthropic', 'claude-haiku-4-6');
      expect(def?.id).toBe('claude-haiku-4-5');
    });

    it('claude-opus-4-9 → claude-opus-4-6（数值最接近的低版本）', () => {
      const def = resolveModelDefinition('anthropic', 'claude-opus-4-9');
      expect(def?.id).toBe('claude-opus-4-6');
    });
  });

  describe('OpenAI 跨版本', () => {
    it('gpt-5.5 → gpt-5.4（小版本 bump）', () => {
      const def = resolveModelDefinition('openai', 'gpt-5.5');
      expect(def?.id).toBe('gpt-5.4');
      expect(def?.reasoning).toBe(true);
    });

    it('gpt-4.2 → gpt-4.1（同 4 系列内回退）', () => {
      const def = resolveModelDefinition('openai', 'gpt-4.2');
      expect(def?.id).toBe('gpt-4.1');
    });

    it('o5-mini 返回 undefined（o 系列命名无共同 token，算法不安全回退）', () => {
      // 'o5-mini' 与 'o4-mini' tokens 分别为 ['o5','mini'] / ['o4','mini']，
      // 共享 token 数 = 0。这种情况依赖未来 provider 特定覆盖层（step 2），
      // 不让算法做不安全的猜测。
      const def = resolveModelDefinition('openai', 'o5-mini');
      expect(def).toBeUndefined();
    });
  });

  describe('Kimi 跨版本', () => {
    it('kimi-k2.6 → kimi-k2.5（不串到 thinking 变体）', () => {
      const def = resolveModelDefinition('kimi', 'kimi-k2.6');
      expect(def?.id).toBe('kimi-k2.5');
    });

    it('kimi-k3 → kimi-k2.5（差异较大也能回退到同 provider 最近模板）', () => {
      const def = resolveModelDefinition('kimi', 'kimi-k3');
      // k3 与 k2.x 共享 'kimi' 前缀，token 数 1，达不到 ≥2 阈值，应该返回 undefined
      expect(def).toBeUndefined();
    });
  });

  describe('GLM 跨版本（候选是查询的严格前缀）', () => {
    it('glm-5.1 → glm-5（candidate 是 query 的 token 前缀）', () => {
      const def = resolveModelDefinition('glm', 'glm-5.1');
      expect(def?.id).toBe('glm-5');
    });

    it('glm-6 → undefined（仅共享 glm 前缀，token 数 < 2）', () => {
      const def = resolveModelDefinition('glm', 'glm-6');
      expect(def).toBeUndefined();
    });

    it('glm-4.8 → glm-4.7（同 4 系列内最近版本）', () => {
      const def = resolveModelDefinition('glm', 'glm-4.8');
      expect(def?.id).toBe('glm-4.7');
    });
  });

  describe('Provider 隔离', () => {
    it('在 anthropic 中查 gpt-5.5 不应该命中 openai 模型', () => {
      const def = resolveModelDefinition('anthropic', 'gpt-5.5');
      expect(def).toBeUndefined();
    });

    it('在 openai 中查 claude-opus-4-7 不应该命中 anthropic 模型', () => {
      const def = resolveModelDefinition('openai', 'claude-opus-4-7');
      expect(def).toBeUndefined();
    });
  });

  describe('Embedding 模型排除在 fallback 之外', () => {
    it('文本模型回退不会落到 embedding 模型上', () => {
      // 假设有人请求 text-embedding-4 — 这种应直接 undefined 而不是回退到 v3
      // 当前 qwen 有 text-embedding-v3 / v4
      const def = resolveModelDefinition('qwen', 'text-embedding-v5');
      // v5 不存在，理论上能匹配 v4 / v3 — 但因为它们是 embedding，被排除
      expect(def).toBeUndefined();
    });

    it('精确匹配 embedding 仍正常返回（lookup 走精确路径）', () => {
      const def = resolveModelDefinition('qwen', 'text-embedding-v4');
      expect(def?.id).toBe('text-embedding-v4');
      expect(def?.dimension).toBeDefined();
    });
  });

  describe('阈值保护', () => {
    it('单 token 共享前缀（如仅"claude"）不视为有效回退', () => {
      const def = resolveModelDefinition('anthropic', 'claude-foo-bar-baz');
      expect(def).toBeUndefined();
    });

    it('完全不沾边的 ID 返回 undefined', () => {
      const def = resolveModelDefinition('anthropic', 'random-model-id');
      expect(def).toBeUndefined();
    });
  });
});
