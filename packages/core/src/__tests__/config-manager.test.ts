import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { ConfigManager } from '../infrastructure/config-manager.js';
import type { EvoClawConfig } from '@evoclaw/shared';

function tmpConfigPath(): string {
  const dir = path.join(os.tmpdir(), `evoclaw-config-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'evo_claw.json');
}

const FULL_CONFIG: EvoClawConfig = {
  models: {
    default: 'minimax/MiniMax-M2.5-highspeed',
    embedding: 'qwen/text-embedding-v4',
    providers: {
      minimax: {
        baseUrl: 'https://api.minimaxi.com/v1',
        apiKey: 'sk-test-minimax',
        api: 'openai-completions',
        models: [
          { id: 'MiniMax-M2.5-highspeed', name: 'MiniMax M2.5 Highspeed', reasoning: true, contextWindow: 200000, maxTokens: 8192 },
          { id: 'MiniMax-M2.5', name: 'MiniMax M2.5', contextWindow: 200000, maxTokens: 8192 },
        ],
      },
      qwen: {
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKey: 'sk-test-qwen',
        api: 'openai-completions',
        models: [
          { id: 'qwen-max', name: 'Qwen Max', contextWindow: 32768, maxTokens: 8192 },
          { id: 'text-embedding-v4', name: 'Text Embedding V4', dimension: 1056 },
        ],
      },
    },
  },
};

describe('ConfigManager', () => {
  const paths: string[] = [];
  afterEach(() => {
    for (const p of paths) {
      try {
        const dir = path.dirname(p);
        if (dir.includes(os.tmpdir())) fs.rmSync(dir, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
    paths.length = 0;
  });

  function createManager(): [ConfigManager, string] {
    const p = tmpConfigPath();
    paths.push(p);
    return [new ConfigManager(p), p];
  }

  it('配置文件不存在时返回空配置', () => {
    const [cm] = createManager();
    expect(cm.exists()).toBe(false);
    const config = cm.getConfig();
    expect(config).toEqual({});
  });

  it('updateConfig 应写入文件并可重新加载', () => {
    const [, p] = createManager();
    const cm1 = new ConfigManager(p);
    cm1.updateConfig(FULL_CONFIG);
    expect(cm1.exists()).toBe(true);

    const cm2 = new ConfigManager(p);
    expect(cm2.getDefaultModelId()).toBe('MiniMax-M2.5-highspeed');
    expect(cm2.getDefaultApiKey()).toBe('sk-test-minimax');
  });

  it('validate 完整配置应通过', () => {
    const [cm] = createManager();
    cm.updateConfig(FULL_CONFIG);
    const result = cm.validate();
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('validate 空配置应返回缺失项', () => {
    const [cm] = createManager();
    const result = cm.validate();
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('models');
  });

  it('validate 缺少 default 应报错', () => {
    const [cm] = createManager();
    cm.updateConfig({ models: { providers: {} } });
    const result = cm.validate();
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('models.default');
  });

  it('validate 缺少 Provider 配置应报错', () => {
    const [cm] = createManager();
    cm.updateConfig({ models: { default: 'missing/model', providers: {} } });
    const result = cm.validate();
    expect(result.valid).toBe(false);
    expect(result.missing.some(m => m.includes('missing'))).toBe(true);
  });

  it('validate 缺少 apiKey 应报错', () => {
    const [cm] = createManager();
    cm.updateConfig({
      models: {
        default: 'test/model-1',
        providers: {
          test: { baseUrl: 'https://api.test.com/v1', apiKey: '', api: 'openai-completions', models: [{ id: 'model-1', name: 'M1' }] },
        },
      },
    });
    const result = cm.validate();
    expect(result.valid).toBe(false);
    expect(result.missing.some(m => m.includes('apiKey'))).toBe(true);
  });

  it('validate embedding 缺少 dimension 应报错', () => {
    const [cm] = createManager();
    cm.updateConfig({
      models: {
        default: 'test/chat-model',
        embedding: 'test/emb-model',
        providers: {
          test: {
            baseUrl: 'https://api.test.com/v1', apiKey: 'sk-test', api: 'openai-completions',
            models: [
              { id: 'chat-model', name: 'Chat' },
              { id: 'emb-model', name: 'Emb' }, // 缺少 dimension
            ],
          },
        },
      },
    });
    const result = cm.validate();
    expect(result.valid).toBe(false);
    expect(result.missing.some(m => m.includes('dimension'))).toBe(true);
  });

  it('getDefaultModelRef 应解析 provider/modelId', () => {
    const [cm] = createManager();
    cm.updateConfig(FULL_CONFIG);
    const ref = cm.getDefaultModelRef();
    expect(ref).toEqual({ provider: 'minimax', modelId: 'MiniMax-M2.5-highspeed' });
  });

  it('getDefaultApiKey / getDefaultBaseUrl', () => {
    const [cm] = createManager();
    cm.updateConfig(FULL_CONFIG);
    expect(cm.getDefaultApiKey()).toBe('sk-test-minimax');
    expect(cm.getDefaultBaseUrl()).toBe('https://api.minimaxi.com/v1');
  });

  it('getApiKey 应返回指定 Provider 的 Key', () => {
    const [cm] = createManager();
    cm.updateConfig(FULL_CONFIG);
    expect(cm.getApiKey('qwen')).toBe('sk-test-qwen');
    expect(cm.getApiKey('nonexistent')).toBe('');
  });

  it('getEmbeddingModel 应返回带 dimension 的模型', () => {
    const [cm] = createManager();
    cm.updateConfig(FULL_CONFIG);
    const model = cm.getEmbeddingModel();
    expect(model).toBeDefined();
    expect(model!.id).toBe('text-embedding-v4');
    expect(model!.dimension).toBe(1056);
  });

  it('getEmbeddingApiKey / getEmbeddingBaseUrl', () => {
    const [cm] = createManager();
    cm.updateConfig(FULL_CONFIG);
    expect(cm.getEmbeddingApiKey()).toBe('sk-test-qwen');
    expect(cm.getEmbeddingBaseUrl()).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
  });

  it('setProvider 应添加并持久化', () => {
    const [cm] = createManager();
    cm.updateConfig(FULL_CONFIG);
    cm.setProvider('deepseek', {
      baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-ds', api: 'openai-completions',
      models: [{ id: 'deepseek-chat', name: 'DeepSeek V3' }],
    });
    expect(cm.getProvider('deepseek')?.apiKey).toBe('sk-ds');
    expect(cm.getProvider('minimax')?.apiKey).toBe('sk-test-minimax');
  });

  it('removeProvider 应删除', () => {
    const [cm] = createManager();
    cm.updateConfig(FULL_CONFIG);
    cm.removeProvider('qwen');
    expect(cm.getProvider('qwen')).toBeUndefined();
    expect(cm.getProvider('minimax')).toBeDefined();
  });

  it('reload 应从磁盘重新加载', () => {
    const [cm, p] = createManager();
    cm.updateConfig(FULL_CONFIG);

    const raw = JSON.parse(fs.readFileSync(p, 'utf-8'));
    raw.models.default = 'minimax/MiniMax-M2.5';
    fs.writeFileSync(p, JSON.stringify(raw));

    expect(cm.getDefaultModelId()).toBe('MiniMax-M2.5-highspeed');
    cm.reload();
    expect(cm.getDefaultModelId()).toBe('MiniMax-M2.5');
  });

  it('getProviderIds 应返回所有 ID', () => {
    const [cm] = createManager();
    cm.updateConfig(FULL_CONFIG);
    expect(cm.getProviderIds().sort()).toEqual(['minimax', 'qwen']);
  });

  it('配置文件目录不存在时应自动创建', () => {
    const deepPath = path.join(os.tmpdir(), `evoclaw-deep-${crypto.randomUUID()}`, 'sub', 'evo_claw.json');
    paths.push(deepPath);
    const cm = new ConfigManager(deepPath);
    cm.updateConfig(FULL_CONFIG);
    expect(fs.existsSync(deepPath)).toBe(true);
  });

  it('getDefaultApi 应返回 API 协议', () => {
    const [cm] = createManager();
    cm.updateConfig(FULL_CONFIG);
    expect(cm.getDefaultApi()).toBe('openai-completions');
  });

  it('空配置 getDefaultApiKey 应返回空字符串', () => {
    const [cm] = createManager();
    expect(cm.getDefaultApiKey()).toBe('');
    expect(cm.getDefaultModelId()).toBe('');
    expect(cm.getDefaultProvider()).toBe('');
  });
});
