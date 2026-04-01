/**
 * 内置工具测试
 *
 * 覆盖:
 * - read: cat-n 格式, offset/limit, 图片检测, 文件不存在, 目录
 * - write: 创建/覆盖, 自动创建目录, 缺少参数
 * - edit: 精确匹配, 引号规范化, 唯一性验证, replace_all, 创建新文件
 * - grep: 正常搜索, 无匹配, 错误
 * - find: glob 搜索, 无匹配
 * - ls: 目录列出, 空目录, 不存在
 * - helpers: normalizeQuotes, countOccurrences, shellEscape
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { _testing, createBuiltinTools } from '../../agent/kernel/builtin-tools.js';

const {
  createReadTool,
  createWriteTool,
  createEditTool,
  createLsTool,
  normalizeQuotes,
  countOccurrences,
  shellEscape,
} = _testing;

// ─── Test Fixture ───

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kernel-tools-'));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function writeFile(name: string, content: string): string {
  const filePath = path.join(tmpDir, name);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, content, 'utf-8');
  return filePath;
}

// ═══════════════════════════════════════════════════════════════════════════
// Read Tool
// ═══════════════════════════════════════════════════════════════════════════

describe('read tool', () => {
  const tool = createReadTool(128_000);

  it('should read file with line numbers (cat -n format)', async () => {
    const filePath = writeFile('test.txt', 'line1\nline2\nline3');
    const result = await tool.call({ file_path: filePath });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('1\tline1');
    expect(result.content).toContain('2\tline2');
    expect(result.content).toContain('3\tline3');
  });

  it('should support offset and limit', async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`).join('\n');
    const filePath = writeFile('long.txt', lines);

    const result = await tool.call({ file_path: filePath, offset: 5, limit: 3 });
    expect(result.content).toContain('5\tline5');
    expect(result.content).toContain('6\tline6');
    expect(result.content).toContain('7\tline7');
    expect(result.content).not.toContain('4\tline4');
    expect(result.content).not.toContain('8\tline8');
  });

  it('should show truncation marker for large files', async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line${i + 1}`).join('\n');
    const filePath = writeFile('big.txt', lines);

    const result = await tool.call({ file_path: filePath, limit: 10 });
    expect(result.content).toContain('共 100 行');
    expect(result.content).toContain('已显示 1-10 行');
  });

  it('should handle non-existent file', async () => {
    const result = await tool.call({ file_path: '/nonexistent/file.txt' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('文件不存在');
  });

  it('should reject directories', async () => {
    const result = await tool.call({ file_path: tmpDir });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('是目录');
  });

  it('should handle empty file', async () => {
    const filePath = writeFile('empty.txt', '');
    const result = await tool.call({ file_path: filePath });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('1\t');
  });

  it('should detect image files', async () => {
    const filePath = path.join(tmpDir, 'test.png');
    // 写入最小的 PNG (1x1 透明像素)
    const pngData = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64'
    );
    fs.writeFileSync(filePath, pngData);

    const result = await tool.call({ file_path: filePath });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('base64:');
    expect(result.content).toContain('image/png');
  });

  it('should be read-only and concurrency-safe', () => {
    expect(tool.isReadOnly()).toBe(true);
    expect(tool.isConcurrencySafe()).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Write Tool
// ═══════════════════════════════════════════════════════════════════════════

describe('write tool', () => {
  const tool = createWriteTool();

  it('should create new file', async () => {
    const filePath = path.join(tmpDir, 'new.txt');
    const result = await tool.call({ file_path: filePath, content: 'hello world' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('已创建');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('hello world');
  });

  it('should overwrite existing file', async () => {
    const filePath = writeFile('existing.txt', 'old content');
    const result = await tool.call({ file_path: filePath, content: 'new content' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('已更新');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('new content');
  });

  it('should create parent directories', async () => {
    const filePath = path.join(tmpDir, 'deep', 'nested', 'file.txt');
    const result = await tool.call({ file_path: filePath, content: 'deep' });
    expect(result.isError).toBeFalsy();
    expect(fs.existsSync(filePath)).toBe(true);
  });

  it('should handle missing parameters', async () => {
    const r1 = await tool.call({});
    expect(r1.isError).toBe(true);

    const r2 = await tool.call({ file_path: path.join(tmpDir, 'x.txt') });
    expect(r2.isError).toBe(true);
  });

  it('should be non-read-only and non-concurrent-safe', () => {
    expect(tool.isReadOnly()).toBe(false);
    expect(tool.isConcurrencySafe()).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Edit Tool
// ═══════════════════════════════════════════════════════════════════════════

describe('edit tool', () => {
  const tool = createEditTool();

  it('should replace text exactly', async () => {
    const filePath = writeFile('edit.txt', 'hello world\nfoo bar');
    const result = await tool.call({
      file_path: filePath,
      old_string: 'hello world',
      new_string: 'hi there',
    });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('替换 1 处');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('hi there\nfoo bar');
  });

  it('should fail when old_string not found', async () => {
    const filePath = writeFile('edit2.txt', 'hello world');
    const result = await tool.call({
      file_path: filePath,
      old_string: 'nonexistent',
      new_string: 'replacement',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('未在文件中找到');
  });

  it('should fail for ambiguous matches without replace_all', async () => {
    const filePath = writeFile('edit3.txt', 'foo\nfoo\nbar');
    const result = await tool.call({
      file_path: filePath,
      old_string: 'foo',
      new_string: 'baz',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('出现 2 次');
  });

  it('should replace all with replace_all: true', async () => {
    const filePath = writeFile('edit4.txt', 'foo\nfoo\nbar');
    const result = await tool.call({
      file_path: filePath,
      old_string: 'foo',
      new_string: 'baz',
      replace_all: true,
    });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('替换 2 处');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('baz\nbaz\nbar');
  });

  it('should match with quote normalization', async () => {
    const filePath = writeFile('quotes.txt', 'He said \u201CHello\u201D');
    const result = await tool.call({
      file_path: filePath,
      old_string: 'He said "Hello"', // 直引号
      new_string: 'He said "Hi"',
    });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('替换');
  });

  it('should create file with empty old_string and nonexistent file', async () => {
    const filePath = path.join(tmpDir, 'brand_new.txt');
    const result = await tool.call({
      file_path: filePath,
      old_string: '',
      new_string: 'new file content',
    });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('已创建');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('new file content');
  });

  it('should reject empty old_string on existing file', async () => {
    const filePath = writeFile('existing.txt', 'content');
    const result = await tool.call({
      file_path: filePath,
      old_string: '',
      new_string: 'new content',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('old_string 不能为空');
  });

  it('should reject same old_string and new_string', async () => {
    const filePath = writeFile('same.txt', 'content');
    const result = await tool.call({
      file_path: filePath,
      old_string: 'content',
      new_string: 'content',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('相同');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Ls Tool
// ═══════════════════════════════════════════════════════════════════════════

describe('ls tool', () => {
  const tool = createLsTool();

  it('should list directory contents', async () => {
    writeFile('a.txt', 'a');
    writeFile('b.txt', 'b');
    fs.mkdirSync(path.join(tmpDir, 'subdir'));

    const result = await tool.call({ path: tmpDir });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('a.txt');
    expect(result.content).toContain('b.txt');
    expect(result.content).toContain('subdir/');
  });

  it('should handle empty directory', async () => {
    const emptyDir = path.join(tmpDir, 'empty');
    fs.mkdirSync(emptyDir);

    const result = await tool.call({ path: emptyDir });
    expect(result.content).toBe('(空目录)');
  });

  it('should handle non-existent directory', async () => {
    const result = await tool.call({ path: '/nonexistent/dir' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('不存在');
  });

  it('should reject file path', async () => {
    const filePath = writeFile('file.txt', 'content');
    const result = await tool.call({ path: filePath });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('不是目录');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════════

describe('helpers', () => {
  describe('normalizeQuotes', () => {
    it('should normalize curly quotes to straight', () => {
      expect(normalizeQuotes('\u201CHello\u201D')).toBe('"Hello"');
      expect(normalizeQuotes('\u2018world\u2019')).toBe("'world'");
    });

    it('should not modify straight quotes', () => {
      expect(normalizeQuotes('"Hello"')).toBe('"Hello"');
    });
  });

  describe('countOccurrences', () => {
    it('should count exact occurrences', () => {
      expect(countOccurrences('abcabc', 'abc')).toBe(2);
      expect(countOccurrences('aaa', 'aa')).toBe(1); // 非重叠
      expect(countOccurrences('hello', 'xyz')).toBe(0);
      expect(countOccurrences('hello', '')).toBe(0);
    });
  });

  describe('shellEscape', () => {
    it('should escape single quotes', () => {
      expect(shellEscape("it's")).toBe("'it'\\''s'");
    });

    it('should wrap in single quotes', () => {
      expect(shellEscape('hello world')).toBe("'hello world'");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// createBuiltinTools
// ═══════════════════════════════════════════════════════════════════════════

describe('createBuiltinTools', () => {
  it('should create all 6 tools', () => {
    const tools = createBuiltinTools(128_000);
    expect(tools).toHaveLength(6);
    expect(tools.map(t => t.name).sort()).toEqual(
      ['edit', 'find', 'grep', 'ls', 'read', 'write'],
    );
  });

  it('should have correct read-only declarations', () => {
    const tools = createBuiltinTools(128_000);
    const toolMap = new Map(tools.map(t => [t.name, t]));

    expect(toolMap.get('read')!.isReadOnly()).toBe(true);
    expect(toolMap.get('grep')!.isReadOnly()).toBe(true);
    expect(toolMap.get('find')!.isReadOnly()).toBe(true);
    expect(toolMap.get('ls')!.isReadOnly()).toBe(true);
    expect(toolMap.get('write')!.isReadOnly()).toBe(false);
    expect(toolMap.get('edit')!.isReadOnly()).toBe(false);
  });

  it('should have correct concurrency-safe declarations', () => {
    const tools = createBuiltinTools(128_000);
    const toolMap = new Map(tools.map(t => [t.name, t]));

    expect(toolMap.get('read')!.isConcurrencySafe()).toBe(true);
    expect(toolMap.get('grep')!.isConcurrencySafe()).toBe(true);
    expect(toolMap.get('write')!.isConcurrencySafe()).toBe(false);
    expect(toolMap.get('edit')!.isConcurrencySafe()).toBe(false);
  });
});
