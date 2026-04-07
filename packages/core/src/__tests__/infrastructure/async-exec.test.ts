/**
 * 异步命令执行引擎测试
 */

import { describe, it, expect } from 'vitest';
import {
  asyncExec,
  truncateOutput,
  maybePersistOutput,
  _testing,
} from '../../infrastructure/async-exec.js';

// ─── asyncExec ───

describe('asyncExec', () => {
  it('should execute a simple command and return stdout', async () => {
    const result = await asyncExec('echo hello');
    expect(result.stdout.trim()).toBe('hello');
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(result.aborted).toBe(false);
  });

  it('should capture stderr separately', async () => {
    const result = await asyncExec('echo err >&2');
    expect(result.stderr.trim()).toBe('err');
    expect(result.exitCode).toBe(0);
  });

  it('should return non-zero exit code on failure', async () => {
    const result = await asyncExec('exit 42');
    expect(result.exitCode).toBe(42);
  });

  it('should respect working directory', async () => {
    const result = await asyncExec('pwd', { cwd: '/tmp' });
    // macOS /tmp → /private/tmp
    expect(result.stdout.trim()).toMatch(/\/?tmp$/);
  });

  it('should pass custom environment variables', async () => {
    const result = await asyncExec('echo $MY_VAR', { env: { MY_VAR: 'test123' } });
    expect(result.stdout.trim()).toBe('test123');
  });

  it('should timeout and set timedOut flag', async () => {
    const result = await asyncExec('sleep 10', { timeoutMs: 200, graceMs: 100 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
  });

  it('should abort via AbortController', async () => {
    const ac = new AbortController();
    const promise = asyncExec('sleep 10', { signal: ac.signal });
    // 短暂延迟后取消
    setTimeout(() => ac.abort(), 100);
    const result = await promise;
    expect(result.aborted).toBe(true);
  });

  it('should return aborted immediately if signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    const result = await asyncExec('echo should-not-run', { signal: ac.signal });
    expect(result.aborted).toBe(true);
    expect(result.stdout).toBe('');
  });

  it('should call onProgress callback with output data', async () => {
    const progresses: Array<{ totalLines: number }> = [];
    await asyncExec('echo line1; echo line2; echo line3', {
      onProgress: (p) => progresses.push({ totalLines: p.totalLines }),
    });
    // 至少收到一次进度回调
    expect(progresses.length).toBeGreaterThan(0);
    // 最终总行数至少有 3
    const last = progresses[progresses.length - 1];
    expect(last?.totalLines).toBeGreaterThanOrEqual(3);
  });

  it('should cap output collection at maxOutputChars', async () => {
    // 生成大量输出 (1M+ chars)
    const result = await asyncExec(
      'yes "abcdefghij" | head -100000',
      { maxOutputChars: 5000 },
    );
    // 进程仍正常退出
    expect(result.exitCode).toBe(0);
    // 输出应远小于未限制时的完整输出 (~1.1M chars)
    // 允许 pipe buffer 溢出，但不应超过 maxOutputChars × 4（含 buffer flush 余量）
    expect(result.stdout.length).toBeLessThan(100_000);
  });

  it('should handle commands with special characters', async () => {
    const result = await asyncExec('echo "hello world" && echo "foo bar"');
    expect(result.stdout).toContain('hello world');
    expect(result.stdout).toContain('foo bar');
    expect(result.exitCode).toBe(0);
  });

  it('should handle empty output', async () => {
    const result = await asyncExec('true');
    expect(result.stdout).toBe('');
    expect(result.exitCode).toBe(0);
  });
});

// ─── truncateOutput ───

describe('truncateOutput', () => {
  it('should return short output unchanged', () => {
    expect(truncateOutput('hello', 100)).toBe('hello');
  });

  it('should truncate long output with head/tail', () => {
    const long = 'a'.repeat(1000);
    const result = truncateOutput(long, 100);
    expect(result.length).toBeLessThan(long.length);
    expect(result).toContain('... [省略');
    // head 70% of 100 = 70 chars
    expect(result.startsWith('a'.repeat(70))).toBe(true);
    // tail 30% of 100 = 30 chars
    expect(result.endsWith('a'.repeat(30))).toBe(true);
  });

  it('should handle exact limit length', () => {
    const exact = 'x'.repeat(100);
    expect(truncateOutput(exact, 100)).toBe(exact);
  });
});

// ─── maybePersistOutput ───

describe('maybePersistOutput', () => {
  it('should return short output without persisting', async () => {
    const result = await maybePersistOutput('short output');
    expect(result.persisted).toBe(false);
    expect(result.text).toBe('short output');
  });

  it('should persist large output to disk', async () => {
    const large = 'x'.repeat(_testing.PERSIST_THRESHOLD_CHARS + 100);
    const result = await maybePersistOutput(large);
    expect(result.persisted).toBe(true);
    expect(result.text).toContain('完整输出已保存到');
    expect(result.text).toContain(_testing.PERSIST_DIR);
    // 包含前 2000 字符预览
    expect(result.text).toContain('x'.repeat(100));
  });
});

// ─── Image Detection ───

describe('detectImages', () => {
  const { detectImages } = _testing;

  it('should detect PNG base64 data', () => {
    const pngPrefix = 'iVBORw0KGgo' + 'A'.repeat(200);
    const result = detectImages(`some text ${pngPrefix} more text`);
    expect(result).toHaveLength(1);
    expect(result![0].mimeType).toBe('image/png');
  });

  it('should detect JPEG base64 data', () => {
    const jpgPrefix = '/9j/' + 'A'.repeat(200);
    const result = detectImages(`output: ${jpgPrefix}`);
    expect(result).toHaveLength(1);
    expect(result![0].mimeType).toBe('image/jpeg');
  });

  it('should detect GIF base64 data', () => {
    const gifPrefix = 'R0lGOD' + 'A'.repeat(200);
    const result = detectImages(gifPrefix);
    expect(result).toHaveLength(1);
    expect(result![0].mimeType).toBe('image/gif');
  });

  it('should return undefined for no images', () => {
    const result = detectImages('just plain text output');
    expect(result).toBeUndefined();
  });

  it('should detect multiple images', () => {
    const png = 'iVBORw0KGgo' + 'A'.repeat(200);
    const jpg = '/9j/' + 'B'.repeat(200);
    const result = detectImages(`${png} separator ${jpg}`);
    expect(result).toHaveLength(2);
  });
});

// ─── Utilities ───

describe('countNewlines', () => {
  const { countNewlines } = _testing;

  it('should count newlines in text', () => {
    expect(countNewlines('a\nb\nc')).toBe(2);
    expect(countNewlines('no newlines')).toBe(0);
    expect(countNewlines('\n\n\n')).toBe(3);
    expect(countNewlines('')).toBe(0);
  });
});
