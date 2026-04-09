/**
 * Memory Flush 三层防护测试（Phase A.4 之后：DB 优先，无文件写入）
 */
import { describe, it, expect } from 'vitest';
import {
  buildMemoryFlushPrompt,
  createFlushPermissionInterceptor,
  shouldTriggerFlush,
  MEMORY_FLUSH_ALLOWED_TOOLS,
} from '../agent/memory-flush.js';

// ─── Layer 1: 工具白名单 ───

describe('Layer 1: 工具白名单', () => {
  it('MEMORY_FLUSH_ALLOWED_TOOLS 只包含 read / memory_search / memory_write', () => {
    expect(MEMORY_FLUSH_ALLOWED_TOOLS.has('read')).toBe(true);
    expect(MEMORY_FLUSH_ALLOWED_TOOLS.has('memory_search')).toBe(true);
    expect(MEMORY_FLUSH_ALLOWED_TOOLS.has('memory_write')).toBe(true);
    expect(MEMORY_FLUSH_ALLOWED_TOOLS.size).toBe(3);
  });

  it('flush 拦截器拒绝 write / edit / bash 等老路径', async () => {
    const interceptor = createFlushPermissionInterceptor();
    expect(await interceptor('write', { path: 'memory/2026-04-09.md' })).toContain('禁止');
    expect(await interceptor('edit', {})).toContain('禁止');
    expect(await interceptor('bash', {})).toContain('禁止');
    expect(await interceptor('exec', {})).toContain('禁止');
    expect(await interceptor('spawn_agent', {})).toContain('禁止');
  });

  it('flush 拦截器拒绝其他记忆写工具（防止意外删改）', async () => {
    const interceptor = createFlushPermissionInterceptor();
    expect(await interceptor('memory_delete', { id: 'mem-1' })).toContain('禁止');
    expect(await interceptor('memory_update', { id: 'mem-1' })).toContain('禁止');
    expect(await interceptor('memory_forget_topic', { keyword: 'x' })).toContain('禁止');
    expect(await interceptor('memory_pin', { id: 'mem-1' })).toContain('禁止');
  });

  it('flush 拦截器允许 read 工具', async () => {
    const interceptor = createFlushPermissionInterceptor();
    expect(await interceptor('read', { path: '/any/file.txt' })).toBeNull();
  });

  it('flush 拦截器允许 memory_search', async () => {
    const interceptor = createFlushPermissionInterceptor();
    expect(await interceptor('memory_search', { query: '女儿' })).toBeNull();
  });

  it('flush 拦截器允许 memory_write', async () => {
    const interceptor = createFlushPermissionInterceptor();
    expect(await interceptor('memory_write', {
      l0: '某事',
      l1: '某事详情',
      category: 'profile',
    })).toBeNull();
  });
});

// ─── Layer 2: 提示层 safety hints ───

describe('Layer 2: 提示层 safety hints', () => {
  it('flush 提示明确指示使用 memory_write 工具', () => {
    const prompt = buildMemoryFlushPrompt();
    expect(prompt).toContain('memory_write');
  });

  it('flush 提示禁止用 write/edit 改文件', () => {
    const prompt = buildMemoryFlushPrompt();
    expect(prompt).toContain('不要用 write/edit 工具创建文件');
  });

  it('flush 提示包含 bootstrap 只读规则', () => {
    const prompt = buildMemoryFlushPrompt();
    expect(prompt).toContain('SOUL.md');
    expect(prompt).toContain('MEMORY.md');
    expect(prompt).toContain('只读');
  });

  it('flush 提示包含 NO_REPLY 指令', () => {
    const prompt = buildMemoryFlushPrompt();
    expect(prompt).toContain('NO_REPLY');
  });

  it('flush 提示包含 memory_search 防重复指引', () => {
    const prompt = buildMemoryFlushPrompt();
    expect(prompt).toContain('memory_search');
  });

  it('flush 提示不再引用 memory/YYYY-MM-DD.md 日记路径', () => {
    const prompt = buildMemoryFlushPrompt();
    expect(prompt).not.toMatch(/memory\/\d{4}-\d{2}-\d{2}\.md/);
  });
});

// ─── Layer 3: 触发条件 ───

describe('Layer 3: 触发条件', () => {
  it('shouldTriggerFlush 85% 阈值', () => {
    expect(shouldTriggerFlush(85000, 100000)).toBe(true);
    expect(shouldTriggerFlush(84999, 100000)).toBe(false);
    expect(shouldTriggerFlush(0, 0)).toBe(false);
  });

  it('shouldTriggerFlush 支持自定义阈值', () => {
    expect(shouldTriggerFlush(70000, 100000, 0.7)).toBe(true);
    expect(shouldTriggerFlush(69999, 100000, 0.7)).toBe(false);
  });
});
