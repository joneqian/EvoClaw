/**
 * ConfigManager — evo_claw.json 配置管理器
 *
 * 统一管理应用配置。默认路径: ~/.evoclaw/evo_claw.json
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type {
  EvoClawConfig,
  ConfigValidation,
  ProviderEntry,
  ModelEntry,
  ModelReference,
} from '@evoclaw/shared';
import { parseModelRef } from '@evoclaw/shared';
import { createLogger } from './logger.js';

const log = createLogger('config');

/** 默认配置目录 */
const DEFAULT_CONFIG_DIR = path.join(os.homedir(), '.evoclaw');

/** 默认配置文件名 */
const CONFIG_FILENAME = 'evo_claw.json';

export class ConfigManager {
  private configPath: string;
  private config: EvoClawConfig;

  constructor(configPath?: string) {
    this.configPath = configPath ?? path.join(DEFAULT_CONFIG_DIR, CONFIG_FILENAME);
    this.config = this.loadFromDisk();
  }

  /** 从磁盘加载配置 */
  private loadFromDisk(): EvoClawConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        return JSON.parse(raw) as EvoClawConfig;
      }
    } catch (err) {
      log.error('加载配置失败:', err);
    }
    return {};
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

    // 检查 models 部分
    if (!this.config.models) {
      missing.push('models');
      return { valid: false, missing };
    }

    const { models } = this.config;

    // 检查 default 模型
    if (!models.default) {
      missing.push('models.default');
    } else {
      const ref = parseModelRef(models.default);
      if (!ref) {
        missing.push('models.default (格式应为 provider/modelId)');
      } else {
        const provider = models.providers?.[ref.provider];
        if (!provider) {
          missing.push(`models.providers.${ref.provider}`);
        } else {
          if (!provider.apiKey) missing.push(`models.providers.${ref.provider}.apiKey`);
          if (!provider.baseUrl) missing.push(`models.providers.${ref.provider}.baseUrl`);
          const model = provider.models.find(m => m.id === ref.modelId);
          if (!model) missing.push(`models.providers.${ref.provider}.models[${ref.modelId}]`);
        }
      }
    }

    // embedding 是可选的，但配置了就要完整
    if (models.embedding) {
      const ref = parseModelRef(models.embedding);
      if (!ref) {
        missing.push('models.embedding (格式应为 provider/modelId)');
      } else {
        const provider = models.providers?.[ref.provider];
        if (!provider) {
          missing.push(`models.providers.${ref.provider}`);
        } else {
          if (!provider.apiKey) missing.push(`models.providers.${ref.provider}.apiKey`);
          const model = provider.models.find(m => m.id === ref.modelId);
          if (!model) {
            missing.push(`models.providers.${ref.provider}.models[${ref.modelId}]`);
          } else if (!model.dimension) {
            missing.push(`models.providers.${ref.provider}.models[${ref.modelId}].dimension`);
          }
        }
      }
    }

    return { valid: missing.length === 0, missing };
  }

  // ─── 便捷方法 ───

  /** 获取 Provider 配置 */
  getProvider(id: string): ProviderEntry | undefined {
    return this.config.models?.providers?.[id];
  }

  /** 设置 Provider 配置 */
  setProvider(id: string, entry: ProviderEntry): void {
    if (!this.config.models) this.config.models = {};
    if (!this.config.models.providers) this.config.models.providers = {};
    this.config.models.providers[id] = entry;
    this.saveToDisk();
  }

  /** 删除 Provider 配置 */
  removeProvider(id: string): void {
    if (this.config.models?.providers) {
      delete this.config.models.providers[id];
      this.saveToDisk();
    }
  }

  /** 获取所有 Provider ID 列表 */
  getProviderIds(): string[] {
    return Object.keys(this.config.models?.providers ?? {});
  }

  /** 解析默认模型引用 */
  getDefaultModelRef(): ModelReference | null {
    const ref = this.config.models?.default;
    if (!ref) return null;
    return parseModelRef(ref);
  }

  /** 设置默认 LLM 模型 */
  setDefaultModelRef(provider: string, modelId: string): void {
    if (!this.config.models) this.config.models = {};
    this.config.models.default = `${provider}/${modelId}`;
    this.saveToDisk();
  }

  /** 设置默认 Embedding 模型 */
  setEmbeddingModelRef(provider: string, modelId: string): void {
    if (!this.config.models) this.config.models = {};
    this.config.models.embedding = `${provider}/${modelId}`;
    this.saveToDisk();
  }

  /** 获取默认模型的 API Key */
  getDefaultApiKey(): string {
    const ref = this.getDefaultModelRef();
    if (!ref) return '';
    return this.config.models?.providers?.[ref.provider]?.apiKey ?? '';
  }

  /** 获取默认模型的 Base URL */
  getDefaultBaseUrl(): string {
    const ref = this.getDefaultModelRef();
    if (!ref) return '';
    return this.config.models?.providers?.[ref.provider]?.baseUrl ?? '';
  }

  /** 获取默认模型 ID */
  getDefaultModelId(): string {
    return this.getDefaultModelRef()?.modelId ?? '';
  }

  /** 获取默认 Provider ID */
  getDefaultProvider(): string {
    return this.getDefaultModelRef()?.provider ?? '';
  }

  /** 获取默认模型的 API 协议 */
  getDefaultApi(): string {
    const ref = this.getDefaultModelRef();
    if (!ref) return 'openai-completions';
    return this.config.models?.providers?.[ref.provider]?.api ?? 'openai-completions';
  }

  /** 获取指定 Provider 的 API Key */
  getApiKey(providerId: string): string {
    return this.config.models?.providers?.[providerId]?.apiKey ?? '';
  }

  /** 解析 Embedding 模型引用 */
  getEmbeddingModelRef(): ModelReference | null {
    const ref = this.config.models?.embedding;
    if (!ref) return null;
    return parseModelRef(ref);
  }

  /** 获取 Embedding 模型条目 */
  getEmbeddingModel(): ModelEntry | undefined {
    const ref = this.getEmbeddingModelRef();
    if (!ref) return undefined;
    const provider = this.config.models?.providers?.[ref.provider];
    return provider?.models.find(m => m.id === ref.modelId);
  }

  /** 获取 Embedding Provider 的 API Key */
  getEmbeddingApiKey(): string {
    const ref = this.getEmbeddingModelRef();
    if (!ref) return '';
    return this.config.models?.providers?.[ref.provider]?.apiKey ?? '';
  }

  /** 获取 Embedding Provider 的 Base URL */
  getEmbeddingBaseUrl(): string {
    const ref = this.getEmbeddingModelRef();
    if (!ref) return '';
    return this.config.models?.providers?.[ref.provider]?.baseUrl ?? '';
  }

  /** 获取 Brave Search API Key */
  getBraveApiKey(): string {
    return this.config.services?.brave?.apiKey ?? '';
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
