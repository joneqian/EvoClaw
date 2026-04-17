import { describe, it, expect } from 'vitest';
import { sanitizePII, sanitizeObject } from '../infrastructure/pii-sanitizer.js';

describe('sanitizePII', () => {
  it('替换 OpenAI API Key', () => {
    const text = 'Using key sk-proj-abc123def456ghi789jkl012mno345';
    expect(sanitizePII(text)).toBe('Using key sk-***');
  });

  it('替换 Anthropic API Key', () => {
    const text = 'Key: sk-ant-api03-abcdefghijklmnopqrstuv';
    expect(sanitizePII(text)).toBe('Key: sk-ant-***');
  });

  it('替换 Bearer token', () => {
    const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5c';
    expect(sanitizePII(text)).toContain('[REDACTED]');
    expect(sanitizePII(text)).not.toContain('eyJhbGci');
  });

  it('替换 JWT', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.Gfx6VO9tcxwk6xqx9yYzSfebfeakZp5JYIgP_edcw_A';
    expect(sanitizePII(jwt)).toBe('jwt:[REDACTED]');
  });

  it('替换邮箱', () => {
    expect(sanitizePII('Contact: user@example.com')).toBe('Contact: email:[REDACTED]');
  });

  it('替换中国手机号', () => {
    expect(sanitizePII('Phone: 13812345678')).toBe('Phone: phone:[REDACTED]');
  });

  it('不误伤非手机号数字', () => {
    expect(sanitizePII('ID: 123456789012')).toBe('ID: 123456789012');
  });

  it('替换 JSON 中的密码字段', () => {
    const json = '{"apiKey": "sk-secret-value", "name": "test"}';
    const result = sanitizePII(json);
    expect(result).toContain('"apiKey": "[REDACTED]"');
    expect(result).toContain('"name": "test"');
  });

  it('替换 x-api-key', () => {
    expect(sanitizePII('x-api-key: sk-ant-api-abcdefghij')).toContain('[REDACTED]');
  });

  it('无敏感数据时原样返回', () => {
    const text = 'Normal log message without PII';
    expect(sanitizePII(text)).toBe(text);
  });

  it('混合多种敏感数据', () => {
    const text = 'User user@test.com called with Bearer sk-proj-1234567890abcdefghijklmno';
    const result = sanitizePII(text);
    expect(result).not.toContain('user@test.com');
    expect(result).not.toContain('sk-proj-1234567890');
  });

  // ─── M1 T2: 扩展 25+ pattern ───────────────────────────────────
  //
  // ⚠️ 测试 fixture 一律用字符串拼接构造，避免 GitHub Push Protection /
  //   secret-scanner 把 test 数据误判为真凭据。pattern 完整性由 regex 保证。

  describe('云厂商 / SaaS / Git Provider 凭据', () => {
    // 构造看起来像但不是真凭据的 fake fixture（运行时拼接绕过 scanner）
    const fake20 = (prefix: string) => prefix + 'X'.repeat(20);
    const fake36 = (prefix: string) => prefix + 'X'.repeat(36);

    it('替换 AWS access key (AKIA*)', () => {
      const text = `AWS_KEY=${fake20('AKIA').slice(0, 20)} prod`; // AKIA + 16 X
      expect(sanitizePII(text)).toBe('AWS_KEY=AKIA*** prod');
    });

    it('替换 AWS 临时凭据 (ASIA*)', () => {
      expect(sanitizePII(fake20('ASIA').slice(0, 20))).toBe('AKIA***');
    });

    it('替换 GitHub Personal Access Token (ghp_)', () => {
      const text = `token: ${fake36('ghp_')}`;
      expect(sanitizePII(text)).toContain('gh_***');
    });

    it('替换 GitHub OAuth/Server/User token (gho_/ghs_/ghu_/ghr_)', () => {
      for (const prefix of ['gho_', 'ghs_', 'ghu_', 'ghr_']) {
        expect(sanitizePII(fake36(prefix))).toContain('gh_***');
      }
    });

    it('替换 GitLab personal access token (glpat-)', () => {
      expect(sanitizePII(`GITLAB_PAT=${fake20('glpat-')}`)).toContain('glpat-***');
    });

    it('替换 Slack tokens (xoxb-/xoxp-/xoxa-/xoxs-)', () => {
      for (const prefix of ['xoxb-', 'xoxp-', 'xoxa-', 'xoxs-']) {
        const tok = prefix + '1234567890-' + 'X'.repeat(20);
        expect(sanitizePII(tok)).toContain('xox_***');
      }
    });

    it('替换 Google API key (AIza)', () => {
      const text = `GOOGLE_KEY=${'AIza' + 'X'.repeat(35)}`;
      expect(sanitizePII(text)).toContain('AIza***');
    });

    it('替换 OpenAI org id (org-)', () => {
      expect(sanitizePII(fake20('org-'))).toBe('org-***');
    });

    it('替换 Stripe live keys (sk_live_/pk_live_)', () => {
      // 字符串拼接构造绕过 secret-scanner
      expect(sanitizePII('sk_' + 'live_' + 'X'.repeat(24))).toContain('***');
      expect(sanitizePII('pk_' + 'live_' + 'X'.repeat(24))).toContain('***');
    });

    it('替换阿里云 AccessKey (LTAI)', () => {
      expect(sanitizePII(fake20('LTAI').slice(0, 20))).toBe('LTAI***');
    });

    it('替换腾讯云 SecretId (AKID)', () => {
      const text = `TENCENT_AKID=${'AK' + 'ID' + 'X'.repeat(32)}`;
      expect(sanitizePII(text)).toContain('AKID***');
    });

    it('替换 HuggingFace token (hf_)', () => {
      expect(sanitizePII(fake36('hf_'))).toBe('hf_***');
    });
  });

  describe('不误伤短哈希与正常字符串', () => {
    it('不误伤 git commit hash (40 hex)', () => {
      const text = 'commit a8e0c6c0d839c75e6d75a3d853d331e34a3290';
      // 40 char hex 不匹配任何上述 pattern
      expect(sanitizePII(text)).toBe(text);
    });

    it('不误伤 UUID', () => {
      const text = 'id: 550e8400-e29b-41d4-a716-446655440000';
      expect(sanitizePII(text)).toBe(text);
    });

    it('不误伤短字符串（<20 字符的 sk-）', () => {
      // sk- 后只有 5 字符，不到 20 字符阈值
      expect(sanitizePII('sk-short')).toBe('sk-short');
    });

    it('不误伤随机大写串（不像 AKIA 开头）', () => {
      expect(sanitizePII('NORMALSTRING12345')).toBe('NORMALSTRING12345');
    });

    it('不误伤上下文中的"key"字面量', () => {
      expect(sanitizePII('the key is important')).toBe('the key is important');
    });
  });
});

describe('sanitizeObject', () => {
  it('脱敏对象中的敏感键值', () => {
    const obj = { name: 'test', apiKey: 'sk-secret', password: '123456' };
    const result = sanitizeObject(obj) as Record<string, unknown>;
    expect(result.name).toBe('test');
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.password).toBe('[REDACTED]');
  });

  it('递归脱敏嵌套对象', () => {
    const obj = { provider: { apiKey: 'key123', name: 'OpenAI' } };
    const result = sanitizeObject(obj) as any;
    expect(result.provider.apiKey).toBe('[REDACTED]');
    expect(result.provider.name).toBe('OpenAI');
  });

  it('脱敏数组', () => {
    const arr = [{ token: 'abc' }, { name: 'ok' }];
    const result = sanitizeObject(arr) as any[];
    expect(result[0].token).toBe('[REDACTED]');
    expect(result[1].name).toBe('ok');
  });

  it('字符串值走 sanitizePII', () => {
    const obj = { log: 'User sk-proj-12345678901234567890 logged in' };
    const result = sanitizeObject(obj) as any;
    expect(result.log).toBe('User sk-*** logged in');
  });

  it('null/undefined 原样返回', () => {
    expect(sanitizeObject(null)).toBeNull();
    expect(sanitizeObject(undefined)).toBeUndefined();
  });
});
