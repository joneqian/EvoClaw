import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { FALLBACK_MODEL } from '@evoclaw/shared';
import { resolveModel } from '../provider/model-resolver.js';
import {
  clearProviders,
  registerQwen,
  registerGLM,
} from '../provider/provider-registry.js';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';

/** 读取初始迁移 SQL */
const MIGRATION_SQL = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '001_initial.sql'),
  'utf-8'
);

/** 生成临时数据库路径 */
function tmpDbPath(): string {
  const dir = path.join(os.tmpdir(), `evoclaw-resolver-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'test.db');
}

describe('ModelResolver', () => {
  const stores: SqliteStore[] = [];

  function createStore(): SqliteStore {
    const dbPath = tmpDbPath();
    const store = new SqliteStore(dbPath);
    store.exec(MIGRATION_SQL);
    stores.push(store);
    return store;
  }

  beforeEach(() => {
    clearProviders();
  });

  afterEach(() => {
    for (const store of stores) {
      try {
        const dbPath = store.dbPath;
        store.close();
        if (dbPath.includes(os.tmpdir())) {
          fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
        }
      } catch {
        // 忽略清理错误
      }
    }
    stores.length = 0;
  });

  it('Agent 指定模型应该优先', () => {
    registerQwen('qwen-key');

    const result = resolveModel({
      agentModelId: 'qwen3-max',
      agentProvider: 'qwen',
    });

    expect(result.provider).toBe('qwen');
    expect(result.modelId).toBe('qwen3-max');
    expect(result.apiKeyRef).toBe('qwen-key');
    expect(result.baseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
  });

  it('内置 Provider 的 Agent 指定模型应该正确解析', () => {
    const result = resolveModel({
      agentModelId: 'gpt-4o',
      agentProvider: 'openai',
    });

    expect(result.provider).toBe('openai');
    expect(result.modelId).toBe('gpt-4o');
    expect(result.apiKeyRef).toBe('openai-api-key');
    expect(result.baseUrl).toBe(''); // 内置 Provider 无需 baseUrl
  });

  it('用户默认模型应该作为第二优先级', () => {
    const store = createStore();

    // 插入用户默认模型配置
    store.run(
      `INSERT INTO model_configs (id, provider, model_id, api_key_ref, config_json, is_default)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'cfg-1', 'qwen', 'qwen-max', 'qwen-key-ref',
      JSON.stringify({ baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1' }),
      1
    );

    const result = resolveModel({ store });

    expect(result.provider).toBe('qwen');
    expect(result.modelId).toBe('qwen-max');
    expect(result.apiKeyRef).toBe('qwen-key-ref');
    expect(result.baseUrl).toBe('https://dashscope.aliyuncs.com/compatible-mode/v1');
  });

  it('注册 Provider 的默认模型应该作为第三优先级', () => {
    registerQwen('qwen-key');
    registerGLM('glm-key');

    // 无 Agent 配置、无 DB 默认配置时，使用第一个 Provider 的默认模型
    const result = resolveModel({});

    expect(result.provider).toBe('qwen');
    expect(result.modelId).toBe('qwen3.6-plus');
    expect(result.apiKeyRef).toBe('qwen-key');
  });

  it('没有任何配置时应该回退到 FALLBACK_MODEL', () => {
    const result = resolveModel({});

    expect(result.provider).toBe(FALLBACK_MODEL.provider);
    expect(result.modelId).toBe(FALLBACK_MODEL.modelId);
    expect(result.apiKeyRef).toBe('openai-api-key');
    expect(result.baseUrl).toBe('https://api.openai.com/v1');
  });

  it('Agent 指定了不存在的 Provider 时应该降级', () => {
    // 既没注册也不是内置 Provider
    const result = resolveModel({
      agentModelId: 'some-model',
      agentProvider: 'non-existent-provider',
    });

    // 应该降级到 fallback
    expect(result.provider).toBe(FALLBACK_MODEL.provider);
    expect(result.modelId).toBe(FALLBACK_MODEL.modelId);
  });

  it('Agent 指定了不存在的模型 ID 时应该降级', () => {
    registerQwen('qwen-key');

    const result = resolveModel({
      agentModelId: 'non-existent-model',
      agentProvider: 'qwen',
    });

    // 无法匹配具体模型，降级到 Provider 默认模型
    expect(result.provider).toBe('qwen');
    expect(result.modelId).toBe('qwen3.6-plus');
  });

  it('DB 默认配置 config_json 为空对象时 baseUrl 应该为空字符串', () => {
    const store = createStore();

    store.run(
      `INSERT INTO model_configs (id, provider, model_id, api_key_ref, config_json, is_default)
       VALUES (?, ?, ?, ?, ?, ?)`,
      'cfg-2', 'openai', 'gpt-4o', 'openai-key-ref', '{}', 1
    );

    const result = resolveModel({ store });

    expect(result.provider).toBe('openai');
    expect(result.modelId).toBe('gpt-4o');
    expect(result.baseUrl).toBe('');
  });
});
