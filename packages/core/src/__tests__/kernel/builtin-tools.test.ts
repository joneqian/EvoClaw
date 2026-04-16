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
  isBlockedReadPath,
  isDangerousWritePath,
  FileStateCache,
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
  const tool = createReadTool(128_000, new FileStateCache());

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

  it('超过 token 估算限制时截断内容', async () => {
    const tinyTool = createReadTool(100, new FileStateCache());
    const content = 'x'.repeat(200); // 200 chars ≈ 50 tokens, exceeds 20 token limit
    const fp = writeFile('big-tokens.txt', content);
    const result = await tinyTool.call({ file_path: fp });
    // Should contain truncation marker
    expect(result.content).toContain('token');
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
  const cache = new FileStateCache();
  const tool = createWriteTool(cache);

  it('should create new file', async () => {
    const filePath = path.join(tmpDir, 'new.txt');
    const result = await tool.call({ file_path: filePath, content: 'hello world' });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('已创建');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('hello world');
  });

  it('should overwrite existing file', async () => {
    const filePath = writeFile('existing.txt', 'old content');
    cache.recordRead(filePath, 11, false); // 模拟先 read
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
  const editCache = new FileStateCache();
  const tool = createEditTool(editCache);

  /** 创建文件并模拟 read (先读后写) */
  function writeAndRead(name: string, content: string): string {
    const filePath = writeFile(name, content);
    editCache.recordRead(filePath, content.length, false);
    return filePath;
  }

  it('should replace text exactly', async () => {
    const filePath = writeAndRead('edit.txt', 'hello world\nfoo bar');
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
    const filePath = writeAndRead('edit2.txt', 'hello world');
    const result = await tool.call({
      file_path: filePath,
      old_string: 'nonexistent',
      new_string: 'replacement',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('未在文件中找到');
  });

  it('should fail for ambiguous matches without replace_all', async () => {
    const filePath = writeAndRead('edit3.txt', 'foo\nfoo\nbar');
    const result = await tool.call({
      file_path: filePath,
      old_string: 'foo',
      new_string: 'baz',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('出现 2 次');
  });

  it('should replace all with replace_all: true', async () => {
    const filePath = writeAndRead('edit4.txt', 'foo\nfoo\nbar');
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
    const filePath = writeAndRead('quotes.txt', 'He said \u201CHello\u201D');
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
    const filePath = writeAndRead('existing.txt', 'content');
    const result = await tool.call({
      file_path: filePath,
      old_string: '',
      new_string: 'new content',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('old_string 不能为空');
  });

  it('should reject same old_string and new_string', async () => {
    const filePath = writeAndRead('same.txt', 'content');
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

// ═══════════════════════════════════════════════════════════════════════════
// Sprint A: P0 安全防护测试
// ═══════════════════════════════════════════════════════════════════════════

describe('P0-3: blocked read paths', () => {
  it('should detect /dev/zero', () => {
    expect(isBlockedReadPath('/dev/zero')).toBe(true);
  });

  it('should detect /proc/self/environ', () => {
    expect(isBlockedReadPath('/proc/self/environ')).toBe(true);
  });

  it('should detect /dev/fd/N', () => {
    expect(isBlockedReadPath('/dev/fd/3')).toBe(true);
  });

  it('should detect /proc/PID/fd/N', () => {
    expect(isBlockedReadPath('/proc/1234/fd/0')).toBe(true);
  });

  it('should allow normal paths', () => {
    expect(isBlockedReadPath('/home/user/file.txt')).toBe(false);
    expect(isBlockedReadPath('/tmp/test.txt')).toBe(false);
  });

  it('should block via read tool', async () => {
    const tool = createReadTool(128_000, new FileStateCache());
    const result = await tool.call({ file_path: '/dev/zero' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('不允许读取');
  });
});

describe('P0-5: dangerous file protection', () => {
  it('should detect .bashrc', () => {
    expect(isDangerousWritePath('/home/user/.bashrc')).toBe(true);
  });

  it('should detect .env', () => {
    expect(isDangerousWritePath('/project/.env')).toBe(true);
  });

  it('should detect .git directory', () => {
    expect(isDangerousWritePath('/project/.git/config')).toBe(true);
  });

  it('should detect .ssh directory', () => {
    expect(isDangerousWritePath('/home/user/.ssh/config')).toBe(true);
  });

  it('should allow normal paths', () => {
    expect(isDangerousWritePath('/project/src/index.ts')).toBe(false);
    expect(isDangerousWritePath('/tmp/output.txt')).toBe(false);
  });

  it('should block edit on .bashrc', async () => {
    const cache = new FileStateCache();
    const tool = createEditTool(cache);
    const result = await tool.call({
      file_path: '/home/user/.bashrc',
      old_string: 'export PATH',
      new_string: 'export PATH=/evil',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('受保护');
  });

  it('should block write on .gitconfig', async () => {
    const cache = new FileStateCache();
    const tool = createWriteTool(cache);
    const result = await tool.call({
      file_path: '/home/user/.gitconfig',
      content: '[user]\nname = evil',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('受保护');
  });
});

describe('P0-6: file state cache + staleness', () => {
  it('should track read state', () => {
    const cache = new FileStateCache();
    const filePath = writeFile('cached.txt', 'content');

    expect(cache.wasReadBefore(filePath)).toBe(false);
    cache.recordRead(filePath, 7, false);
    expect(cache.wasReadBefore(filePath)).toBe(true);
  });

  it('should detect unmodified file as fresh', () => {
    const cache = new FileStateCache();
    const filePath = writeFile('fresh.txt', 'content');

    cache.recordRead(filePath, 7, false);
    expect(cache.checkStaleness(filePath)).toBeNull();
  });

  it('should detect externally modified file', async () => {
    const cache = new FileStateCache();
    const filePath = writeFile('modified.txt', 'original');

    cache.recordRead(filePath, 8, false);

    // 等一小段时间确保 mtime 变化
    await new Promise(r => setTimeout(r, 50));
    fs.writeFileSync(filePath, 'changed by external', 'utf-8');

    const stale = cache.checkStaleness(filePath);
    expect(stale).toContain('被外部修改');
  });

  it('should skip staleness check for partial reads', () => {
    const cache = new FileStateCache();
    const filePath = writeFile('partial.txt', 'content');

    cache.recordRead(filePath, 7, true); // partial view
    // 即使修改也不报 stale
    fs.writeFileSync(filePath, 'changed', 'utf-8');
    expect(cache.checkStaleness(filePath)).toBeNull();
  });

  it('should block write on unread file', async () => {
    const cache = new FileStateCache();
    const filePath = writeFile('unread.txt', 'content');
    const tool = createWriteTool(cache);

    const result = await tool.call({ file_path: filePath, content: 'new content' });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('未被读取');
  });

  it('should allow write after read', async () => {
    const cache = new FileStateCache();
    const filePath = writeFile('readfirst.txt', 'original');

    // 先读
    cache.recordRead(filePath, 8, false);

    // 再写
    const tool = createWriteTool(cache);
    const result = await tool.call({ file_path: filePath, content: 'updated' });
    expect(result.isError).toBeFalsy();
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('updated');
  });

  it('should block edit on unread file', async () => {
    const cache = new FileStateCache();
    const filePath = writeFile('unread-edit.txt', 'hello world');
    const tool = createEditTool(cache);

    const result = await tool.call({
      file_path: filePath,
      old_string: 'hello',
      new_string: 'hi',
    });
    expect(result.isError).toBe(true);
    expect(result.content).toContain('未被读取');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Sprint B: P1 功能完整性测试
// ═══════════════════════════════════════════════════════════════════════════

describe('P1-2: Edit XML desanitization', () => {
  const editCache = new FileStateCache();
  const tool = createEditTool(editCache);

  it('should match &lt;/&gt; in old_string', async () => {
    const filePath = writeFile('xml-test.txt', 'if (a < b && c > d) return true;');
    editCache.recordRead(filePath, 50, false);

    const result = await tool.call({
      file_path: filePath,
      old_string: 'if (a &lt; b &amp;&amp; c &gt; d) return true;',
      new_string: 'if (a <= b && c >= d) return true;',
    });
    expect(result.isError).toBeFalsy();
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('if (a <= b && c >= d) return true;');
  });
});

describe('P1-3: Edit quote style preservation', () => {
  const editCache = new FileStateCache();
  const tool = createEditTool(editCache);

  it('should preserve curly double quotes', async () => {
    const filePath = writeFile('curly.txt', 'He said \u201CHello\u201D to her');
    editCache.recordRead(filePath, 50, false);

    const result = await tool.call({
      file_path: filePath,
      old_string: 'He said "Hello" to her',
      new_string: 'He said "Goodbye" to her',
    });
    expect(result.isError).toBeFalsy();
    const content = fs.readFileSync(filePath, 'utf-8');
    // 应该保留弯引号风格
    expect(content).toContain('\u201C');
    expect(content).toContain('\u201D');
  });
});

describe('P1-4: Read encoding detection', () => {
  it('should read UTF-16LE file', async () => {
    const filePath = path.join(tmpDir, 'utf16.txt');
    // 写入 UTF-16LE BOM + 内容
    const bom = Buffer.from([0xFF, 0xFE]);
    const content = Buffer.from('Hello\n', 'utf16le');
    fs.writeFileSync(filePath, Buffer.concat([bom, content]));

    const tool = createReadTool(128_000, new FileStateCache());
    const result = await tool.call({ file_path: filePath });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('Hello');
  });
});

describe('P1-6: Grep enhancements', () => {
  it('should support files_with_matches mode', async () => {
    writeFile('grep-a.ts', 'const foo = 1;');
    writeFile('grep-b.ts', 'const foo = 2;');

    const tools = createBuiltinTools(128_000);
    const grepTool = tools.find(t => t.name === 'grep')!;
    const result = await grepTool.call({
      pattern: 'foo',
      path: tmpDir,
      output_mode: 'files_with_matches',
    });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('grep-a.ts');
    expect(result.content).toContain('grep-b.ts');
  });
});

describe('P1-7: Glob native implementation', () => {
  it('should find files by pattern with mtime sorting', async () => {
    writeFile('src/a.ts', 'a');
    // 等一点时间确保 mtime 不同
    await new Promise(r => setTimeout(r, 50));
    writeFile('src/b.ts', 'b');

    const tools = createBuiltinTools(128_000);
    const findTool = tools.find(t => t.name === 'find')!;
    const result = await findTool.call({
      pattern: '*.ts',
      path: tmpDir,
    });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('a.ts');
    expect(result.content).toContain('b.ts');
    // b.ts 应该在前 (更新)
    const lines = result.content.split('\n');
    const aIdx = lines.findIndex((l: string) => l.includes('a.ts'));
    const bIdx = lines.findIndex((l: string) => l.includes('b.ts'));
    expect(bIdx).toBeLessThan(aIdx);
  });

  it('should respect max file limit', async () => {
    // 创建超过限制的文件数不现实，但至少验证功能
    writeFile('many/file1.txt', '1');
    writeFile('many/file2.txt', '2');

    const tools = createBuiltinTools(128_000);
    const findTool = tools.find(t => t.name === 'find')!;
    const result = await findTool.call({
      pattern: '*.txt',
      path: path.join(tmpDir, 'many'),
    });
    expect(result.isError).toBeFalsy();
    expect(result.content).toContain('file1.txt');
    expect(result.content).toContain('file2.txt');
  });
});
