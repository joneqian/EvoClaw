/**
 * Bash 解析器性能基准测试
 */

import { describe, it, expect } from 'vitest';
import { parseBash, parseForSecurity, analyzeCommand, runSecurityPipeline } from '../../security/bash-parser/index.js';

describe('performance', () => {
  it('parser p95 < 5ms for typical commands', () => {
    const commands = [
      'ls -la /tmp',
      'cat file.txt | grep foo | wc -l',
      'cd /home && git status && echo done',
      'NODE_ENV=production npm run build',
      'find . -name "*.ts" -type f | xargs grep "import"',
      'echo hello > /tmp/out.txt 2>&1',
      'git diff --staged | head -100',
      'docker ps -a --format "{{.Names}}"',
      'curl -s https://api.example.com | jq .data',
      'tar -czf backup.tar.gz /home/user/docs',
    ];

    const times: number[] = [];
    // 预热
    for (const cmd of commands) parseBash(cmd);

    // 测量
    for (let round = 0; round < 10; round++) {
      for (const cmd of commands) {
        const start = performance.now();
        parseBash(cmd);
        times.push(performance.now() - start);
      }
    }

    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    expect(p95).toBeLessThan(5); // p95 < 5ms
  });

  it('analyzeCommand p95 < 10ms for typical commands', () => {
    const commands = [
      'ls -la /tmp',
      'cat file | grep foo | wc -l',
      'cd /tmp && ls && echo done',
      "sed 's/old/new/g' file.txt",
      'git log --oneline -10',
    ];

    const times: number[] = [];
    for (const cmd of commands) analyzeCommand(cmd); // 预热

    for (let round = 0; round < 10; round++) {
      for (const cmd of commands) {
        const start = performance.now();
        analyzeCommand(cmd);
        times.push(performance.now() - start);
      }
    }

    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    expect(p95).toBeLessThan(10); // p95 < 10ms
  });

  it('runSecurityPipeline p95 < 15ms for typical commands', () => {
    const commands = [
      'ls -la',
      'echo hello && cat file | grep test',
      "sed 's/a/b/g' input.txt",
    ];

    const times: number[] = [];
    for (const cmd of commands) runSecurityPipeline(cmd); // 预热

    for (let round = 0; round < 10; round++) {
      for (const cmd of commands) {
        const start = performance.now();
        runSecurityPipeline(cmd);
        times.push(performance.now() - start);
      }
    }

    times.sort((a, b) => a - b);
    const p95 = times[Math.floor(times.length * 0.95)];
    expect(p95).toBeLessThan(15);
  });

  it('should handle stress: 100 subcommands without timeout', () => {
    const big = Array.from({ length: 100 }, (_, i) => `echo ${i}`).join(' && ');
    const start = performance.now();
    const result = parseForSecurity(big);
    const elapsed = performance.now() - start;
    // 100 个子命令应该在 50ms 内完成（默认 budget）
    expect(elapsed).toBeLessThan(50);
    // 但会被 analyzeCommand 的 MAX_SUBCOMMANDS=50 限制
    expect(result.kind).toBe('simple');
  });
});
