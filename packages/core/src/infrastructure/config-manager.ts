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
import { getNextKey as poolGetNextKey, type CredentialPoolConfig } from './provider-key-state.js';
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

/** M6 T2: Profile 目录名 */
const PROFILES_DIR = 'profiles';

/** M6 T2: 当前 profile 标识文件 */
const ACTIVE_PROFILE_FILE = '.active-profile';

/** M6 T2: profile 目录内统一文件名 */
const PROFILE_CONFIG_FILENAME = 'config.json';

/** M6 T2: 默认 profile 名 */
const DEFAULT_PROFILE = 'default';

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
  private configPath: string;
  private config: EvoClawConfig;
  private enforcedPaths: string[] = [];
  /** M6 T2: 当前 profile 名 */
  private activeProfile: string = DEFAULT_PROFILE;
  /** M6 T2: onConfigChange 订阅者列表 */
  private readonly configChangeListeners: Array<() => void | Promise<void>> = [];

  /** 各层原始配置（供 API 调试） */
  private managedRaw: EvoClawConfig = {};
  private dropInRaw: EvoClawConfig = {};
  private userRaw: EvoClawConfig = {};
  /** 最近一次 loadMergedConfig 期间产生的凭证清理警告（一次性消费，getWarningsOnce 后清空） */
  private pendingSanitizeWarnings: string[] = [];

  constructor(configPath?: string, opts?: { configDir?: string }) {
    if (configPath) {
      // 单元测试 / 外部指定路径 — 绕过 profile 目录，保留原语义
      this.configPath = configPath;
      this.configDir = path.dirname(configPath);
    } else {
      // M6 T2: 支持显式 configDir（单元测试隔离），否则走默认 ~/.evoclaw
      this.configDir = opts?.configDir ?? DEFAULT_CONFIG_DIR;
      // 首启迁移 + 解析 .active-profile 决定 configPath
      this.ensureProfileLayout();
      this.activeProfile = this.readActiveProfileName();
      this.configPath = this.profileConfigPath(this.activeProfile);
    }
    this.config = this.loadMergedConfig();
  }

  // ─── M6 T2: Profile 布局 ───

  /** profile 目录 */
  private profileDir(name: string): string {
    return path.join(this.configDir, PROFILES_DIR, name);
  }

  /** profile 配置文件路径 */
  private profileConfigPath(name: string): string {
    return path.join(this.profileDir(name), PROFILE_CONFIG_FILENAME);
  }

  /**
   * M6 T2: 首启迁移 — 若 profiles/ 不存在：
   * 1. 若老 evo_claw.json 存在 → 建 profiles/default/ → 拷贝为 config.json（不删老文件，留作 fallback）
   * 2. 若老文件不存在 → 仅建空 profiles/default/ 目录（写 config.json 为 {}）
   * 3. 写 .active-profile=default
   *
   * 幂等：若 profiles/default/config.json 已存在则跳过。
   */
  private ensureProfileLayout(): void {
    const profilesRoot = path.join(this.configDir, PROFILES_DIR);
    const defaultDir = this.profileDir(DEFAULT_PROFILE);
    const defaultCfg = this.profileConfigPath(DEFAULT_PROFILE);

    if (fs.existsSync(defaultCfg)) return; // 已有默认 profile，无需迁移

    try {
      fs.mkdirSync(defaultDir, { recursive: true });

      const legacyPath = path.join(this.configDir, CONFIG_FILENAME);
      if (fs.existsSync(legacyPath)) {
        // 拷贝（不删），保留 0o600 权限
        fs.copyFileSync(legacyPath, defaultCfg);
        try { fs.chmodSync(defaultCfg, 0o600); } catch { /* Windows 可能不支持 */ }
        log.info(`profile 首启迁移: ${legacyPath} → ${defaultCfg}（原文件保留）`);
      } else {
        writeCredentialFile(defaultCfg, '{}');
        log.info(`profile 首启初始化: 创建空 default profile 于 ${defaultCfg}`);
      }

      const activeFile = path.join(this.configDir, ACTIVE_PROFILE_FILE);
      if (!fs.existsSync(activeFile)) {
        fs.writeFileSync(activeFile, DEFAULT_PROFILE, 'utf-8');
      }
      log.info(`profile 布局就绪: ${profilesRoot}`);
    } catch (err) {
      log.warn(`profile 首启迁移失败（将退回到老 configPath）: ${err instanceof Error ? err.message : err}`);
    }
  }

  /** 读 .active-profile；不存在 / 非法时返回 default */
  private readActiveProfileName(): string {
    try {
      const activeFile = path.join(this.configDir, ACTIVE_PROFILE_FILE);
      if (!fs.existsSync(activeFile)) return DEFAULT_PROFILE;
      const name = fs.readFileSync(activeFile, 'utf-8').trim();
      if (!name || !/^[a-zA-Z0-9_-]+$/.test(name)) return DEFAULT_PROFILE;
      // 若指向的 profile 不存在，回退 default
      if (!fs.existsSync(this.profileConfigPath(name))) return DEFAULT_PROFILE;
      return name;
    } catch {
      return DEFAULT_PROFILE;
    }
  }

  /** 列出已存在的 profiles */
  listProfiles(): string[] {
    try {
      const root = path.join(this.configDir, PROFILES_DIR);
      if (!fs.existsSync(root)) return [DEFAULT_PROFILE];
      return fs.readdirSync(root, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .filter((name) => fs.existsSync(this.profileConfigPath(name)))
        .sort();
    } catch {
      return [DEFAULT_PROFILE];
    }
  }

  /** 当前激活的 profile 名 */
  getCurrentProfile(): string {
    return this.activeProfile;
  }

  /**
   * M6 T2: 切换到另一个 profile，reload 配置并广播变更。
   *
   * - profile 必须已存在（由 createProfile 创建）
   * - 写 .active-profile → 改 configPath → 重 load → 异步调用全部 listeners
   * - 切换后调 getConfig() 立即可见新配置
   */
  async switchProfile(name: string): Promise<void> {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error(`profile 名包含非法字符: ${name}`);
    }
    const cfgPath = this.profileConfigPath(name);
    if (!fs.existsSync(cfgPath)) {
      throw new Error(`profile 不存在: ${name}`);
    }
    const activeFile = path.join(this.configDir, ACTIVE_PROFILE_FILE);
    fs.writeFileSync(activeFile, name, 'utf-8');

    this.activeProfile = name;
    this.configPath = cfgPath;
    this.config = this.loadMergedConfig();
    log.info(`已切换到 profile: ${name}`);

    // 异步广播（串行等待所有 listener，收集异常作为 warnings）
    await this.emitConfigChange();
  }

  /**
   * M6 T2: 创建新 profile。
   *
   * @param name 目标 profile 名
   * @param copyFrom 可选来源 profile（复制其配置）；默认空配置
   */
  createProfile(name: string, copyFrom?: string): void {
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      throw new Error(`profile 名包含非法字符: ${name}`);
    }
    const targetCfg = this.profileConfigPath(name);
    if (fs.existsSync(targetCfg)) {
      throw new Error(`profile 已存在: ${name}`);
    }
    fs.mkdirSync(this.profileDir(name), { recursive: true });
    if (copyFrom) {
      const srcCfg = this.profileConfigPath(copyFrom);
      if (!fs.existsSync(srcCfg)) {
        throw new Error(`来源 profile 不存在: ${copyFrom}`);
      }
      fs.copyFileSync(srcCfg, targetCfg);
      try { fs.chmodSync(targetCfg, 0o600); } catch { /* Windows 忽略 */ }
    } else {
      writeCredentialFile(targetCfg, '{}');
    }
    log.info(`创建 profile: ${name}${copyFrom ? ` (复制自 ${copyFrom})` : ''}`);
  }

  /**
   * M6 T2: 删除 profile。
   * - 不能删当前 active profile
   * - 不能删 default（总要有一个保底）
   */
  deleteProfile(name: string): void {
    if (name === this.activeProfile) {
      throw new Error(`不能删除当前激活的 profile: ${name}`);
    }
    if (name === DEFAULT_PROFILE) {
      throw new Error('不能删除 default profile');
    }
    const dir = this.profileDir(name);
    if (!fs.existsSync(dir)) {
      throw new Error(`profile 不存在: ${name}`);
    }
    fs.rmSync(dir, { recursive: true, force: true });
    log.info(`删除 profile: ${name}`);
  }

  /** M6 T2: 订阅配置变更（profile 切换时触发） */
  onConfigChange(listener: () => void | Promise<void>): () => void {
    this.configChangeListeners.push(listener);
    return () => {
      const idx = this.configChangeListeners.indexOf(listener);
      if (idx >= 0) this.configChangeListeners.splice(idx, 1);
    };
  }

  /** 内部：串行触发所有 listener，异常吞掉不中断其他 listener */
  private async emitConfigChange(): Promise<void> {
    // 快照避免迭代期间 offConfigChange 变更数组
    for (const listener of Array.from(this.configChangeListeners)) {
      try {
        await listener();
      } catch (err) {
        log.warn(`onConfigChange listener 异常: ${err instanceof Error ? err.message : err}`);
      }
    }
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
    // 累加到 pending 队列（多次 reload 不覆盖未读警告）
    if (sanitizeWarnings.length > 0) {
      this.pendingSanitizeWarnings.push(...sanitizeWarnings);
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
          // M6 T1: apiKey 或 credentialPool 至少有一个有效凭据
          const hasApiKey = !!provider.apiKey;
          const hasPool = !!provider.credentialPool && provider.credentialPool.keys.some(k => k.enabled);
          if (!hasApiKey && !hasPool) {
            missing.push(`models.providers.${ref.provider}.apiKey（或 credentialPool）`);
          }
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
          const hasEmbeddingKey = !!provider.apiKey || (!!provider.credentialPool && provider.credentialPool.keys.some(k => k.enabled));
          if (!hasEmbeddingKey) warnings.push(`models.providers.${ref.provider}.apiKey (embedding)`);
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

  /** 获取默认模型的 API Key（走 CredentialPool，若配置） */
  getDefaultApiKey(): string {
    const ref = this.getDefaultModelRef();
    if (!ref) return '';
    return this.getApiKeyForProvider(ref.provider);
  }

  /**
   * M6 T1: 解析某 Provider 当前应使用的凭据（apiKey + 选中的 keyId）。
   *
   * 策略：
   *   1. 若 provider.credentialPool 存在且有可用 key → 走 pool 策略（failover / round-robin）
   *   2. 否则 → 回退到 provider.apiKey（不走 pool）
   *   3. pool 所有 key 都不可用 → 回退到 apiKey（保底）
   *
   * 返回 `{ apiKey, keyId }` — keyId 为 null 表示走的是单 apiKey 路径（无需标记失败）。
   *
   * @param providerId Provider 标识
   * @param excludeKeyId 本次调用已失败、需排除的 key id（用于 1 次重试）
   */
  resolveProviderCredential(
    providerId: string,
    excludeKeyId?: string,
  ): { apiKey: string; keyId: string | null } {
    const provider = this.config.models?.providers?.[providerId];
    if (!provider) return { apiKey: '', keyId: null };
    const pool = provider.credentialPool as CredentialPoolConfig | undefined;
    if (pool && pool.keys.length > 0) {
      const next = poolGetNextKey(providerId, pool, excludeKeyId);
      if (next) return { apiKey: next.apiKey, keyId: next.id };
    }
    return { apiKey: provider.apiKey ?? '', keyId: null };
  }

  /** 便捷 getter：仅取 apiKey（不带 keyId，不占 round-robin 游标外的副作用，但仍会推进游标） */
  getApiKeyForProvider(providerId: string, excludeKeyId?: string): string {
    return this.resolveProviderCredential(providerId, excludeKeyId).apiKey;
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

  /** 获取指定 Provider 的 API Key（走 CredentialPool，若配置） */
  getApiKey(providerId: string): string {
    return this.getApiKeyForProvider(providerId);
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

  /** 获取 Embedding Provider 的 API Key（走 CredentialPool，若配置） */
  getEmbeddingApiKey(): string {
    const ref = this.getEmbeddingModelRef();
    if (!ref) return '';
    return this.getApiKeyForProvider(ref.provider);
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

  /**
   * 一次性取出待展示的凭证清理警告。
   * 设计为一次性消费：返回后立刻清空，避免下次打开 UI 再次弹提示。
   * 用于前端 SettingsPage EnvVarsTab 挂载时给用户一次性 toast。
   */
  getSanitizeWarningsOnce(): string[] {
    const warnings = this.pendingSanitizeWarnings;
    this.pendingSanitizeWarnings = [];
    return warnings;
  }
}
