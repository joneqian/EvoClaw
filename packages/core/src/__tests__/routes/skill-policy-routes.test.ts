/**
 * M7-Tier2 PR5: GET/POST /skill/policy 端到端测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { createSkillRoutes } from '../../routes/skill.js';
import { DEFAULT_INSTALL_POLICY_MATRIX } from '../../skill/install-policy.js';

describe('skill policy routes (M7-Tier2 PR5)', () => {
  let app: Hono;

  beforeEach(() => {
    app = new Hono();
  });

  describe('GET /skill/policy', () => {
    it('未注入 override 时返回完整默认矩阵', async () => {
      app.route('/skill', createSkillRoutes({}));
      const res = await app.request('/skill/policy');
      expect(res.status).toBe(200);
      const body = await res.json() as {
        default: Record<string, string>;
        override: Record<string, string>;
      };
      expect(body.default).toEqual(DEFAULT_INSTALL_POLICY_MATRIX);
      expect(body.override).toEqual({});
    });

    it('注入 override 时回显（不与 default 合并，让前端区分）', async () => {
      app.route('/skill', createSkillRoutes({
        getPolicyOverride: () => ({ 'github:low': 'auto' }),
      }));
      const res = await app.request('/skill/policy');
      const body = await res.json() as {
        default: Record<string, string>;
        override: Record<string, string>;
      };
      expect(body.default['github:low']).toBe('require-confirm'); // 默认
      expect(body.override['github:low']).toBe('auto');           // 覆盖
    });
  });

  describe('POST /skill/policy', () => {
    it('未注入 ConfigManager → 503', async () => {
      app.route('/skill', createSkillRoutes({}));
      const res = await app.request('/skill/policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ override: { 'github:low': 'auto' } }),
      });
      expect(res.status).toBe(503);
    });

    it('合法 override 写入 + 与默认相同的项被剔除（节省存储）', async () => {
      let updated: { security?: { skillInstallPolicy?: Record<string, string> } } | null = null;
      const fakeCm = {
        getConfig: () => ({ security: {} }),
        updateConfig: (next: { security?: { skillInstallPolicy?: Record<string, string> } }) => { updated = next; },
      };
      app.route('/skill', createSkillRoutes({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        configManager: fakeCm as any,
      }));
      const res = await app.request('/skill/policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          override: {
            'github:low': 'auto',         // 改：默认 require-confirm，新值 auto
            'bundled:low': 'auto',        // 与默认相同：应被剔除
            'clawhub:high': 'require-confirm', // 改：默认 block，新值 require-confirm
          },
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json() as { ok: boolean; override: Record<string, string> };
      expect(body.ok).toBe(true);
      expect(body.override['github:low']).toBe('auto');
      expect(body.override['clawhub:high']).toBe('require-confirm');
      expect(body.override['bundled:low']).toBeUndefined();   // 与默认相同 → 剔除
      expect(updated!.security!.skillInstallPolicy!['bundled:low']).toBeUndefined();
    });

    it('非法 key 格式 → 400', async () => {
      const fakeCm = {
        getConfig: () => ({ security: {} }),
        updateConfig: () => { /* noop */ },
      };
      app.route('/skill', createSkillRoutes({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        configManager: fakeCm as any,
      }));
      const res = await app.request('/skill/policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ override: { 'bad-key': 'auto' } }),
      });
      expect(res.status).toBe(400);
    });

    it('非法 source → 400', async () => {
      const fakeCm = {
        getConfig: () => ({ security: {} }),
        updateConfig: () => { /* noop */ },
      };
      app.route('/skill', createSkillRoutes({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        configManager: fakeCm as any,
      }));
      const res = await app.request('/skill/policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ override: { 'evilsource:low': 'auto' } }),
      });
      expect(res.status).toBe(400);
    });

    it('非法 policy 值 → 400', async () => {
      const fakeCm = {
        getConfig: () => ({ security: {} }),
        updateConfig: () => { /* noop */ },
      };
      app.route('/skill', createSkillRoutes({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        configManager: fakeCm as any,
      }));
      const res = await app.request('/skill/policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ override: { 'github:low': 'evilpolicy' } }),
      });
      expect(res.status).toBe(400);
    });

    it('空 body → 400', async () => {
      const fakeCm = {
        getConfig: () => ({ security: {} }),
        updateConfig: () => { /* noop */ },
      };
      app.route('/skill', createSkillRoutes({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        configManager: fakeCm as any,
      }));
      const res = await app.request('/skill/policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not json',
      });
      expect(res.status).toBe(400);
    });

    it('全部清空 override → 写入空对象', async () => {
      let updated: { security?: { skillInstallPolicy?: Record<string, string> } } | null = null;
      const fakeCm = {
        getConfig: () => ({ security: {} }),
        updateConfig: (next: { security?: { skillInstallPolicy?: Record<string, string> } }) => { updated = next; },
      };
      app.route('/skill', createSkillRoutes({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        configManager: fakeCm as any,
      }));
      const res = await app.request('/skill/policy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ override: {} }),
      });
      expect(res.status).toBe(200);
      expect(updated!.security!.skillInstallPolicy).toEqual({});
    });
  });
});
