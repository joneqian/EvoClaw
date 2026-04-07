/**
 * Sed 验证器 + 安全管线测试
 */

import { describe, it, expect } from 'vitest';
import { validateSedCommand } from '../../security/sed-validator.js';
import { runSecurityPipeline } from '../../security/bash-parser/security-pipeline.js';
import type { SimpleCommand } from '../../security/bash-parser/types.js';

function sedCmd(args: string[]): SimpleCommand {
  return { argv: ['sed', ...args], envVars: [], redirects: [], text: `sed ${args.join(' ')}` };
}

// ═══════════════════════════════════════════════════════════════════════════
// Sed Validator Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('validateSedCommand', () => {
  // 安全命令

  it('should allow basic substitution', () => {
    const result = validateSedCommand(sedCmd(['s/old/new/g']));
    expect(result.safe).toBe(true);
  });

  it('should allow line print with -n', () => {
    const result = validateSedCommand(sedCmd(['-n', '5p']));
    expect(result.safe).toBe(true);
  });

  it('should allow range print with -n', () => {
    const result = validateSedCommand(sedCmd(['-n', '1,10p']));
    expect(result.safe).toBe(true);
  });

  it('should allow substitution with safe flags', () => {
    const result = validateSedCommand(sedCmd(['s/old/new/gi']));
    expect(result.safe).toBe(true);
  });

  it('should allow delete command', () => {
    const result = validateSedCommand(sedCmd(['5d']));
    expect(result.safe).toBe(true);
  });

  it('should allow -E flag', () => {
    const result = validateSedCommand(sedCmd(['-E', 's/old/new/']));
    expect(result.safe).toBe(true);
  });

  it('should allow empty args', () => {
    const result = validateSedCommand(sedCmd([]));
    expect(result.safe).toBe(true);
  });

  // 危险命令

  it('should BLOCK e flag (execute substitution as shell command)', () => {
    const result = validateSedCommand(sedCmd(['s/x/y/e']));
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('e 标志');
  });

  it('should BLOCK w command (write to file)', () => {
    const result = validateSedCommand(sedCmd(['s/x/y/w evil.sh']));
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('w');
  });

  it('should BLOCK -i without allowFileWrites', () => {
    const result = validateSedCommand(sedCmd(['-i', 's/old/new/']));
    expect(result.safe).toBe(false);
    expect(result.reason).toContain('-i');
  });

  it('should ALLOW -i with allowFileWrites', () => {
    const result = validateSedCommand(sedCmd(['-i', 's/old/new/']), true);
    expect(result.safe).toBe(true);
    expect(result.inPlace).toBe(true);
  });

  it('should BLOCK combined flags with i without allowFileWrites', () => {
    const result = validateSedCommand(sedCmd(['-ni', '5p']));
    expect(result.safe).toBe(false);
    expect(result.inPlace).toBe(true);
  });

  it('should detect inPlace flag', () => {
    const result = validateSedCommand(sedCmd(['-i', 's/a/b/']), true);
    expect(result.inPlace).toBe(true);
  });

  it('should detect mode: substitute', () => {
    const result = validateSedCommand(sedCmd(['s/a/b/g']));
    expect(result.mode).toBe('substitute');
  });

  it('should detect mode: print', () => {
    const result = validateSedCommand(sedCmd(['-n', '1,5p']));
    expect(result.mode).toBe('print');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Security Pipeline Tests
// ═══════════════════════════════════════════════════════════════════════════

describe('runSecurityPipeline', () => {
  it('should allow simple commands', () => {
    const result = runSecurityPipeline('ls -la');
    expect(result.decision).toBe('allow');
    expect(result.commands).toHaveLength(1);
  });

  it('should allow pipeline', () => {
    const result = runSecurityPipeline('cat file | grep foo | wc -l');
    expect(result.decision).toBe('allow');
  });

  it('should ask for control characters (misparsing)', () => {
    const result = runSecurityPipeline('echo\x01hello');
    expect(result.decision).toBe('ask');
    expect(result.isMisparsing).toBe(true);
  });

  it('should ask for command substitution', () => {
    const result = runSecurityPipeline('echo $(rm -rf /)');
    expect(result.decision).toBe('ask');
  });

  it('should ask for sed -e e flag', () => {
    const result = runSecurityPipeline("sed 's/x/y/e' file.txt");
    expect(result.decision).toBe('ask');
    expect(result.sedResults).toBeDefined();
    expect(result.sedResults![0].safe).toBe(false);
  });

  it('should allow safe sed substitution', () => {
    const result = runSecurityPipeline("sed 's/old/new/g' file.txt");
    expect(result.decision).toBe('allow');
  });

  it('should ask for sed -i without allowFileWrites', () => {
    const result = runSecurityPipeline("sed -i 's/old/new/' file.txt");
    expect(result.decision).toBe('ask');
  });

  it('should allow sed -i with allowFileWrites', () => {
    const result = runSecurityPipeline("sed -i 's/old/new/' file.txt", { allowFileWrites: true });
    expect(result.decision).toBe('allow');
  });

  it('should prioritize misparsing over sed warnings', () => {
    // 命令同时有 misparsing (控制字符) 和 sed 问题
    const result = runSecurityPipeline("sed 's/x/y/e'\x01file");
    expect(result.decision).toBe('ask');
    expect(result.isMisparsing).toBe(true);
  });

  it('should handle empty command', () => {
    const result = runSecurityPipeline('');
    expect(result.decision).toBe('allow');
  });

  it('should handle && chain with sed', () => {
    const result = runSecurityPipeline("echo hello && sed 's/a/b/g' file.txt");
    expect(result.decision).toBe('allow');
  });

  it('should ask for too many subcommands', () => {
    const longCmd = Array.from({ length: 60 }, (_, i) => `echo ${i}`).join('; ');
    const result = runSecurityPipeline(longCmd);
    expect(result.decision).toBe('ask');
  });
});
