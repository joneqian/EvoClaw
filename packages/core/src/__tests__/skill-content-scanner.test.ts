import { describe, it, expect } from 'vitest';
import { scanSkillMd, SKILL_NAME_REGEX } from '../skill/skill-content-scanner.js';

function md(frontmatter: string, body: string): string {
  return `---\n${frontmatter}\n---\n\n${body}\n`;
}

describe('skill-content-scanner', () => {
  describe('frontmatter validation', () => {
    it('合法 SKILL.md 返回 ok=true + parsedName/parsedDescription', () => {
      const r = scanSkillMd(md('name: my-skill\ndescription: test desc', 'body'));
      expect(r.ok).toBe(true);
      expect(r.riskLevel).toBe('low');
      expect(r.parsedName).toBe('my-skill');
      expect(r.parsedDescription).toBe('test desc');
    });

    it('缺 frontmatter → 失败', () => {
      const r = scanSkillMd('no frontmatter here');
      expect(r.ok).toBe(false);
      expect(r.frontmatterError).toContain('SKILL.md 解析失败');
    });

    it('缺 name → 失败', () => {
      const r = scanSkillMd(md('description: test', 'body'));
      expect(r.ok).toBe(false);
    });

    it('缺 description → 失败', () => {
      const r = scanSkillMd(md('name: my-skill', 'body'));
      expect(r.ok).toBe(false);
    });

    it('name 含大写 → Zod 拒绝', () => {
      const r = scanSkillMd(md('name: MySkill\ndescription: d', 'body'));
      expect(r.ok).toBe(false);
      expect(r.frontmatterError).toContain('小写字母');
    });

    it('name 过短（1 位）→ Zod 拒绝', () => {
      const r = scanSkillMd(md('name: a\ndescription: d', 'body'));
      expect(r.ok).toBe(false);
    });

    it('name 含路径遍历 → Zod 拒绝', () => {
      const r = scanSkillMd(md('name: ../evil\ndescription: d', 'body'));
      expect(r.ok).toBe(false);
    });

    it('expectedName 不一致 → 失败', () => {
      const r = scanSkillMd(md('name: actual\ndescription: d', 'body'), { expectedName: 'expected' });
      expect(r.ok).toBe(false);
      expect(r.frontmatterError).toContain('不一致');
    });
  });

  describe('security scanning', () => {
    it('含 eval(...) → high', () => {
      const r = scanSkillMd(md('name: sk\ndescription: d', 'Use `eval(userInput)` here'));
      expect(r.ok).toBe(false);
      expect(r.riskLevel).toBe('high');
      expect(r.findings.some(f => f.type === 'eval')).toBe(true);
    });

    it('含 new Function(...) → high', () => {
      const r = scanSkillMd(md('name: sk\ndescription: d', 'code: new Function("x", "return x")'));
      expect(r.ok).toBe(false);
      expect(r.riskLevel).toBe('high');
    });

    it('含 fetch(...) → medium', () => {
      const r = scanSkillMd(md('name: sk\ndescription: d', 'Example: fetch("https://api.example.com/data")'));
      // medium 风险默认不拒，ok=true
      expect(r.riskLevel).toBe('medium');
      expect(r.ok).toBe(true);
    });

    it('纯文档说明（无代码）→ low', () => {
      const r = scanSkillMd(md('name: sk\ndescription: d', '# Usage\n\nThis skill helps with X.'));
      expect(r.ok).toBe(true);
      expect(r.riskLevel).toBe('low');
    });
  });

  describe('credential scanning', () => {
    it('硬编码 API Key → high', () => {
      const r = scanSkillMd(md('name: sk\ndescription: d', 'apiKey: sk-abc123def456ghi789'));
      expect(r.ok).toBe(false);
      expect(r.findings.some(f => f.severity === 'high')).toBe(true);
    });

    it('硬编码 password → high', () => {
      const r = scanSkillMd(md('name: sk\ndescription: d', 'password=hunter2real'));
      expect(r.ok).toBe(false);
    });

    it('占位符 <your-api-key> → 允许（不算泄漏）', () => {
      const r = scanSkillMd(md('name: sk\ndescription: d', 'apiKey: <your-api-key>'));
      expect(r.ok).toBe(true);
    });

    it('占位符 ${API_KEY} → 允许', () => {
      const r = scanSkillMd(md('name: sk\ndescription: d', 'token: ${API_KEY}'));
      expect(r.ok).toBe(true);
    });

    it('占位符 {{API_KEY}} → 允许', () => {
      const r = scanSkillMd(md('name: sk\ndescription: d', 'token: {{API_KEY}}'));
      expect(r.ok).toBe(true);
    });
  });

  describe('SKILL_NAME_REGEX', () => {
    it('合法值', () => {
      expect(SKILL_NAME_REGEX.test('ab')).toBe(true);
      expect(SKILL_NAME_REGEX.test('my-skill-1')).toBe(true);
      expect(SKILL_NAME_REGEX.test('a1b2c3')).toBe(true);
    });

    it('非法值', () => {
      expect(SKILL_NAME_REGEX.test('a')).toBe(false);               // 太短
      expect(SKILL_NAME_REGEX.test('-leading-dash')).toBe(false);   // 不以字母/数字开头
      expect(SKILL_NAME_REGEX.test('MySkill')).toBe(false);         // 大写
      expect(SKILL_NAME_REGEX.test('my_skill')).toBe(false);        // 下划线
      expect(SKILL_NAME_REGEX.test('my.skill')).toBe(false);        // 点
      expect(SKILL_NAME_REGEX.test('../evil')).toBe(false);         // 路径
      expect(SKILL_NAME_REGEX.test('a'.repeat(65))).toBe(false);    // 超长
    });
  });
});
