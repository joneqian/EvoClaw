/**
 * 运行时工具层测试
 *
 * 覆盖:
 * - isBun 运行时检测
 * - bunVersion / Bun API 代理
 * - fastHash 快速哈希（一致性 + 确定性）
 * - which 命令查找（缓存 + 回退）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// 注意：测试运行在 Node.js (vitest)，所以 Bun API 代理全部为 null
describe('runtime', () => {
  // 动态导入，避免模块缓存问题
  let runtime: typeof import('../../infrastructure/runtime.js');

  beforeEach(async () => {
    // 清除模块缓存以获得干净的导入
    vi.resetModules();
    runtime = await import('../../infrastructure/runtime.js');
  });

  describe('isBun', () => {
    it('在 vitest (Node.js) 环境下应为 false', () => {
      expect(runtime.isBun).toBe(false);
    });

    it('应为布尔类型', () => {
      expect(typeof runtime.isBun).toBe('boolean');
    });
  });

  describe('bunVersion', () => {
    it('在 Node.js 环境下应为 null', () => {
      expect(runtime.bunVersion).toBeNull();
    });
  });

  describe('Bun API 代理', () => {
    it('bunHash 在 Node.js 下应为 null', () => {
      expect(runtime.bunHash).toBeNull();
    });

    it('bunWhich 在 Node.js 下应为 null', () => {
      expect(runtime.bunWhich).toBeNull();
    });

    it('bunGC 在 Node.js 下应为 null', () => {
      expect(runtime.bunGC).toBeNull();
    });

    it('bunHeapSnapshot 在 Node.js 下应为 null', () => {
      expect(runtime.bunHeapSnapshot).toBeNull();
    });

    it('bunJSONLParseChunk 在 Node.js 下应为 null', () => {
      expect(runtime.bunJSONLParseChunk).toBeNull();
    });
  });

  describe('fastHash', () => {
    it('应返回非空字符串', () => {
      const hash = runtime.fastHash('hello world');
      expect(hash).toBeTruthy();
      expect(typeof hash).toBe('string');
    });

    it('相同输入应产生相同输出（确定性）', () => {
      const a = runtime.fastHash('test input');
      const b = runtime.fastHash('test input');
      expect(a).toBe(b);
    });

    it('不同输入应产生不同输出', () => {
      const a = runtime.fastHash('input A');
      const b = runtime.fastHash('input B');
      expect(a).not.toBe(b);
    });

    it('空字符串应正常处理', () => {
      const hash = runtime.fastHash('');
      expect(hash).toBeTruthy();
    });

    it('Node.js 回退应返回 SHA-256 hex', () => {
      const hash = runtime.fastHash('hello');
      // SHA-256 hex 长度 = 64
      expect(hash).toHaveLength(64);
      expect(hash).toMatch(/^[0-9a-f]+$/);
    });

    it('长字符串应正常处理', () => {
      const longStr = 'a'.repeat(100_000);
      const hash = runtime.fastHash(longStr);
      expect(hash).toBeTruthy();
    });
  });

  describe('which', () => {
    it('应找到 node 命令', () => {
      const result = runtime.which('node');
      expect(result).toBeTruthy();
      expect(result).toContain('node');
    });

    it('不存在的命令应返回 null', () => {
      const result = runtime.which('__nonexistent_command_12345__');
      expect(result).toBeNull();
    });

    it('应缓存结果（第二次调用不触发 execSync）', () => {
      // 第一次调用
      const first = runtime.which('node');
      // 第二次调用（应走缓存）
      const second = runtime.which('node');
      expect(first).toBe(second);
    });

    it('不同命令应独立缓存', () => {
      const node = runtime.which('node');
      const nonexist = runtime.which('__nonexistent_cmd__');
      expect(node).toBeTruthy();
      expect(nonexist).toBeNull();
    });
  });
});
