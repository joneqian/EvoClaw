/**
 * ConfigManager — evo_claw.json 配置管理器
 *
 * 统一管理应用配置，替代 .env + model_configs 表。
 * 默认路径: ~/.evoclaw/evo_claw.json
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { EvoClawConfig, ConfigValidation, ProviderEntry, EmbeddingModelRef } from '@evoclaw/shared';

/** 默认配置目录 */
const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.evoclaw');

/** 默认配置文件名 */
const CONFIG_FILENAME = 'evo_claw.json';

/** 空配置模板 */
const EMPTY_CONFIG: EvoClawConfig = {
  providers: {},
  models: {
    default: { provider: '', modelId: '' },
  },
};

export class ConfigManager {
  private configPath: string;
  private config: EvoClawConfig;

  /**
   * @param configPath 配置文件路径，默认 ~/.evoclaw/evo_claw.json
   */
  constructor(configPath?: string) {
    this.configPath = configPath ?? path.join(DEFAULT_CONFIG_DIR, CONFIG_FILENAME);
    this.config = this.loadFromDisk();
  }

  /** 从磁盘加载配置 */
  private loadFromDisk(): EvoClawConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(raw) as Partial<EvoClawConfig>;
        // 合并默认值，防止字段缺失
        return {
          providers: parsed.providers ?? {},
          models: {
            default: parsed.models?.default ?? { provider: '', modelId: '' },
            embedding: parsed.models?.embedding,
          },
        };
      }
    } catch (err) {
      console.error('[config] 加载配置失败:', err);
    }
    return structuredClone(EMPTY_CONFIG);
  }

  /** 保存配置到磁盘 */
  private saveToDisk(): void {
    const dir = path.dirname(this.configPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), 'utf-8');
  }

  /** 重新从磁盘加载（热重载） */
  reload(): void {
    this.config = this.loadFromDisk();
  }

  /** 获取完整配置 */
  getConfig(): EvoClawConfig {
    return structuredClone(this.config);
  }

  /** 更新完整配置 */
  updateConfig(config: EvoClawConfig): void {
    this.config = structuredClone(config);
    this.saveToDisk();
  }

  /** 校验配置完整性 */
  validate(): ConfigValidation {
    const missing: string[] = [];

    // 检查是否有 default model 配置
    if (!this.config.models.default.provider) {
      missing.push('models.default.provider');
    }
    if (!this.config.models.default.modelId) {
      missing.push('models.default.modelId');
    }

    // 检查 default model 对应的 provider 是否已配置
    const defaultProvider = this.config.models.default.provider;
    if (defaultProvider && !this.config.providers[defaultProvider]) {
      missing.push(`providers.${defaultProvider}`);
    }

    // 检查 provider 是否有 apiKey
    if (defaultProvider && this.config.providers[defaultProvider]) {
      const entry = this.config.providers[defaultProvider]!;
      if (!entry.apiKey) {
        missing.push(`providers.${defaultProvider}.apiKey`);
      }
      if (!entry.baseUrl) {
        missing.push(`providers.${defaultProvider}.baseUrl`);
      }
    }

    // embedding 是可选的，但如果配置了就要完整
    if (this.config.models.embedding) {
      const emb = this.config.models.embedding;
      if (!emb.provider) missing.push('models.embedding.provider');
      if (!emb.modelId) missing.push('models.embedding.modelId');
      if (!emb.dimension) missing.push('models.embedding.dimension');
      if (emb.provider && !this.config.providers[emb.provider]) {
        missing.push(`providers.${emb.provider}`);
      }
    }

    return { valid: missing.length === 0, missing };
  }

  // ─── 便捷方法 ───

  /** 获取 Provider 配置 */
  getProvider(id: string): ProviderEntry | undefined {
    return this.config.providers[id];
  }

  /** 设置 Provider 配置 */
  setProvider(id: string, entry: ProviderEntry): void {
    this.config.providers[id] = entry;
    this.saveToDisk();
  }

  /** 删除 Provider 配置 */
  removeProvider(id: string): void {
    delete this.config.providers[id];
    this.saveToDisk();
  }

  /** 获取所有 Provider ID 列表 */
  getProviderIds(): string[] {
    return Object.keys(this.config.providers);
  }

  /** 获取默认模型的 API Key */
  getDefaultApiKey(): string {
    const providerId = this.config.models.default.provider;
    return this.config.providers[providerId]?.apiKey ?? '';
  }

  /** 获取默认模型的 Base URL */
  getDefaultBaseUrl(): string {
    const providerId = this.config.models.default.provider;
    return this.config.providers[providerId]?.baseUrl ?? '';
  }

  /** 获取默认模型 ID */
  getDefaultModelId(): string {
    return this.config.models.default.modelId;
  }

  /** 获取默认 Provider ID */
  getDefaultProvider(): string {
    return this.config.models.default.provider;
  }

  /** 获取指定 Provider 的 API Key */
  getApiKey(providerId: string): string {
    return this.config.providers[providerId]?.apiKey ?? '';
  }

  /** 获取 Embedding 配置 */
  getEmbeddingConfig(): EmbeddingModelRef | undefined {
    return this.config.models.embedding;
  }

  /** 获取 Embedding Provider 的 API Key */
  getEmbeddingApiKey(): string {
    const providerId = this.config.models.embedding?.provider;
    if (!providerId) return '';
    return this.config.providers[providerId]?.apiKey ?? '';
  }

  /** 获取 Embedding Provider 的 Base URL */
  getEmbeddingBaseUrl(): string {
    const providerId = this.config.models.embedding?.provider;
    if (!providerId) return '';
    return this.config.providers[providerId]?.baseUrl ?? '';
  }

  /** 配置文件是否存在 */
  exists(): boolean {
    return fs.existsSync(this.configPath);
  }

  /** 获取配置文件路径 */
  getConfigPath(): string {
    return this.configPath;
  }
}
