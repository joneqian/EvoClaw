import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerConfigMigration,
  runConfigMigrations,
  clearMigrations,
  getRegisteredMigrations,
} from '../infrastructure/config-migration.js';

describe('config-migration', () => {
  beforeEach(() => {
    clearMigrations();
  });

  it('无迁移时标记初始版本', () => {
    const { config, applied, changed } = runConfigMigrations({});
    expect(config._configVersion).toBe(1);
    expect(applied).toHaveLength(0);
    expect(changed).toBe(true); // 首次标记版本号也算变更
  });

  it('已有版本号且无新迁移时不变更', () => {
    const { config, changed } = runConfigMigrations({ _configVersion: 1 });
    expect(config._configVersion).toBe(1);
    expect(changed).toBe(false);
  });

  it('执行单个迁移', () => {
    registerConfigMigration({
      version: 2,
      description: '添加 language 默认值',
      migrate: (config) => ({ ...config, language: config.language ?? 'zh' }),
    });

    const { config, applied } = runConfigMigrations({ _configVersion: 1 });
    expect(config._configVersion).toBe(2);
    expect(config.language).toBe('zh');
    expect(applied).toHaveLength(1);
    expect(applied[0]).toContain('v2');
  });

  it('按版本顺序执行多个迁移', () => {
    registerConfigMigration({
      version: 3,
      description: '第三步',
      migrate: (config) => ({ ...config, step3: true }),
    });
    registerConfigMigration({
      version: 2,
      description: '第二步',
      migrate: (config) => ({ ...config, step2: true }),
    });

    const { config, applied } = runConfigMigrations({ _configVersion: 1 });
    expect(config._configVersion).toBe(3);
    expect(config.step2).toBe(true);
    expect(config.step3).toBe(true);
    expect(applied).toHaveLength(2);
    expect(applied[0]).toContain('v2');
    expect(applied[1]).toContain('v3');
  });

  it('跳过已应用的迁移', () => {
    registerConfigMigration({
      version: 2,
      description: '不应执行',
      migrate: () => { throw new Error('不应被调用'); },
    });
    registerConfigMigration({
      version: 3,
      description: '应执行',
      migrate: (config) => ({ ...config, v3: true }),
    });

    const { config, applied } = runConfigMigrations({ _configVersion: 2 });
    expect(config._configVersion).toBe(3);
    expect(applied).toHaveLength(1);
  });

  it('迁移失败停止后续执行', () => {
    registerConfigMigration({
      version: 2,
      description: '会失败',
      migrate: () => { throw new Error('模拟错误'); },
    });
    registerConfigMigration({
      version: 3,
      description: '不会执行',
      migrate: (config) => ({ ...config, v3: true }),
    });

    const { config, applied } = runConfigMigrations({ _configVersion: 1 });
    expect(config._configVersion).toBe(1); // 停留在失败前的版本
    expect(applied).toHaveLength(0);
    expect(config.v3).toBeUndefined();
  });

  it('幂等性：迁移后重复执行不变更', () => {
    registerConfigMigration({
      version: 2,
      description: '添加字段',
      migrate: (config) => ({ ...config, newField: 'value' }),
    });

    const first = runConfigMigrations({ _configVersion: 1 });
    const second = runConfigMigrations(first.config);
    expect(second.changed).toBe(false);
    expect(second.applied).toHaveLength(0);
  });

  it('注册表可查询', () => {
    registerConfigMigration({ version: 2, description: 'a', migrate: c => c });
    registerConfigMigration({ version: 3, description: 'b', migrate: c => c });
    expect(getRegisteredMigrations()).toHaveLength(2);
  });

  it('实际场景：brave apiKey 迁移到 envVars', () => {
    registerConfigMigration({
      version: 2,
      description: '将 services.brave.apiKey 迁移到 envVars.BRAVE_API_KEY',
      migrate: (config) => {
        const next = structuredClone(config);
        const braveKey = (next.services as Record<string, unknown> | undefined)?.brave;
        const apiKey = (braveKey as Record<string, unknown> | undefined)?.apiKey as string | undefined;
        if (apiKey) {
          if (!next.envVars) next.envVars = {};
          (next.envVars as Record<string, string>)['BRAVE_API_KEY'] = apiKey;
        }
        return next;
      },
    });

    const oldConfig = {
      _configVersion: 1,
      services: { brave: { apiKey: 'test-brave-key' } },
    };

    const { config } = runConfigMigrations(oldConfig);
    expect((config.envVars as Record<string, string>)['BRAVE_API_KEY']).toBe('test-brave-key');
    expect(config._configVersion).toBe(2);
  });
});
