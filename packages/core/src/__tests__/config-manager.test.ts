import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { ConfigManager } from '../infrastructure/config-manager.js';
import type { EvoClawConfig } from '@evoclaw/shared';

/** 生成临时配置文件路径 */
function tmpConfigPath(): string {
  const dir = path.join(os.tmpdir(), `evoclaw-config-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'evo_claw.json');
}

/** 完整测试配置 */
const FULL_CONFIG: EvoClawConfig = {
  providers: {
    minimax: {
      name: 'MiniMax',
      baseUrl: 'https://api.minimaxi.com/v1',
      apiKey: 'sk-test-minimax',
    },
    qwen: {
      name: '通义千问',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: 'sk-test-qwen',
    },
  },
  models: {
    default: { provider: 'minimax', modelId: 'MiniMax-M2.5-highspeed' },
    embedding: { provider: 'qwen', modelId: 'text-embedding-v4', dimension: 1056 },
  },
};

describe('ConfigManager', () => {
  let configPath: string;

  beforeEach(() => {
    configPath = tmpConfigPath();
  });

  afterEach(() => {
    try {
      const dir = path.dirname(configPath);
      if (dir.includes(os.tmpdir())) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch { /* ignore */ }
  });

  it('配置文件不存在时返回空配置', () => {
    const cm = new ConfigManager(configPath);
    expect(cm.exists()).toBe(false);
    const config = cm.getConfig();
    expect(config.providers).toEqual({});
    expect(config.models.default.provider).toBe('');
  });

  it('updateConfig 应写入文件并可重新加载', () => {
    const cm = new ConfigManager(configPath);
    cm.updateConfig(FULL_CONFIG);

    expect(cm.exists()).toBe(true);

    // 重新加载验证
    const cm2 = new ConfigManager(configPath);
    const config = cm2.getConfig();
    expect(config.providers.minimax?.apiKey).toBe('sk-test-minimax');
    expect(config.models.default.modelId).toBe('MiniMax-M2.5-highspeed');
  });

  it('validate 完整配置应通过', () => {
    const cm = new ConfigManager(configPath);
    cm.updateConfig(FULL_CONFIG);

    const result = cm.validate();
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('validate 空配置应返回缺失项', () => {
    const cm = new ConfigManager(configPath);
    const result = cm.validate();
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('models.default.provider');
    expect(result.missing).toContain('models.default.modelId');
  });

  it('validate 缺少 Provider 配置应报错', () => {
    const cm = new ConfigManager(configPath);
    cm.updateConfig({
      providers: {},
      models: {
        default: { provider: 'minimax', modelId: 'test-model' },
      },
    });
    const result = cm.validate();
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('providers.minimax');
  });

  it('validate 缺少 apiKey 应报错', () => {
    const cm = new ConfigManager(configPath);
    cm.updateConfig({
      providers: {
        minimax: { name: 'MiniMax', baseUrl: 'https://api.minimaxi.com/v1', apiKey: '' },
      },
      models: {
        default: { provider: 'minimax', modelId: 'test-model' },
      },
    });
    const result = cm.validate();
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('providers.minimax.apiKey');
  });

  it('getDefaultApiKey 应返回默认 Provider 的 API Key', () => {
    const cm = new ConfigManager(configPath);
    cm.updateConfig(FULL_CONFIG);
    expect(cm.getDefaultApiKey()).toBe('sk-test-minimax');
  });

  it('getDefaultBaseUrl 应返回默认 Provider 的 Base URL', () => {
    const cm = new ConfigManager(configPath);
    cm.updateConfig(FULL_CONFIG);
    expect(cm.getDefaultBaseUrl()).toBe('https://api.minimaxi.com/v1');
  });

  it('getApiKey 应返回指定 Provider 的 API Key', () => {
    const cm = new ConfigManager(configPath);
    cm.updateConfig(FULL_CONFIG);
    expect(cm.getApiKey('qwen')).toBe('sk-test-qwen');
    expect(cm.getApiKey('nonexistent')).toBe('');
  });

  it('getEmbeddingConfig 应返回 Embedding 配置', () => {
    const cm = new ConfigManager(configPath);
    cm.updateConfig(FULL_CONFIG);
    const emb = cm.getEmbeddingConfig();
    expect(emb).toBeDefined();
    expect(emb!.provider).toBe('qwen');
    expect(emb!.modelId).toBe('text-embedding-v4');
    expect(emb!.dimension).toBe(1056);
  });

  it('setProvider 应单独添加 Provider', () => {
    const cm = new ConfigManager(configPath);
    cm.updateConfig(FULL_CONFIG);
    cm.setProvider('deepseek', { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-ds' });

    const config = cm.getConfig();
    expect(config.providers.deepseek?.apiKey).toBe('sk-ds');
    // 原有配置不变
    expect(config.providers.minimax?.apiKey).toBe('sk-test-minimax');
  });

  it('removeProvider 应删除 Provider', () => {
    const cm = new ConfigManager(configPath);
    cm.updateConfig(FULL_CONFIG);
    cm.removeProvider('qwen');

    expect(cm.getProvider('qwen')).toBeUndefined();
    expect(cm.getProvider('minimax')).toBeDefined();
  });

  it('reload 应从磁盘重新加载', () => {
    const cm = new ConfigManager(configPath);
    cm.updateConfig(FULL_CONFIG);

    // 手动修改文件
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    raw.models.default.modelId = 'changed-model';
    fs.writeFileSync(configPath, JSON.stringify(raw));

    // reload 前
    expect(cm.getDefaultModelId()).toBe('MiniMax-M2.5-highspeed');

    // reload 后
    cm.reload();
    expect(cm.getDefaultModelId()).toBe('changed-model');
  });

  it('getProviderIds 应返回所有 Provider ID', () => {
    const cm = new ConfigManager(configPath);
    cm.updateConfig(FULL_CONFIG);
    const ids = cm.getProviderIds();
    expect(ids).toContain('minimax');
    expect(ids).toContain('qwen');
  });

  it('配置文件目录不存在时应自动创建', () => {
    const deepPath = path.join(os.tmpdir(), `evoclaw-deep-${crypto.randomUUID()}`, 'sub', 'evo_claw.json');
    const cm = new ConfigManager(deepPath);
    cm.updateConfig(FULL_CONFIG);
    expect(fs.existsSync(deepPath)).toBe(true);
    // 清理
    fs.rmSync(path.dirname(path.dirname(deepPath)), { recursive: true, force: true });
  });
});
