/**
 * ConfigManager — 多层配置管理器
 *
 * 三层合并（低→高优先级）:
 *   managed.json → config.d/*.json（字母序）→ 用户配置
 *
 * enforced 机制: managed.json 中的 enforced 路径强制使用 managed 的值
 * denylist 安全: security.*.denylist 始终取并集（由 deepMerge 自动处理）
 *
 * saveToDisk() 只写用户层配置，不动 managed 和 drop-in
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
  ExtensionSecurityPolicy,
  NameSecurityPolicy,
} from '@evoclaw/shared';
import { parseModelRef, safeParseConfig } from '@evoclaw/shared';
import { DEFAULT_DATA_DIR, BRAND_CONFIG_FILENAME, BRAND } from '@evoclaw/shared';
import { deepMerge, applyEnforced, mergeLayers } from './config-merge.js';
import { runConfigMigrations } from './config-migration.js';
import { writeCredentialFile } from './credential-file.js';
import { sanitizeCredentials } from './credential-sanitizer.js';
import { createLogger } from './logger.js';

const log = createLogger('config');

/** 默认配置目录（由品牌配置决定） */
const DEFAULT_CONFIG_DIR = path.join(os.homedir(), DEFAULT_DATA_DIR);

/** 默认配置文件名（由品牌配置决定） */
const CONFIG_FILENAME = BRAND_CONFIG_FILENAME;

/** 管理员配置文件名 */
const MANAGED_FILENAME = 'managed.json';

/** Drop-in 配置目录名 */
const DROP_IN_DIR = 'config.d';

/** 配置层级信息 */
export interface ConfigLayers {
  /** 管理员配置（managed.json，不含 enforced 元字段） */
  managed: EvoClawConfig;
  /** Drop-in 配置合并结果 */
  dropIn: EvoClawConfig;
  /** 用户配置（原始，未合并） */
  user: EvoClawConfig;
  /** 最终合并结果 */
  merged: EvoClawConfig;
  /** enforced 路径列表 */
  enforced: string[];
}

export class ConfigManager {
  private readonly configDir: string;
  private readonly configPath: string;
  private config: EvoClawConfig;
  private enforcedPaths: string[] = [];

  /** 各层原始配置（供 API 调试） */
  private managedRaw: EvoClawConfig = {};
  private dropInRaw: EvoClawConfig = {};
  private userRaw: EvoClawConfig = {};

  constructor(configPath?: string) {
    this.configPath = configPath ?? path.join(DEFAULT_CONFIG_DIR, CONFIG_FILENAME);
    this.configDir = path.dirname(this.configPath);
    this.config = this.loadMergedConfig();
  }

  // ─── 多层加载 ───

  /** 加载并合并三层配置 */
  private loadMergedConfig(): EvoClawConfig {
    // 1. 管理员配置（最低优先级）
    const { config: managed, enforced } = this.loadManagedConfig();
    this.managedRaw = managed;
    this.enforcedPaths = enforced;

    // 2. Drop-in 片段（中优先级）
    const dropIn = this.loadDropInConfigs();
    this.dropInRaw = dropIn;

    // 3. 用户配置（最高优先级）
    const user = this.loadUserConfig();
    this.userRaw = user;

    // 合并
    const merged = mergeLayers(managed, dropIn, user) as EvoClawConfig;

    // enforced 强制回写
    if (enforced.length > 0 && Object.keys(managed).length > 0) {
      applyEnforced(
        merged as unknown as Record<string, unknown>,
        managed as unknown as Record<string, unknown>,
        enforced,
      );
      log.info(`配置 enforced ${enforced.length} 个路径: ${enforced.join(', ')}`);
    }

    // Zod 验证合并后的结果
    const result = safeParseConfig(merged);
    if (!result.success) {
      log.warn(`合并配置验证有 ${result.error.issues.length} 个问题:`,
        result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; '));
    }

    // 凭证 ASCII 清理（处理 PDF 复制全角字母 / 同形字 / Unicode 残余导致的认证失败）
    const { sanitized, warnings: sanitizeWarnings } = sanitizeCredentials(merged);
    for (const w of sanitizeWarnings) {
      log.warn(`已清理凭证非 ASCII 字符: ${w}`);
    }

    const layerInfo = [
      Object.keys(managed).length > 0 ? 'managed' : null,
      Object.keys(dropIn).length > 0 ? 'drop-in' : null,
      'user',
    ].filter(Boolean).join(' + ');
    log.info(`配置加载完成 (${layerInfo})`);

    return sanitized;
  }

  /** 加载管理员配置 + enforced 列表 */
  private loadManagedConfig(): { config: EvoClawConfig; enforced: string[] } {
    const managedPath = path.join(this.configDir, MANAGED_FILENAME);
    try {
      if (fs.existsSync(managedPath)) {
        const raw = JSON.parse(fs.readFileSync(managedPath, 'utf-8'));
        // 提取 enforced 元字段（不属于 EvoClawConfig）
        const enforced: string[] = Array.isArray(raw.enforced) ? raw.enforced : [];
        const { enforced: _, ...config } = raw;
        log.info(`加载管理员配置: ${managedPath} (enforced: ${enforced.length})`);
        return { config: config as EvoClawConfig, enforced };
      }
    } catch (err) {
      log.warn(`管理员配置加载失败: ${err instanceof Error ? err.message : err}`);
    }
    return { config: {}, enforced: [] };
  }

  /** 加载 config.d/ 目录下的 drop-in 片段（按文件名字母序合并） */
  private loadDropInConfigs(): EvoClawConfig {
    const dropInPath = path.join(this.configDir, DROP_IN_DIR);
    if (!fs.existsSync(dropInPath)) return {};

    try {
      const files = fs.readdirSync(dropInPath)
        .filter(f => f.endsWith('.json'))
        .sort(); // 字母序

      if (files.length === 0) return {};

      let merged: Record<string, unknown> = {};
      for (const file of files) {
        try {
          const filePath = path.join(dropInPath, file);
          const fragment = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
          merged = deepMerge(merged, fragment);
          log.debug(`加载 drop-in 片段: ${file}`);
        } catch (err) {
          log.warn(`drop-in 片段 ${file} 加载失败: ${err instanceof Error ? err.message : err}`);
        }
      }

      log.info(`加载 ${files.length} 个 drop-in 片段: ${files.join(', ')}`);
      return merged as EvoClawConfig;
    } catch (err) {
      log.warn(`drop-in 目录读取失败: ${err instanceof Error ? err.message : err}`);
      return {};
    }
  }

  /** 加载用户配置 + 自动执行配置迁移 */
  private loadUserConfig(): EvoClawConfig {
    try {
      if (fs.existsSync(this.configPath)) {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(raw) as Record<string, unknown>;

        // 自动执行配置迁移
        const { config: migrated, changed } = runConfigMigrations(parsed);
        if (changed) {
          // 迁移后保存（原子写入用户配置 + 强制 0o600 权限）
          writeCredentialFile(this.configPath, JSON.stringify(migrated, null, 2));
        }

        return migrated as EvoClawConfig;
      }
    } catch (err) {
      log.error('用户配置加载失败:', err);
    }
    return {};
  }

  /** 保存用户配置到磁盘（只写用户层，不动 managed 和 drop-in；强制 0o600 权限） */
  private saveToDisk(): void {
    writeCredentialFile(this.configPath, JSON.stringify(this.userRaw, null, 2));
    // 重新合并（enforced 可能覆盖用户写入的值）
    this.config = this.loadMergedConfig();
  }

  /** 重新从磁盘加载（热重载） */
  reload(): void {
    this.config = this.loadMergedConfig();
  }

  // ─── 读取 ───

  /** 获取完整配置（合并后的最终结果） */
  getConfig(): EvoClawConfig {
    return structuredClone(this.config);
  }

  /** 获取 enforced 路径列表 */
  getEnforcedPaths(): string[] {
    return [...this.enforcedPaths];
  }

  /** 获取各层配置详情（调试用） */
  getConfigLayers(): ConfigLayers {
    return {
      managed: structuredClone(this.managedRaw),
      dropIn: structuredClone(this.dropInRaw),
      user: structuredClone(this.userRaw),
      merged: structuredClone(this.config),
      enforced: [...this.enforcedPaths],
    };
  }

  /** 获取响应语言偏好（优先级: 用户配置 > 品牌默认 > 'zh'） */
  getLanguage(): 'zh' | 'en' {
    return this.config.language ?? BRAND.defaultLanguage ?? 'zh';
  }

  /** 获取思考模式: auto=模型支持就开, on=强制开, off=强制关（默认 auto） */
  getThinkingMode(): 'auto' | 'on' | 'off' {
    return this.config.thinking ?? 'auto';
  }

  // ─── 写入（只写用户层） ───

  /** 更新完整配置（只影响用户层） */
  updateConfig(config: EvoClawConfig): void {
    this.userRaw = structuredClone(config);
    this.saveToDisk();
  }

  /** 校验配置完整性 */
  validate(): ConfigValidation {
    const missing: string[] = [];

    if (!this.config.models) {
      missing.push('models');
      return { valid: false, missing };
    }

    const { models } = this.config;

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

    const warnings: string[] = [];
    if (models.embedding) {
      const ref = parseModelRef(models.embedding);
      if (!ref) {
        warnings.push('models.embedding (格式应为 provider/modelId)');
      } else {
        const provider = models.providers?.[ref.provider];
        if (!provider) {
          warnings.push(`models.providers.${ref.provider} (embedding provider 未配置)`);
        } else {
          if (!provider.apiKey) warnings.push(`models.providers.${ref.provider}.apiKey (embedding)`);
          const model = provider.models.find(m => m.id === ref.modelId);
          if (!model) {
            warnings.push(`models.providers.${ref.provider}.models[${ref.modelId}] (embedding 模型未找到)`);
          } else if (!model.dimension) {
            warnings.push(`models.providers.${ref.provider}.models[${ref.modelId}].dimension (embedding 维度未配置)`);
          }
        }
      }
    }

    return { valid: missing.length === 0, missing, warnings };
  }

  // ─── 便捷方法 ───

  /** 获取 Provider 配置 */
  getProvider(id: string): ProviderEntry | undefined {
    return this.config.models?.providers?.[id];
  }

  /** 设置 Provider 配置（写入用户层） */
  setProvider(id: string, entry: ProviderEntry): void {
    if (!this.userRaw.models) this.userRaw.models = {};
    if (!this.userRaw.models.providers) this.userRaw.models.providers = {};
    this.userRaw.models.providers[id] = entry;
    this.saveToDisk();
  }

  /** 删除 Provider 配置 */
  removeProvider(id: string): void {
    if (this.userRaw.models?.providers) {
      delete this.userRaw.models.providers[id];
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
    if (!this.userRaw.models) this.userRaw.models = {};
    this.userRaw.models.default = `${provider}/${modelId}`;
    this.saveToDisk();
  }

  /** 设置默认 Embedding 模型 */
  setEmbeddingModelRef(provider: string, modelId: string): void {
    if (!this.userRaw.models) this.userRaw.models = {};
    this.userRaw.models.embedding = `${provider}/${modelId}`;
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

  // ─── 安全策略 ───

  /** 获取完整安全策略 */
  getSecurityPolicy(): ExtensionSecurityPolicy | undefined {
    return this.config.security;
  }

  /** 获取 Skill 安全策略 */
  getSkillSecurityPolicy(): NameSecurityPolicy | undefined {
    return this.config.security?.skills;
  }

  /** 获取 MCP Server 安全策略 */
  getMcpSecurityPolicy(): NameSecurityPolicy | undefined {
    return this.config.security?.mcpServers;
  }

  /** 更新安全策略（写入用户层） */
  updateSecurityPolicy(policy: ExtensionSecurityPolicy): void {
    this.userRaw.security = structuredClone(policy);
    this.saveToDisk();
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
