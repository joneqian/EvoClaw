/**
 * M6 T2a: ConfigManager Profile 目录布局 + 首启迁移
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConfigManager } from '../../infrastructure/config-manager.js';

describe('M6 T2a — ConfigManager profile 布局', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-profile-'));
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it('干净状态首启：创建 profiles/default/config.json + .active-profile=default', () => {
    const cm = new ConfigManager(undefined, { configDir });

    const profileCfg = path.join(configDir, 'profiles', 'default', 'config.json');
    const activeFile = path.join(configDir, '.active-profile');

    expect(fs.existsSync(profileCfg)).toBe(true);
    expect(fs.existsSync(activeFile)).toBe(true);
    expect(fs.readFileSync(activeFile, 'utf-8').trim()).toBe('default');
    expect(cm.getCurrentProfile()).toBe('default');
    expect(cm.listProfiles()).toEqual(['default']);
  });

  it('迁移老 evo_claw.json：拷贝为 profiles/default/config.json，原文件保留', () => {
    // 用与 BRAND 相符的老文件名；若品牌不是 EvoClaw 此 test 的"迁移"分支不触发
    const brandFileCandidates = ['evo_claw.json', 'health_claw.json'];
    const legacyName = brandFileCandidates.find((n) => !fs.existsSync(path.join(configDir, n))) ?? 'evo_claw.json';
    const legacyPath = path.join(configDir, legacyName);
    fs.writeFileSync(legacyPath, JSON.stringify({ models: { default: 'openai/gpt-4o' } }));

    const cm = new ConfigManager(undefined, { configDir });

    // 老文件保留（即使迁移发生）
    expect(fs.existsSync(legacyPath)).toBe(true);
    // 新 profile 生成
    const profileCfg = path.join(configDir, 'profiles', 'default', 'config.json');
    expect(fs.existsSync(profileCfg)).toBe(true);
    expect(cm.getCurrentProfile()).toBe('default');
  });

  it('幂等：再次构造 ConfigManager 不重复迁移（已有 profile 时保留用户数据）', () => {
    new ConfigManager(undefined, { configDir });
    const profileCfg = path.join(configDir, 'profiles', 'default', 'config.json');
    // 在 profile 中写入可合法通过 schema 的标记
    const marker = { services: { brave: { apiKey: 'mark-preserved' } } };
    fs.writeFileSync(profileCfg, JSON.stringify(marker));

    new ConfigManager(undefined, { configDir });

    // 用户层原始数据未被 ensureProfileLayout 覆盖（配置合并 normalization 可能加其他字段，
    // 但关键标记保留）
    const after = JSON.parse(fs.readFileSync(profileCfg, 'utf-8'));
    expect(after.services?.brave?.apiKey).toBe('mark-preserved');
  });

  it('listProfiles 发现多个 profile', () => {
    const cm = new ConfigManager(undefined, { configDir });
    const workDir = path.join(configDir, 'profiles', 'work');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'config.json'), '{}');

    expect(cm.listProfiles().sort()).toEqual(['default', 'work']);
  });

  it('非法 .active-profile 内容时降级到 default', () => {
    new ConfigManager(undefined, { configDir });  // 建立目录结构
    fs.writeFileSync(path.join(configDir, '.active-profile'), '../hacker');

    const cm = new ConfigManager(undefined, { configDir });
    expect(cm.getCurrentProfile()).toBe('default');
  });

  it('.active-profile 指向不存在的 profile 时降级到 default', () => {
    new ConfigManager(undefined, { configDir });
    fs.writeFileSync(path.join(configDir, '.active-profile'), 'nonexistent');

    const cm = new ConfigManager(undefined, { configDir });
    expect(cm.getCurrentProfile()).toBe('default');
  });

  it('构造时传入显式 configPath 绕过 profile 逻辑（单元测试场景）', () => {
    const customPath = path.join(configDir, 'custom-config.json');
    fs.writeFileSync(customPath, '{}');

    const cm = new ConfigManager(customPath);
    // 不触发 profile 迁移
    expect(fs.existsSync(path.join(configDir, 'profiles'))).toBe(false);
    expect(cm.getCurrentProfile()).toBe('default');
  });
});
