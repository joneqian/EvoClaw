/**
 * Memory Flush 四层防护测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  buildMemoryFlushPrompt,
  isAllowedFlushWritePath,
  guardFlushWritePath,
  createFlushPermissionInterceptor,
  isAllowedMemoryFile,
  isDatedMemoryFile,
  listValidMemoryFiles,
  shouldTriggerFlush,
  ensureMemoryDir,
  appendToTodayMemory,
  MEMORY_FLUSH_ALLOWED_TOOLS,
} from '../agent/memory-flush.js';

// ─── Layer 1: Write 路径守卫 ───

describe('Layer 1: write 路径守卫', () => {
  it('允许 memory/YYYY-MM-DD.md 格式', () => {
    expect(isAllowedFlushWritePath('memory/2026-03-26.md')).toBe(true);
    expect(isAllowedFlushWritePath('/home/user/.evoclaw/agents/abc/workspace/memory/2026-03-26.md')).toBe(true);
  });

  it('拒绝非日期格式的 memory 文件', () => {
    expect(isAllowedFlushWritePath('memory/notes.md')).toBe(false);
    expect(isAllowedFlushWritePath('memory/2026-03-26.html')).toBe(false);
    expect(isAllowedFlushWritePath('memory/2026-03-26.txt')).toBe(false);
  });

  it('拒绝 memory 目录外的文件', () => {
    expect(isAllowedFlushWritePath('MEMORY.md')).toBe(false);
    expect(isAllowedFlushWritePath('output/report.md')).toBe(false);
    expect(isAllowedFlushWritePath('2026-03-26.md')).toBe(false);
  });

  it('拒绝非 .md 文件', () => {
    expect(isAllowedFlushWritePath('memory/image.png')).toBe(false);
    expect(isAllowedFlushWritePath('memory/report.pdf')).toBe(false);
    expect(isAllowedFlushWritePath('memory/page.html')).toBe(false);
  });

  it('guardFlushWritePath 对非法路径抛出错误', () => {
    expect(() => guardFlushWritePath('memory/notes.md')).toThrow('restricted');
    expect(() => guardFlushWritePath('SOUL.md')).toThrow('restricted');
  });

  it('guardFlushWritePath 对合法路径不抛出', () => {
    expect(() => guardFlushWritePath('memory/2026-03-26.md')).not.toThrow();
  });
});

// ─── Layer 2: 工具过滤 ───

describe('Layer 2: 工具过滤', () => {
  it('MEMORY_FLUSH_ALLOWED_TOOLS 只包含 read 和 write', () => {
    expect(MEMORY_FLUSH_ALLOWED_TOOLS.has('read')).toBe(true);
    expect(MEMORY_FLUSH_ALLOWED_TOOLS.has('write')).toBe(true);
    expect(MEMORY_FLUSH_ALLOWED_TOOLS.size).toBe(2);
  });

  it('flush 拦截器拒绝非 read/write 工具', async () => {
    const interceptor = createFlushPermissionInterceptor();
    expect(await interceptor('exec', {})).toContain('禁止');
    expect(await interceptor('edit', {})).not.toBeNull();
    expect(await interceptor('bash', {})).toContain('禁止');
    expect(await interceptor('spawn_agent', {})).toContain('禁止');
  });

  it('flush 拦截器允许 read 工具', async () => {
    const interceptor = createFlushPermissionInterceptor();
    expect(await interceptor('read', { path: '/any/file.txt' })).toBeNull();
  });

  it('flush 拦截器允许 write 到 memory/YYYY-MM-DD.md', async () => {
    const interceptor = createFlushPermissionInterceptor();
    const today = new Date().toISOString().slice(0, 10);
    expect(await interceptor('write', { path: `memory/${today}.md` })).toBeNull();
  });

  it('flush 拦截器拒绝 write 到非 memory 路径', async () => {
    const interceptor = createFlushPermissionInterceptor();
    expect(await interceptor('write', { path: 'output/report.html' })).toContain('restricted');
  });

  it('flush 拦截器拒绝 write 到 bootstrap 文件', async () => {
    const interceptor = createFlushPermissionInterceptor();
    expect(await interceptor('write', { path: 'MEMORY.md' })).toContain('只读');
    expect(await interceptor('write', { path: 'SOUL.md' })).toContain('只读');
    expect(await interceptor('write', { path: 'AGENTS.md' })).toContain('只读');
    expect(await interceptor('write', { path: 'TOOLS.md' })).toContain('只读');
  });
});

// ─── Layer 3: 提示层 safety hints ───

describe('Layer 3: 提示层 safety hints', () => {
  it('flush 提示包含当天日期', () => {
    const prompt = buildMemoryFlushPrompt();
    const today = new Date().toISOString().slice(0, 10);
    expect(prompt).toContain(`memory/${today}.md`);
  });

  it('flush 提示包含 append-only 规则', () => {
    const prompt = buildMemoryFlushPrompt();
    expect(prompt).toContain('追加新内容');
    expect(prompt).toContain('不要覆盖');
  });

  it('flush 提示包含 bootstrap 只读规则', () => {
    const prompt = buildMemoryFlushPrompt();
    expect(prompt).toContain('MEMORY.md');
    expect(prompt).toContain('SOUL.md');
    expect(prompt).toContain('只读');
  });

  it('flush 提示包含 NO_REPLY 指令', () => {
    const prompt = buildMemoryFlushPrompt();
    expect(prompt).toContain('NO_REPLY');
  });
});

// ─── Layer 4: 记忆读取过滤 ───

describe('Layer 4: 记忆读取过滤', () => {
  it('isAllowedMemoryFile 只允许 .md 文件', () => {
    expect(isAllowedMemoryFile('2026-03-26.md')).toBe(true);
    expect(isAllowedMemoryFile('notes.md')).toBe(true);
    expect(isAllowedMemoryFile('report.html')).toBe(false);
    expect(isAllowedMemoryFile('image.png')).toBe(false);
    expect(isAllowedMemoryFile('document.pdf')).toBe(false);
  });

  it('isDatedMemoryFile 匹配日期格式', () => {
    expect(isDatedMemoryFile('memory/2026-03-26.md')).toBe(true);
    expect(isDatedMemoryFile('memory/2026-03-26-meeting-notes.md')).toBe(true);
    expect(isDatedMemoryFile('/abs/path/memory/2026-03-26.md')).toBe(true);
  });

  it('isDatedMemoryFile 拒绝非日期格式', () => {
    expect(isDatedMemoryFile('memory/notes.md')).toBe(false);
    expect(isDatedMemoryFile('MEMORY.md')).toBe(false);
    expect(isDatedMemoryFile('memory/2026-03-26.html')).toBe(false);
  });

  describe('listValidMemoryFiles', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = path.join(os.tmpdir(), `evoclaw-memflush-${crypto.randomUUID()}`);
      fs.mkdirSync(tmpDir, { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('只返回 .md 文件', () => {
      fs.writeFileSync(path.join(tmpDir, '2026-03-24.md'), '日记');
      fs.writeFileSync(path.join(tmpDir, '2026-03-25.md'), '日记');
      fs.writeFileSync(path.join(tmpDir, '2026-03-25.html'), '<html>');
      fs.writeFileSync(path.join(tmpDir, 'image.png'), 'binary');
      fs.writeFileSync(path.join(tmpDir, 'report.pdf'), 'binary');

      const files = listValidMemoryFiles(tmpDir);
      expect(files).toEqual(['2026-03-24.md', '2026-03-25.md']);
    });

    it('不存在的目录返回空数组', () => {
      expect(listValidMemoryFiles('/nonexistent/path')).toEqual([]);
    });

    it('空目录返回空数组', () => {
      expect(listValidMemoryFiles(tmpDir)).toEqual([]);
    });
  });
});

// ─── 已有功能回归 ───

describe('已有功能回归', () => {
  it('shouldTriggerFlush 85% 阈值', () => {
    expect(shouldTriggerFlush(85000, 100000)).toBe(true);
    expect(shouldTriggerFlush(84999, 100000)).toBe(false);
    expect(shouldTriggerFlush(0, 0)).toBe(false);
  });

  it('ensureMemoryDir 创建目录', () => {
    const tmpDir = path.join(os.tmpdir(), `evoclaw-memdir-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const memoryDir = ensureMemoryDir(tmpDir);
    expect(fs.existsSync(memoryDir)).toBe(true);
    expect(memoryDir).toBe(path.join(tmpDir, 'memory'));

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appendToTodayMemory 追加内容', () => {
    const tmpDir = path.join(os.tmpdir(), `evoclaw-append-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    appendToTodayMemory(tmpDir, '第一条');
    appendToTodayMemory(tmpDir, '第二条');

    const today = new Date().toISOString().slice(0, 10);
    const content = fs.readFileSync(path.join(tmpDir, 'memory', `${today}.md`), 'utf-8');
    expect(content).toContain('第一条');
    expect(content).toContain('第二条');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
