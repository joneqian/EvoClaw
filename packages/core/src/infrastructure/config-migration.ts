/**
 * 配置迁移框架 — 版本升级时自动迁移旧配置
 *
 * 设计参考 Claude Code 11 个 TS 迁移脚本 + EvoClaw DB MigrationRunner 模式。
 *
 * 工作方式:
 * 1. 配置文件中记录 `_configVersion: number`
 * 2. 迁移脚本按版本号注册，每个脚本将配置从版本 N 升级到 N+1
 * 3. ConfigMigrationRunner 在 ConfigManager 加载后自动执行所有未应用的迁移
 * 4. 迁移后更新 _configVersion 并保存
 *
 * 迁移脚本约定:
 * - 纯函数，接收旧配置对象，返回新配置对象（不可变）
 * - 幂等：对已迁移的配置重复执行不应产生副作用
 * - 向后兼容：迁移后的配置仍能被旧版本读取（或至少不报错）
 */

import { createLogger } from './logger.js';

const log = createLogger('config-migration');

/** 配置迁移脚本 */
export interface ConfigMigration {
  /** 目标版本号（从 version-1 升级到 version） */
  version: number;
  /** 迁移描述 */
  description: string;
  /** 迁移函数：接收旧配置，返回新配置 */
  migrate: (config: Record<string, unknown>) => Record<string, unknown>;
}

/** 当前配置版本 — 新迁移脚本注册后递增 */
const CURRENT_CONFIG_VERSION = 1;

/** 已注册的迁移脚本（按 version 排序） */
const migrations: ConfigMigration[] = [];

/**
 * 注册配置迁移脚本
 *
 * @example
 * registerConfigMigration({
 *   version: 2,
 *   description: '将 services.brave.apiKey 迁移到 envVars.BRAVE_API_KEY',
 *   migrate: (config) => {
 *     const next = structuredClone(config);
 *     const braveKey = (next.services as any)?.brave?.apiKey;
 *     if (braveKey) {
 *       if (!next.envVars) next.envVars = {};
 *       (next.envVars as Record<string, string>)['BRAVE_API_KEY'] = braveKey;
 *     }
 *     return next;
 *   },
 * });
 */
export function registerConfigMigration(migration: ConfigMigration): void {
  migrations.push(migration);
  migrations.sort((a, b) => a.version - b.version);
}

/**
 * 执行配置迁移
 *
 * @param config 当前配置对象（含 _configVersion 字段）
 * @returns { config: 迁移后配置, applied: 应用的迁移描述列表, changed: 是否有变更 }
 */
export function runConfigMigrations(config: Record<string, unknown>): {
  config: Record<string, unknown>;
  applied: string[];
  changed: boolean;
} {
  let currentVersion = typeof config._configVersion === 'number' ? config._configVersion : 0;
  let current = config;
  const applied: string[] = [];

  for (const migration of migrations) {
    if (migration.version <= currentVersion) continue;

    log.info(`执行配置迁移 v${migration.version}: ${migration.description}`);
    try {
      current = migration.migrate(current);
      currentVersion = migration.version;
      applied.push(`v${migration.version}: ${migration.description}`);
    } catch (err) {
      log.error(`配置迁移 v${migration.version} 失败: ${err instanceof Error ? err.message : err}`);
      // 迁移失败停止后续迁移，保持当前版本
      break;
    }
  }

  // 更新版本号
  if (applied.length > 0) {
    current = { ...current, _configVersion: currentVersion };
    log.info(`配置迁移完成: ${applied.length} 个迁移已应用，当前版本 v${currentVersion}`);
  } else if (current._configVersion === undefined) {
    // 首次运行：标记初始版本
    current = { ...current, _configVersion: CURRENT_CONFIG_VERSION };
  }

  return { config: current, applied, changed: applied.length > 0 || current._configVersion !== config._configVersion };
}

/** 获取当前配置版本号 */
export function getCurrentConfigVersion(): number {
  return CURRENT_CONFIG_VERSION;
}

/** 获取所有已注册的迁移（用于测试/调试） */
export function getRegisteredMigrations(): readonly ConfigMigration[] {
  return migrations;
}

/** 清除已注册的迁移（仅测试用） */
export function clearMigrations(): void {
  migrations.length = 0;
}
