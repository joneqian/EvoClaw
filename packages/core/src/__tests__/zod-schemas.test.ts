import { describe, it, expect } from 'vitest';
import {
  safeParseConfig,
  safeParseSecurityPolicy,
  safeParseManifest,
  safeParseMcpConfig,
} from '@evoclaw/shared';

describe('Zod Schemas', () => {
  describe('configSchema', () => {
    it('空对象通过验证', () => {
      const result = safeParseConfig({});
      expect(result.success).toBe(true);
    });

    it('完整配置通过验证', () => {
      const result = safeParseConfig({
        models: {
          default: 'openai/gpt-4o',
          providers: {
            openai: {
              baseUrl: 'https://api.openai.com/v1',
              apiKey: 'sk-test',
              api: 'openai-completions',
              models: [{ id: 'gpt-4o', name: 'GPT-4o' }],
            },
          },
        },
        language: 'zh',
        thinking: 'auto',
      });
      expect(result.success).toBe(true);
    });

    it('无效 language 值被拒绝', () => {
      const result = safeParseConfig({ language: 'fr' });
      expect(result.success).toBe(false);
    });

    it('空 baseUrl 被拒绝', () => {
      const result = safeParseConfig({
        models: {
          providers: {
            test: {
              baseUrl: '',
              apiKey: 'key',
              api: 'openai-completions',
              models: [],
            },
          },
        },
      });
      expect(result.success).toBe(false);
    });

    it('允许未知字段（向前兼容）', () => {
      const result = safeParseConfig({ futureField: true });
      expect(result.success).toBe(true);
    });
  });

  describe('securityPolicySchema', () => {
    it('空对象通过', () => {
      expect(safeParseSecurityPolicy({}).success).toBe(true);
    });

    it('完整策略通过', () => {
      const result = safeParseSecurityPolicy({
        skills: { allowlist: ['a'], denylist: ['b'], disabled: ['c'] },
        mcpServers: { denylist: ['bad-server'] },
      });
      expect(result.success).toBe(true);
    });

    it('非字符串数组被拒绝', () => {
      const result = safeParseSecurityPolicy({
        skills: { allowlist: [123] },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('manifestSchema', () => {
    it('完整 manifest 通过', () => {
      const result = safeParseManifest({
        manifestVersion: 1,
        name: 'test-pack',
        description: 'A test pack',
        version: '1.0.0',
        skills: ['skill-a'],
      });
      expect(result.success).toBe(true);
    });

    it('缺少 name 被拒绝', () => {
      const result = safeParseManifest({
        manifestVersion: 1,
        description: 'No name',
        version: '1.0.0',
      });
      expect(result.success).toBe(false);
    });

    it('错误 manifestVersion 被拒绝', () => {
      const result = safeParseManifest({
        manifestVersion: 2,
        name: 'test',
        description: 'test',
        version: '1.0.0',
      });
      expect(result.success).toBe(false);
    });

    it('空 name 被拒绝', () => {
      const result = safeParseManifest({
        manifestVersion: 1,
        name: '',
        description: 'test',
        version: '1.0.0',
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(i => i.message.includes('name'))).toBe(true);
      }
    });
  });

  describe('mcpServerConfigSchema', () => {
    it('stdio 配置通过', () => {
      const result = safeParseMcpConfig({
        name: 'test-server',
        type: 'stdio',
        command: 'node',
        args: ['server.js'],
      });
      expect(result.success).toBe(true);
    });

    it('sse 配置通过', () => {
      const result = safeParseMcpConfig({
        name: 'remote-server',
        type: 'sse',
        url: 'https://mcp.example.com',
      });
      expect(result.success).toBe(true);
    });

    it('无效 type 被拒绝', () => {
      const result = safeParseMcpConfig({
        name: 'bad',
        type: 'websocket',
      });
      expect(result.success).toBe(false);
    });

    it('缺少 name 被拒绝', () => {
      const result = safeParseMcpConfig({
        type: 'stdio',
        command: 'node',
      });
      expect(result.success).toBe(false);
    });
  });
});
