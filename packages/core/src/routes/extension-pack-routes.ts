/**
 * 扩展包管理路由
 */

import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ConfigManager } from '../infrastructure/config-manager.js';
import { parseExtensionPack } from '../extension-pack/pack-parser.js';
import { installExtensionPack } from '../extension-pack/pack-installer.js';
import { listInstalledPacks, unregisterPack } from '../extension-pack/pack-registry.js';

/** 创建扩展包路由 */
export function createExtensionPackRoutes(configManager: ConfigManager): Hono {
  const app = new Hono();

  /** POST /install — 上传 ZIP 并安装 */
  app.post('/install', async (c) => {
    try {
      const body = await c.req.parseBody();
      const file = body['file'];
      if (!file || !(file instanceof File)) {
        return c.json({ error: '请上传 ZIP 文件' }, 400);
      }

      // 保存到临时文件
      const tempPath = path.join(os.tmpdir(), `evoclaw-pack-upload-${Date.now()}.zip`);
      const buffer = await file.arrayBuffer();
      fs.writeFileSync(tempPath, Buffer.from(buffer));

      const agentId = (body['agentId'] as string) || undefined;

      // 解析
      const parsed = await parseExtensionPack(tempPath);

      // 清理临时 ZIP
      try { fs.unlinkSync(tempPath); } catch { /* ignore */ }

      if (parsed.errors.length > 0) {
        // 清理临时解压目录
        try { fs.rmSync(parsed.tempDir, { recursive: true, force: true }); } catch { /* ignore */ }
        return c.json({ success: false, errors: parsed.errors }, 400);
      }

      // 安装
      const result = await installExtensionPack(parsed, configManager, agentId);
      return c.json(result, result.success ? 200 : 500);
    } catch (err) {
      return c.json({ error: `安装失败: ${err instanceof Error ? err.message : String(err)}` }, 500);
    }
  });

  /** POST /preview — 上传 ZIP 预览内容（不安装） */
  app.post('/preview', async (c) => {
    try {
      const body = await c.req.parseBody();
      const file = body['file'];
      if (!file || !(file instanceof File)) {
        return c.json({ error: '请上传 ZIP 文件' }, 400);
      }

      const tempPath = path.join(os.tmpdir(), `evoclaw-pack-preview-${Date.now()}.zip`);
      const buffer = await file.arrayBuffer();
      fs.writeFileSync(tempPath, Buffer.from(buffer));

      const parsed = await parseExtensionPack(tempPath);

      // 清理
      try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
      try { fs.rmSync(parsed.tempDir, { recursive: true, force: true }); } catch { /* ignore */ }

      return c.json({
        manifest: parsed.manifest,
        skills: parsed.skillDirs.map(d => path.basename(d)),
        errors: parsed.errors,
      });
    } catch (err) {
      return c.json({ error: `预览失败: ${err instanceof Error ? err.message : String(err)}` }, 500);
    }
  });

  /** GET /installed — 列出已安装的扩展包 */
  app.get('/installed', (c) => {
    return c.json({ packs: listInstalledPacks() });
  });

  /** DELETE /:name — 卸载扩展包（仅移除注册记录） */
  app.delete('/:name', (c) => {
    const name = c.req.param('name');
    const agentId = c.req.query('agentId') || undefined;
    const removed = unregisterPack(name, agentId);
    return c.json({ success: removed });
  });

  return app;
}
