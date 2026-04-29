/**
 * Catalog 元数据守护测试
 *
 * 不重复 forward-compat 的算法测试——仅锁定关键 model 的元数据
 * （thinkingLevels / defaultThinkLevel / isDefault / 关键能力位），防止后续
 * 清单更新无意中改坏。
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

  it('thinkingLevels 必含 off 且 defaultThinkLevel 必须在数组内', () => {
    for (const p of getAllProviderExtensions()) {
      for (const m of p.models) {
        if (!m.thinkingLevels) continue;
        expect(m.thinkingLevels, `${p.id}/${m.id} thinkingLevels 缺 off`).toContain('off');
        if (m.defaultThinkLevel !== undefined) {
          expect(m.thinkingLevels, `${p.id}/${m.id} defaultThinkLevel=${m.defaultThinkLevel} 不在 thinkingLevels 内`).toContain(m.defaultThinkLevel);
        }
      }
    }
  });
});

describe('catalog: Anthropic', () => {
  it('claude-opus-4-7 是当前默认旗舰，支持 adaptive thinking', () => {
    const def = lookupModelDefinition('anthropic', 'claude-opus-4-7');
    expect(def?.isDefault).toBe(true);
    expect(def?.defaultThinkLevel).toBe('adaptive');
    expect(def?.thinkingLevels).toContain('adaptive');
    expect(def?.thinkingLevels).toContain('xhigh');
    expect(def?.thinkingLevels).toContain('max');
    expect(def?.contextWindow).toBe(1_000_000);
    expect(def?.input).toContain('image');
  });

  it('4.6 系列默认走 adaptive', () => {
    expect(lookupModelDefinition('anthropic', 'claude-opus-4-6')?.defaultThinkLevel).toBe('adaptive');
    expect(lookupModelDefinition('anthropic', 'claude-sonnet-4-6')?.defaultThinkLevel).toBe('adaptive');
  });

  it('4.5 系列默认 low（B 层企业默认；不支持 adaptive 走 enabled+budget）', () => {
    const opus45 = lookupModelDefinition('anthropic', 'claude-opus-4-5');
    expect(opus45?.defaultThinkLevel).toBe('low');
    expect(opus45?.thinkingLevels).not.toContain('adaptive');
    expect(lookupModelDefinition('anthropic', 'claude-haiku-4-5')?.defaultThinkLevel).toBe('low');
  });
});

describe('catalog: OpenAI', () => {
  it('gpt-5.5 是当前默认旗舰，企业默认 low（用户可一键 on 提升到 high）', () => {
    const def = lookupModelDefinition('openai', 'gpt-5.5');
    expect(def?.isDefault).toBe(true);
    expect(def?.defaultThinkLevel).toBe('low');
    expect(def?.input).toContain('image');
  });

  it('gpt-5.5-pro 已收录（企业默认 low）', () => {
    expect(lookupModelDefinition('openai', 'gpt-5.5-pro')?.defaultThinkLevel).toBe('low');
  });

  it('o3 / o4-mini 是纯推理模型，保持默认 high', () => {
    expect(lookupModelDefinition('openai', 'o3')?.defaultThinkLevel).toBe('high');
    expect(lookupModelDefinition('openai', 'o4-mini')?.defaultThinkLevel).toBe('high');
  });

  it('gpt-4.1 / gpt-4o 系列无 thinking', () => {
    expect(lookupModelDefinition('openai', 'gpt-4.1')?.thinkingLevels).toBeUndefined();
    expect(lookupModelDefinition('openai', 'gpt-4o')?.thinkingLevels).toBeUndefined();
  });

  it('embedding 系列保留', () => {
    const small = lookupModelDefinition('openai', 'text-embedding-3-small');
    expect(small?.dimension).toBe(1536);
    const large = lookupModelDefinition('openai', 'text-embedding-3-large');
    expect(large?.dimension).toBe(3072);
  });
});

describe('catalog: Qwen', () => {
  it('qwen3.6-plus 是当前默认旗舰，多模态 + 二元思考', () => {
    const def = lookupModelDefinition('qwen', 'qwen3.6-plus');
    expect(def?.isDefault).toBe(true);
    expect(def?.thinkingLevels).toEqual(['off', 'high']);
    expect(def?.defaultThinkLevel).toBe('high');
    expect(def?.input).toContain('image');
  });

  it('qwen3.6-flash 也支持二元思考', () => {
    expect(lookupModelDefinition('qwen', 'qwen3.6-flash')?.defaultThinkLevel).toBe('high');
  });

  it('qwen3.5-plus / flash 二元思考开关', () => {
    expect(lookupModelDefinition('qwen', 'qwen3.5-plus')?.thinkingLevels).toEqual(['off', 'high']);
    expect(lookupModelDefinition('qwen', 'qwen3.5-flash')?.defaultThinkLevel).toBe('high');
  });

  it('qwen3-max 二元思考开关', () => {
    expect(lookupModelDefinition('qwen', 'qwen3-max')?.defaultThinkLevel).toBe('high');
  });

  it('qwen3-coder 系列不开思考（编码专用，无推理模式）', () => {
    expect(lookupModelDefinition('qwen', 'qwen3-coder-plus')?.thinkingLevels).toBeUndefined();
    expect(lookupModelDefinition('qwen', 'qwen3-coder-next')?.thinkingLevels).toBeUndefined();
  });
});

describe('catalog: 国产 provider 元数据', () => {
  it('GLM-5.1 是当前默认旗舰（国产策略默认 high）', () => {
    const def = lookupModelDefinition('glm', 'glm-5.1');
    expect(def?.isDefault).toBe(true);
    expect(def?.defaultThinkLevel).toBe('high');
    expect(def?.contextWindow).toBe(204_800);
  });

  it('GLM-5 已不是 default 但仍可用（国产策略默认 high）', () => {
    const def = lookupModelDefinition('glm', 'glm-5');
    expect(def?.isDefault).toBeFalsy();
    expect(def?.defaultThinkLevel).toBe('high');
  });

  it('Kimi K2.6 是当前默认旗舰（编码焦点、二元 thinking、text only）', () => {
    const def = lookupModelDefinition('kimi', 'kimi-k2.6');
    expect(def?.isDefault).toBe(true);
    expect(def?.thinkingLevels).toEqual(['off', 'high']);
    expect(def?.defaultThinkLevel).toBe('high');
    expect(def?.input).not.toContain('image');
  });

  it('Kimi K2.5 已不是 default 但保留多模态', () => {
    const def = lookupModelDefinition('kimi', 'kimi-k2.5');
    expect(def?.isDefault).toBeFalsy();
    expect(def?.input).toContain('image');
  });

  it('Kimi K2 Thinking 系列开二元 thinking', () => {
    const def = lookupModelDefinition('kimi', 'kimi-k2-thinking');
    expect(def?.thinkingLevels).toEqual(['off', 'high']);
    expect(def?.defaultThinkLevel).toBe('high');
  });

  it('DeepSeek V4 系列企业默认 low（1M context, 384K output）', () => {
    const flash = lookupModelDefinition('deepseek', 'deepseek-v4-flash');
    expect(flash?.defaultThinkLevel).toBe('low');
    expect(flash?.contextWindow).toBe(1_000_000);
    expect(flash?.maxOutputLimit).toBe(384_000);
  });

  it('Doubao Seed 2.0 Pro 国产策略默认 high', () => {
    expect(lookupModelDefinition('doubao', 'doubao-seed-2-0-pro')?.defaultThinkLevel).toBe('high');
  });

  it('MiniMax M2.7 国产策略默认 high', () => {
    expect(lookupModelDefinition('minimax', 'MiniMax-M2.7')?.defaultThinkLevel).toBe('high');
  });
});
