/**
 * 变量作用域追踪 + Pre-checks + 安全分析器测试
 */

import { describe, it, expect } from 'vitest';
import { VarScope, resolveCommandVariables, _testing } from '../../security/bash-parser/var-scope.js';
import { runPreChecks, _testing as preCheckTesting } from '../../security/bash-parser/pre-checks.js';
import { analyzeCommand } from '../../security/bash-parser/security-analyzer.js';
import type { SimpleCommand } from '../../security/bash-parser/types.js';

// ═══════════════════════════════════════════════════════════════════════════
// VarScope Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('VarScope', () => {
  it('should set and get variables', () => {
    const scope = new VarScope();
    scope.set('FOO', { kind: 'literal', value: 'bar' });
    expect(scope.get('FOO')).toEqual({ kind: 'literal', value: 'bar' });
  });

  it('should resolve $VAR references', () => {
    const scope = new VarScope();
    scope.set('HOME', { kind: 'literal', value: '/home/user' });
    expect(scope.resolve('$HOME')).toBe('/home/user');
  });

  it('should resolve ${VAR} references', () => {
    const scope = new VarScope();
    scope.set('PATH', { kind: 'literal', value: '/usr/bin' });
    expect(scope.resolve('${PATH}')).toBe('/usr/bin');
  });

  it('should return __CMDSUB__ for command substitution values', () => {
    const scope = new VarScope();
    scope.set('RESULT', { kind: 'cmdsub' });
    expect(scope.resolve('$RESULT')).toBe('__CMDSUB__');
  });

  it('should return original for unknown variables', () => {
    const scope = new VarScope();
    expect(scope.resolve('$UNKNOWN')).toBe('$UNKNOWN');
  });

  it('should create snapshot', () => {
    const scope = new VarScope();
    scope.set('A', { kind: 'literal', value: '1' });
    const snap = scope.snapshot();
    scope.set('B', { kind: 'literal', value: '2' });
    expect(snap.get('A')).toEqual({ kind: 'literal', value: '1' });
    expect(snap.get('B')).toBeUndefined();
  });

  it('should create isolated scope', () => {
    const scope = VarScope.isolated();
    expect(scope.get('anything')).toBeUndefined();
  });
});

describe('extractVarName', () => {
  const { extractVarName } = _testing;

  it('should extract from $VAR', () => {
    expect(extractVarName('$HOME')).toBe('HOME');
  });

  it('should extract from ${VAR}', () => {
    expect(extractVarName('${HOME}')).toBe('HOME');
  });

  it('should extract from ${VAR:-default}', () => {
    expect(extractVarName('${HOME:-/root}')).toBe('HOME');
  });

  it('should return null for non-variable', () => {
    expect(extractVarName('hello')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// resolveCommandVariables Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('resolveCommandVariables', () => {
  function cmd(argv: string[], opts: Partial<SimpleCommand> = {}): SimpleCommand {
    return { argv, envVars: [], redirects: [], text: argv.join(' '), ...opts };
  }

  it('should propagate variables through && chain', () => {
    const commands: SimpleCommand[] = [
      cmd([], { envVars: [{ name: 'FLAG', value: '--force' }], text: 'FLAG=--force' }),
      cmd(['cmd', '$FLAG'], { separator: '&&' }),
    ];
    const resolved = resolveCommandVariables(commands);
    expect(resolved[1].argv).toEqual(['cmd', '--force']);
  });

  it('should propagate variables through ; chain', () => {
    const commands: SimpleCommand[] = [
      cmd([], { envVars: [{ name: 'X', value: 'hello' }], text: 'X=hello' }),
      cmd(['echo', '$X'], { separator: ';' }),
    ];
    const resolved = resolveCommandVariables(commands);
    expect(resolved[1].argv).toEqual(['echo', 'hello']);
  });

  it('should reset scope on || (flag smuggling attack prevention)', () => {
    // 攻击场景: true || FLAG=--dry-run && cmd $FLAG
    // bash 跳过 || 右侧，FLAG 未设置
    const commands: SimpleCommand[] = [
      cmd(['true']),
      cmd([], { envVars: [{ name: 'FLAG', value: '--dry-run' }], text: 'FLAG=--dry-run', separator: '||' }),
      cmd(['cmd', '$FLAG'], { separator: '&&' }),
    ];
    const resolved = resolveCommandVariables(commands);
    // $FLAG 应该是未解析的（因为 || 重置了作用域）
    expect(resolved[2].argv).toEqual(['cmd', '$FLAG']);
  });

  it('should isolate scope on | pipe', () => {
    const commands: SimpleCommand[] = [
      cmd([], { envVars: [{ name: 'X', value: 'val' }], text: 'X=val' }),
      cmd(['echo', '$X'], { separator: '|' }),
    ];
    const resolved = resolveCommandVariables(commands);
    // 管道隔离，$X 不可见
    expect(resolved[1].argv).toEqual(['echo', '$X']);
  });

  it('should isolate scope on & background', () => {
    const commands: SimpleCommand[] = [
      cmd([], { envVars: [{ name: 'X', value: 'val' }], text: 'X=val' }),
      cmd(['echo', '$X'], { separator: '&' }),
    ];
    const resolved = resolveCommandVariables(commands);
    expect(resolved[1].argv).toEqual(['echo', '$X']);
  });

  it('should handle command substitution values', () => {
    const commands: SimpleCommand[] = [
      cmd([], { envVars: [{ name: 'RESULT', value: '$(date)' }], text: 'RESULT=$(date)' }),
      cmd(['echo', '$RESULT'], { separator: '&&' }),
    ];
    const resolved = resolveCommandVariables(commands);
    expect(resolved[1].argv).toEqual(['echo', '__CMDSUB__']);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Pre-checks Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('runPreChecks', () => {
  it('should pass clean commands', () => {
    expect(runPreChecks('ls -la /tmp').passed).toBe(true);
    expect(runPreChecks('echo hello && cat file').passed).toBe(true);
  });

  it('should detect control characters (misparsing)', () => {
    const result = runPreChecks('echo\x01hello');
    expect(result.passed).toBe(false);
    expect(result.isMisparsing).toBe(true);
  });

  it('should detect Unicode whitespace (misparsing)', () => {
    const result = runPreChecks('echo\u00A0hello');
    expect(result.passed).toBe(false);
    expect(result.isMisparsing).toBe(true);
  });

  it('should detect backslash-escaped operators (misparsing)', () => {
    const result = runPreChecks('echo hello \\; rm -rf /');
    expect(result.passed).toBe(false);
    expect(result.isMisparsing).toBe(true);
  });

  it('should detect Zsh tilde expansion (misparsing)', () => {
    const result = runPreChecks('cd ~[evil]');
    expect(result.passed).toBe(false);
    expect(result.isMisparsing).toBe(true);
  });

  it('should detect newlines (non-misparsing)', () => {
    const result = runPreChecks('echo hello\nrm -rf /');
    expect(result.passed).toBe(false);
    expect(result.isMisparsing).toBe(false);
  });

  it('should detect carriage return (non-misparsing)', () => {
    const result = runPreChecks('echo safe\rgit push --force');
    expect(result.passed).toBe(false);
    expect(result.isMisparsing).toBe(false);
  });

  it('should detect IFS injection (non-misparsing)', () => {
    const result = runPreChecks('IFS=/ cmd');
    expect(result.passed).toBe(false);
  });

  it('should prioritize misparsing over non-misparsing', () => {
    // 命令同时包含换行(non-misparsing)和控制字符(misparsing)
    const result = runPreChecks('echo\x01hello\nworld');
    expect(result.passed).toBe(false);
    expect(result.isMisparsing).toBe(true); // misparsing 优先
  });

  it('should not flag quoted content', () => {
    // 引号内的特殊字符不应触发检查
    const result = runPreChecks("echo 'hello\\;world'");
    expect(result.passed).toBe(true);
  });
});

describe('stripQuotedRegions', () => {
  const { stripQuotedRegions } = preCheckTesting;

  it('should strip single-quoted regions', () => {
    expect(stripQuotedRegions("echo 'hello world'")).toBe('echo  ');
  });

  it('should strip double-quoted regions', () => {
    expect(stripQuotedRegions('echo "hello world"')).toBe('echo  ');
  });

  it('should handle escaped quotes in double quotes', () => {
    expect(stripQuotedRegions('echo "hello\\"world"')).toBe('echo  ');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Security Analyzer Integration Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('analyzeCommand', () => {
  it('should return safe for simple commands', () => {
    const result = analyzeCommand('ls -la /tmp');
    expect(result.kind).toBe('safe');
    expect(result.commands).toHaveLength(1);
  });

  it('should return safe for pipeline', () => {
    const result = analyzeCommand('cat file | grep foo | wc -l');
    expect(result.kind).toBe('safe');
    expect(result.commands).toHaveLength(3);
  });

  it('should return safe for && chain', () => {
    const result = analyzeCommand('cd /tmp && ls -la && echo done');
    expect(result.kind).toBe('safe');
    expect(result.commands).toHaveLength(3);
  });

  it('should resolve variables through && chain', () => {
    const result = analyzeCommand('FOO=bar && echo $FOO');
    expect(result.kind).toBe('safe');
    // 由于 FOO=bar 是纯赋值（无 argv），变量应传播到 echo
  });

  it('should return ask for control characters', () => {
    const result = analyzeCommand('echo\x01hello');
    expect(result.kind).toBe('ask');
    expect(result.isMisparsing).toBe(true);
  });

  it('should return ask for command substitution', () => {
    const result = analyzeCommand('echo $(rm -rf /)');
    expect(result.kind).toBe('ask');
  });

  it('should return ask for subshell', () => {
    const result = analyzeCommand('(echo hello)');
    expect(result.kind).toBe('ask');
  });

  it('should return safe for empty command', () => {
    const result = analyzeCommand('');
    expect(result.kind).toBe('safe');
    expect(result.commands).toHaveLength(0);
  });

  it('should return ask for too many subcommands', () => {
    const longCmd = Array.from({ length: 60 }, (_, i) => `echo ${i}`).join('; ');
    const result = analyzeCommand(longCmd);
    expect(result.kind).toBe('ask');
    expect(result.reason).toContain('子命令');
  });
});
