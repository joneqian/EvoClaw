import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import {
  extractPaths,
  expandTilde,
  getGlobBaseDirectory,
  containsPathTraversal,
  filterOutFlags,
} from '../../security/path-extractors.js';
import {
  validateCommandPaths,
  checkDangerousRemovalPaths,
  isDangerousRemovalPath,
  getBaseCommand,
} from '../../security/path-validation.js';

describe('path-extractors', () => {
  describe('filterOutFlags', () => {
    it('过滤 flag 保留位置参数', () => {
      expect(filterOutFlags(['-r', 'file1', 'file2'])).toEqual(['file1', 'file2']);
    });

    it('POSIX -- 后的参数视为位置参数', () => {
      expect(filterOutFlags(['-r', '--', '-f', 'file'])).toEqual(['-f', 'file']);
    });

    it('带参数的 flag 吃掉下一个 token', () => {
      const result = filterOutFlags(['-n', '10', 'file.txt'], { '-n': 'number' });
      expect(result).toEqual(['file.txt']);
    });
  });

  describe('extractPaths', () => {
    it('rm: 提取删除目标路径', () => {
      expect(extractPaths('rm', ['-rf', '/tmp/data'])).toEqual(['/tmp/data']);
    });

    it('rm: POSIX -- 后的路径', () => {
      expect(extractPaths('rm', ['-rf', '--', '-strange-file'])).toEqual(['-strange-file']);
    });

    it('cp: 提取源和目标路径', () => {
      expect(extractPaths('cp', ['-r', 'src/', 'dest/'])).toEqual(['src/', 'dest/']);
    });

    it('cat: 简单文件路径', () => {
      expect(extractPaths('cat', ['-n', 'file.txt'])).toEqual(['file.txt']);
    });

    it('grep: 第一个位置参数是 pattern，后续是路径', () => {
      expect(extractPaths('grep', ['-r', 'TODO', 'src/', 'tests/'])).toEqual(['src/', 'tests/']);
    });

    it('find: 第一个位置参数是搜索路径', () => {
      expect(extractPaths('find', ['/etc', '-name', '*.conf'])).toEqual(['/etc']);
    });

    it('chmod: 第一个位置参数是 mode，后续是路径', () => {
      expect(extractPaths('chmod', ['755', '/usr/local/bin/app'])).toEqual(['/usr/local/bin/app']);
    });

    it('未知命令返回空数组', () => {
      expect(extractPaths('docker', ['ps', '-a'])).toEqual([]);
    });

    it('cd 无参数返回 home', () => {
      expect(extractPaths('cd', [])).toEqual([os.homedir()]);
    });

    it('ls 无参数返回 .', () => {
      expect(extractPaths('ls', ['-la'])).toEqual(['.']);
    });
  });

  describe('expandTilde', () => {
    it('展开 ~/ 为 homedir', () => {
      expect(expandTilde('~/Documents')).toBe(path.join(os.homedir(), 'Documents'));
    });

    it('展开 ~ 为 homedir', () => {
      expect(expandTilde('~')).toBe(os.homedir());
    });

    it('不展开 ~username', () => {
      expect(expandTilde('~root/data')).toBe('~root/data');
    });

    it('不展开普通路径', () => {
      expect(expandTilde('/tmp/data')).toBe('/tmp/data');
    });
  });

  describe('getGlobBaseDirectory', () => {
    it('提取 glob 基目录', () => {
      expect(getGlobBaseDirectory('/path/to/*.txt')).toBe('/path/to');
    });

    it('根目录 glob', () => {
      expect(getGlobBaseDirectory('/*.txt')).toBe('/');
    });

    it('非 glob 路径返回 null', () => {
      expect(getGlobBaseDirectory('/path/to/file.txt')).toBeNull();
    });

    it('当前目录 glob', () => {
      expect(getGlobBaseDirectory('*.ts')).toBe('.');
    });
  });

  describe('containsPathTraversal', () => {
    it('检测 .. 路径穿越', () => {
      expect(containsPathTraversal('/tmp/../etc/passwd')).toBe(true);
    });

    it('正常路径无穿越', () => {
      expect(containsPathTraversal('/tmp/data/file.txt')).toBe(false);
    });
  });
});

describe('path-validation', () => {
  describe('getBaseCommand', () => {
    it('提取命令 basename', () => {
      expect(getBaseCommand('/usr/bin/git')).toBe('git');
      expect(getBaseCommand('git')).toBe('git');
    });
  });

  describe('isDangerousRemovalPath', () => {
    it('根目录是危险的', () => {
      expect(isDangerousRemovalPath('/')).toBe(true);
    });

    it('/etc 是危险的', () => {
      expect(isDangerousRemovalPath('/etc')).toBe(true);
    });

    it('/usr 是危险的', () => {
      expect(isDangerousRemovalPath('/usr')).toBe(true);
    });

    it('home 目录是危险的', () => {
      expect(isDangerousRemovalPath(os.homedir())).toBe(true);
    });

    it('~/.ssh 是危险的', () => {
      expect(isDangerousRemovalPath(path.join(os.homedir(), '.ssh'))).toBe(true);
    });

    it('普通目录不危险', () => {
      expect(isDangerousRemovalPath('/tmp/my-project')).toBe(false);
    });
  });

  describe('checkDangerousRemovalPaths', () => {
    it('rm -rf / 被拦截', () => {
      const result = checkDangerousRemovalPaths('rm', ['-rf', '/']);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('关键系统路径');
    });

    it('rm -rf /etc 被拦截', () => {
      const result = checkDangerousRemovalPaths('rm', ['-rf', '/etc']);
      expect(result.safe).toBe(false);
    });

    it('rm -rf /tmp/project 放行', () => {
      const result = checkDangerousRemovalPaths('rm', ['-rf', '/tmp/project']);
      expect(result.safe).toBe(true);
    });

    it('非 rm 命令跳过', () => {
      const result = checkDangerousRemovalPaths('ls', ['/']);
      expect(result.safe).toBe(true);
    });

    it('rmdir /usr 被拦截', () => {
      const result = checkDangerousRemovalPaths('rmdir', ['/usr']);
      expect(result.safe).toBe(false);
    });

    it('rm -- 处理 POSIX 双横线后的参数', () => {
      const result = checkDangerousRemovalPaths('rm', ['-rf', '--', '/']);
      expect(result.safe).toBe(false);
    });
  });

  describe('validateCommandPaths', () => {
    it('cat /etc/passwd 检测到受限路径', () => {
      const result = validateCommandPaths('cat', ['/etc/passwd']);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('受限路径');
    });

    it('cat ~/project/file.txt 放行', () => {
      const result = validateCommandPaths('cat', [path.join(os.homedir(), 'project', 'file.txt')]);
      expect(result.safe).toBe(true);
    });

    it('路径穿越被检测', () => {
      const result = validateCommandPaths('cat', ['/tmp/../etc/passwd']);
      expect(result.safe).toBe(false);
      expect(result.reason).toContain('路径穿越');
    });

    it('grep 在 /usr 下搜索被拦截', () => {
      const result = validateCommandPaths('grep', ['-r', 'password', '/usr/share/']);
      expect(result.safe).toBe(false);
    });

    it('未知命令跳过（返回安全）', () => {
      const result = validateCommandPaths('docker', ['ps', '-a']);
      expect(result.safe).toBe(true);
    });

    it('空参数返回安全', () => {
      const result = validateCommandPaths('rm', []);
      expect(result.safe).toBe(true);
    });
  });
});
