/**
 * M4.1 T3 测试：ConfigManager.getSanitizeWarningsOnce()
 *
 * 验证凭证清理警告的一次性消费语义：读一次后清空，避免 UI 反复弹同一条。
 */

import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { ConfigManager } from '../../infrastructure/config-manager.js';

function tmpConfigPath(): string {
  const dir = path.join(os.tmpdir(), `evoclaw-warn-test-${crypto.randomUUID()}`);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'evo_claw.json');
}

describe('ConfigManager.getSanitizeWarningsOnce', () => {
  const paths: string[] = [];
  afterEach(() => {
    for (const p of paths) {
      try {
        const dir = path.dirname(p);
        if (dir.includes(os.tmpdir())) fs.rmSync(dir, { recursive: true, force: true });
      } catch { /* ignore */ }
    }
    paths.length = 0;
  });

  it('启动时配置含全角凭证 → 首次读取返回对应 warning 路径', () => {
    const p = tmpConfigPath();
    paths.push(p);
    // 写入一个带全角 apiKey 的配置文件
    fs.writeFileSync(p, JSON.stringify({
      models: {
        providers: {
          anthropic: {
            baseUrl: 'https://api.anthropic.com',
            apiKey: 'ｓｋ-ant-' + 'X'.repeat(20),  // 全角 sk
            api: 'anthropic-messages',
            models: [],
          },
        },
      },
    }), 'utf-8');

    const cm = new ConfigManager(p);
    const warnings = cm.getSanitizeWarningsOnce();
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain('models.providers.anthropic.apiKey');
  });

  it('一次性消费语义：第二次读取返回空数组', () => {
    const p = tmpConfigPath();
    paths.push(p);
    fs.writeFileSync(p, JSON.stringify({
      models: {
        providers: {
          anthropic: {
            baseUrl: 'https://api.anthropic.com',
            apiKey: 'sk-ant-中文XYZ',  // 含非 ASCII 残余
            api: 'anthropic-messages',
            models: [],
          },
        },
      },
    }), 'utf-8');

    const cm = new ConfigManager(p);
    const first = cm.getSanitizeWarningsOnce();
    expect(first.length).toBe(1);

    const second = cm.getSanitizeWarningsOnce();
    expect(second).toEqual([]);
  });

  it('正常 ASCII 凭证 → 无 warning', () => {
    const p = tmpConfigPath();
    paths.push(p);
    fs.writeFileSync(p, JSON.stringify({
      models: {
        providers: {
          anthropic: {
            baseUrl: 'https://api.anthropic.com',
            apiKey: 'sk-ant-' + 'A'.repeat(40),
            api: 'anthropic-messages',
            models: [],
          },
        },
      },
    }), 'utf-8');

    const cm = new ConfigManager(p);
    expect(cm.getSanitizeWarningsOnce()).toEqual([]);
  });
});
