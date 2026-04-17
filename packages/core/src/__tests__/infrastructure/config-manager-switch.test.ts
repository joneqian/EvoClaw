/**
 * M6 T2b: ConfigManager switchProfile / createProfile / deleteProfile / onConfigChange
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { ConfigManager } from '../../infrastructure/config-manager.js';

describe('M6 T2b — ConfigManager profile 切换', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cm-switch-'));
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it('createProfile 新建空 profile', () => {
    const cm = new ConfigManager(undefined, { configDir });
    cm.createProfile('work');
    expect(cm.listProfiles().sort()).toEqual(['default', 'work']);
    expect(fs.existsSync(path.join(configDir, 'profiles', 'work', 'config.json'))).toBe(true);
  });

  it('createProfile 复制现有 profile', () => {
    const cm = new ConfigManager(undefined, { configDir });
    // 在 default 写入标记
    fs.writeFileSync(
      path.join(configDir, 'profiles', 'default', 'config.json'),
      JSON.stringify({ services: { brave: { apiKey: 'from-default' } } }),
    );
    cm.createProfile('staging', 'default');
    const stagingContent = JSON.parse(
      fs.readFileSync(path.join(configDir, 'profiles', 'staging', 'config.json'), 'utf-8'),
    );
    expect(stagingContent.services?.brave?.apiKey).toBe('from-default');
  });

  it('createProfile 名称冲突时抛错', () => {
    const cm = new ConfigManager(undefined, { configDir });
    expect(() => cm.createProfile('default')).toThrow('已存在');
  });

  it('createProfile 名称非法时抛错', () => {
    const cm = new ConfigManager(undefined, { configDir });
    expect(() => cm.createProfile('../hack')).toThrow('非法字符');
  });

  it('switchProfile 切换后 getCurrentProfile + .active-profile 同步', async () => {
    const cm = new ConfigManager(undefined, { configDir });
    cm.createProfile('work');
    await cm.switchProfile('work');

    expect(cm.getCurrentProfile()).toBe('work');
    expect(fs.readFileSync(path.join(configDir, '.active-profile'), 'utf-8').trim()).toBe('work');
  });

  it('switchProfile 到不存在的 profile 抛错', async () => {
    const cm = new ConfigManager(undefined, { configDir });
    await expect(cm.switchProfile('ghost')).rejects.toThrow('不存在');
  });

  it('switchProfile 触发 onConfigChange 回调', async () => {
    const cm = new ConfigManager(undefined, { configDir });
    cm.createProfile('work');
    const listener = vi.fn();
    cm.onConfigChange(listener);

    await cm.switchProfile('work');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('offConfigChange (返回的 unsubscribe 函数) 阻止后续触发', async () => {
    const cm = new ConfigManager(undefined, { configDir });
    cm.createProfile('work');
    cm.createProfile('prod');
    const listener = vi.fn();
    const unsubscribe = cm.onConfigChange(listener);

    await cm.switchProfile('work');
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    await cm.switchProfile('prod');
    expect(listener).toHaveBeenCalledTimes(1);  // 未增加
  });

  it('listener 抛异常不影响其他 listener', async () => {
    const cm = new ConfigManager(undefined, { configDir });
    cm.createProfile('work');
    const bad = vi.fn().mockRejectedValue(new Error('boom'));
    const good = vi.fn();
    cm.onConfigChange(bad);
    cm.onConfigChange(good);

    await cm.switchProfile('work');
    expect(bad).toHaveBeenCalled();
    expect(good).toHaveBeenCalled();
  });

  it('switchProfile 后 getConfig 返回新 profile 的数据', async () => {
    const cm = new ConfigManager(undefined, { configDir });
    // 在 default 写入独特标记
    fs.writeFileSync(
      path.join(configDir, 'profiles', 'default', 'config.json'),
      JSON.stringify({ services: { brave: { apiKey: 'default-key' } } }),
    );
    cm.createProfile('work');
    fs.writeFileSync(
      path.join(configDir, 'profiles', 'work', 'config.json'),
      JSON.stringify({ services: { brave: { apiKey: 'work-key' } } }),
    );

    // 重新加载默认 profile 的 config（刚写入的需要 reload）
    cm.reload();
    expect(cm.getConfig().services?.brave?.apiKey).toBe('default-key');

    await cm.switchProfile('work');
    expect(cm.getConfig().services?.brave?.apiKey).toBe('work-key');
  });

  it('deleteProfile 禁止删除 default', () => {
    const cm = new ConfigManager(undefined, { configDir });
    cm.createProfile('work');
    expect(() => cm.deleteProfile('default')).toThrow(/default/);
  });

  it('deleteProfile 禁止删除当前激活 profile', async () => {
    const cm = new ConfigManager(undefined, { configDir });
    cm.createProfile('work');
    await cm.switchProfile('work');
    expect(() => cm.deleteProfile('work')).toThrow(/当前/);
  });

  it('deleteProfile 成功清理目录', async () => {
    const cm = new ConfigManager(undefined, { configDir });
    cm.createProfile('work');
    cm.createProfile('prod');
    cm.deleteProfile('prod');
    expect(cm.listProfiles().sort()).toEqual(['default', 'work']);
    expect(fs.existsSync(path.join(configDir, 'profiles', 'prod'))).toBe(false);
  });
});
