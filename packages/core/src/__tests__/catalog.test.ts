/**
 * Catalog 元数据守护测试
 *
 * 不重复 forward-compat 的算法测试——仅锁定关键 model 的元数据
 * （reasoning / isDefault / 关键能力位），防止后续清单更新无意中改坏。
 *
 * 加新模型时不强制改这个文件；但若改动了 isDefault 漂移、reasoning 位翻转，
 * CI 应当显式提示。
 */

import { describe, it, expect } from 'vitest';
import {
  getAllProviderExtensions,
  lookupModelDefinition,
} from '../provider/extensions/index.js';

describe('catalog: 全局结构', () => {
  it('内置 provider 数量 = 8', () => {
    expect(getAllProviderExtensions().length).toBe(8);
  });

  it('每个 provider 至多一个 isDefault model', () => {
    for (const p of getAllProviderExtensions()) {
      const defaults = p.models.filter(m => m.isDefault);
      expect(defaults.length, `provider ${p.id} 有 ${defaults.length} 个 default`).toBeLessThanOrEqual(1);
    }
  });

  it('所有 provider 至少有一个 chat 模型（非 embedding）', () => {
    for (const p of getAllProviderExtensions()) {
      const chatModels = p.models.filter(m => m.dimension === undefined);
      expect(chatModels.length, `provider ${p.id} 没有 chat 模型`).toBeGreaterThan(0);
    }
  });
});

describe('catalog: Anthropic', () => {
  it('claude-opus-4-7 是当前默认旗舰', () => {
    const def = lookupModelDefinition('anthropic', 'claude-opus-4-7');
    expect(def?.isDefault).toBe(true);
    expect(def?.reasoning).toBe(true);
    expect(def?.contextWindow).toBe(1_000_000);
    expect(def?.input).toContain('image');
  });

  it('4.6 / 4.5 系列保留可选', () => {
    expect(lookupModelDefinition('anthropic', 'claude-opus-4-6')?.reasoning).toBe(true);
    expect(lookupModelDefinition('anthropic', 'claude-haiku-4-5')?.reasoning).toBe(true);
  });
});

describe('catalog: OpenAI', () => {
  it('gpt-5.5 是当前默认旗舰', () => {
    const def = lookupModelDefinition('openai', 'gpt-5.5');
    expect(def?.isDefault).toBe(true);
    expect(def?.reasoning).toBe(true);
    expect(def?.input).toContain('image');
  });

  it('gpt-5.5-pro 已收录', () => {
    expect(lookupModelDefinition('openai', 'gpt-5.5-pro')?.reasoning).toBe(true);
  });

  it('embedding 系列保留', () => {
    const small = lookupModelDefinition('openai', 'text-embedding-3-small');
    expect(small?.dimension).toBe(1536);
    const large = lookupModelDefinition('openai', 'text-embedding-3-large');
    expect(large?.dimension).toBe(3072);
  });
});

describe('catalog: Qwen 推理元数据修复', () => {
  it('qwen3.5-plus 支持推理（通过 enable_thinking）', () => {
    expect(lookupModelDefinition('qwen', 'qwen3.5-plus')?.reasoning).toBe(true);
  });

  it('qwen3.5-flash 支持推理', () => {
    expect(lookupModelDefinition('qwen', 'qwen3.5-flash')?.reasoning).toBe(true);
  });

  it('qwen3-max 支持推理', () => {
    expect(lookupModelDefinition('qwen', 'qwen3-max')?.reasoning).toBe(true);
  });

  it('qwen3-coder 系列不开思考（编码专用，无推理模式）', () => {
    expect(lookupModelDefinition('qwen', 'qwen3-coder-plus')?.reasoning).toBeFalsy();
    expect(lookupModelDefinition('qwen', 'qwen3-coder-next')?.reasoning).toBeFalsy();
  });
});

describe('catalog: 国产 provider 元数据', () => {
  it('GLM-5 默认开启 reasoning', () => {
    expect(lookupModelDefinition('glm', 'glm-5')?.reasoning).toBe(true);
  });

  it('Kimi K2.5 默认（多模态、不开 reasoning）', () => {
    const def = lookupModelDefinition('kimi', 'kimi-k2.5');
    expect(def?.isDefault).toBe(true);
    expect(def?.input).toContain('image');
  });

  it('Kimi K2 Thinking 系列开 reasoning', () => {
    expect(lookupModelDefinition('kimi', 'kimi-k2-thinking')?.reasoning).toBe(true);
  });

  it('DeepSeek V4 系列开 reasoning（1M context, 384K output）', () => {
    const flash = lookupModelDefinition('deepseek', 'deepseek-v4-flash');
    expect(flash?.reasoning).toBe(true);
    expect(flash?.contextWindow).toBe(1_000_000);
    expect(flash?.maxOutputLimit).toBe(384_000);
  });

  it('Doubao Seed 2.0 Pro 开 reasoning', () => {
    expect(lookupModelDefinition('doubao', 'doubao-seed-2-0-pro')?.reasoning).toBe(true);
  });

  it('MiniMax M2.7 开 reasoning', () => {
    expect(lookupModelDefinition('minimax', 'MiniMax-M2.7')?.reasoning).toBe(true);
  });
});
