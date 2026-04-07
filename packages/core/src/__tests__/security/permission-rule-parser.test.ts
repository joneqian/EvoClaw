import { describe, it, expect } from 'vitest';
import { parsePermissionRule, matchRule } from '../../security/permission-rule-parser.js';

describe('permission-rule-parser', () => {
  describe('parsePermissionRule', () => {
    it('纯类别: shell → { category: "shell" }', () => {
      const result = parsePermissionRule('shell');
      expect(result).toEqual({ category: 'shell' });
    });

    it('子命令: shell(git push) → { category: "shell", ruleContent: "git push" }', () => {
      const result = parsePermissionRule('shell(git push)');
      expect(result).toEqual({ category: 'shell', ruleContent: 'git push' });
    });

    it('通配符: shell(git *) → { category: "shell", ruleContent: "git *" }', () => {
      const result = parsePermissionRule('shell(git *)');
      expect(result).toEqual({ category: 'shell', ruleContent: 'git *' });
    });

    it('路径: file_write(/etc/*) → { category: "file_write", ruleContent: "/etc/*" }', () => {
      const result = parsePermissionRule('file_write(/etc/*)');
      expect(result).toEqual({ category: 'file_write', ruleContent: '/etc/*' });
    });

    it('域名: network(domain:*.internal)', () => {
      const result = parsePermissionRule('network(domain:*.internal)');
      expect(result).toEqual({ category: 'network', ruleContent: 'domain:*.internal' });
    });

    it('空内容等价纯类别: shell()', () => {
      const result = parsePermissionRule('shell()');
      expect(result).toEqual({ category: 'shell' });
    });

    it('* 内容等价纯类别: shell(*)', () => {
      const result = parsePermissionRule('shell(*)');
      expect(result).toEqual({ category: 'shell' });
    });

    it('转义括号: shell(python -c "print\\(1\\)")', () => {
      const result = parsePermissionRule('shell(python -c "print\\(1\\)")');
      expect(result).toEqual({ category: 'shell', ruleContent: 'python -c "print(1)"' });
    });

    it('无效类别返回 null', () => {
      expect(parsePermissionRule('invalid')).toBeNull();
    });

    it('未闭合括号返回 null', () => {
      expect(parsePermissionRule('shell(unclosed')).toBeNull();
    });

    it('空字符串返回 null', () => {
      expect(parsePermissionRule('')).toBeNull();
    });
  });

  describe('matchRule', () => {
    it('纯类别规则匹配所有该类别资源', () => {
      const rule = parsePermissionRule('shell')!;
      expect(matchRule(rule, 'shell', 'git push')).toBe(true);
      expect(matchRule(rule, 'shell', 'docker ps')).toBe(true);
      expect(matchRule(rule, 'file_write', 'anything')).toBe(false);
    });

    it('精确子命令匹配', () => {
      const rule = parsePermissionRule('shell(git push)')!;
      expect(matchRule(rule, 'shell', 'git push')).toBe(true);
      expect(matchRule(rule, 'shell', 'git push origin main')).toBe(true);
      expect(matchRule(rule, 'shell', 'git status')).toBe(false);
    });

    it('通配符匹配', () => {
      const rule = parsePermissionRule('shell(git *)')!;
      expect(matchRule(rule, 'shell', 'git status')).toBe(true);
      expect(matchRule(rule, 'shell', 'git push --force')).toBe(true);
      expect(matchRule(rule, 'shell', 'git')).toBe(true);
      expect(matchRule(rule, 'shell', 'docker ps')).toBe(false);
    });

    it('路径通配符匹配', () => {
      const rule = parsePermissionRule('file_write(/etc/*)')!;
      expect(matchRule(rule, 'file_write', '/etc/passwd')).toBe(true);
      expect(matchRule(rule, 'file_write', '/etc/nginx/conf.d')).toBe(true);
      expect(matchRule(rule, 'file_write', '/tmp/file')).toBe(false);
    });

    it('域名通配符匹配', () => {
      const rule = parsePermissionRule('network(domain:*.internal)')!;
      expect(matchRule(rule, 'network', 'domain:api.internal')).toBe(true);
      expect(matchRule(rule, 'network', 'domain:db.internal')).toBe(true);
      expect(matchRule(rule, 'network', 'domain:api.external.com')).toBe(false);
    });

    it('类别不匹配返回 false', () => {
      const rule = parsePermissionRule('shell(git push)')!;
      expect(matchRule(rule, 'file_write', 'git push')).toBe(false);
    });
  });
});
