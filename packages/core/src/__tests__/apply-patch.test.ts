import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { parsePatch, applyPatch, parseHunks, createApplyPatchTool } from '../tools/apply-patch.js';
import type { PatchEntry } from '../tools/apply-patch.js';
import fs from 'node:fs';

describe('parsePatch', () => {
  it('应该解析 Update 操作', () => {
    const text = `*** Begin Patch
*** Update File: src/foo.ts
 context line
-old line
+new line
 after context
*** End Patch`;

    const entries = parsePatch(text);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe('update');
    expect(entries[0]!.filePath).toBe('src/foo.ts');
    expect(entries[0]!.lines.length).toBeGreaterThan(0);
  });

  it('应该解析 Add 操作', () => {
    const text = `*** Begin Patch
*** Add File: src/new.ts
+line 1
+line 2
*** End Patch`;

    const entries = parsePatch(text);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe('add');
    expect(entries[0]!.filePath).toBe('src/new.ts');
  });

  it('应该解析 Delete 操作', () => {
    const text = `*** Begin Patch
*** Delete File: src/old.ts
*** End Patch`;

    const entries = parsePatch(text);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe('delete');
    expect(entries[0]!.filePath).toBe('src/old.ts');
  });

  it('应该解析多文件混合操作', () => {
    const text = `*** Begin Patch
*** Update File: a.ts
 ctx
-old
+new

*** Add File: b.ts
+hello

*** Delete File: c.ts
*** End Patch`;

    const entries = parsePatch(text);
    expect(entries).toHaveLength(3);
    expect(entries.map(e => e.action)).toEqual(['update', 'add', 'delete']);
  });

  it('空补丁应返回空数组', () => {
    expect(parsePatch('')).toEqual([]);
    expect(parsePatch('*** Begin Patch\n*** End Patch')).toEqual([]);
  });
});

describe('parseHunks', () => {
  it('应该解析简单的修改', () => {
    const lines = [
      ' context before',
      '-removed line',
      '+added line',
      ' context after',
    ];
    const hunks = parseHunks(lines);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.context).toContain('context before');
    expect(hunks[0]!.removes).toContain('removed line');
    expect(hunks[0]!.adds).toContain('added line');
  });

  it('应该解析纯添加（无删除）', () => {
    const lines = [
      ' context',
      '+new line 1',
      '+new line 2',
    ];
    const hunks = parseHunks(lines);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.removes).toHaveLength(0);
    expect(hunks[0]!.adds).toHaveLength(2);
  });

  it('应该解析纯删除（无添加）', () => {
    const lines = [
      ' context',
      '-removed 1',
      '-removed 2',
    ];
    const hunks = parseHunks(lines);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]!.removes).toHaveLength(2);
    expect(hunks[0]!.adds).toHaveLength(0);
  });
});

describe('applyPatch', () => {
  it('应该拒绝路径穿越', () => {
    const entries: PatchEntry[] = [
      { action: 'add', filePath: '../etc/passwd', lines: ['+hack'] },
    ];
    const result = applyPatch(entries);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.error).toContain('禁止');
  });

  it('应该拒绝 node_modules 路径', () => {
    const entries: PatchEntry[] = [
      { action: 'update', filePath: 'node_modules/foo/bar.js', lines: [] },
    ];
    const result = applyPatch(entries);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]!.error).toContain('禁止');
  });

  it('应该拒绝 .env 文件', () => {
    const entries: PatchEntry[] = [
      { action: 'update', filePath: '.env', lines: [] },
    ];
    const result = applyPatch(entries);
    expect(result.failed).toHaveLength(1);
  });
});

describe('apply_patch 工具', () => {
  it('应该返回正确的工具定义', () => {
    const tool = createApplyPatchTool();
    expect(tool.name).toBe('apply_patch');
    expect(tool.description).toContain('Begin Patch');
  });

  it('缺少 patch 参数应返回错误', async () => {
    const tool = createApplyPatchTool();
    const result = await tool.execute({});
    expect(result).toContain('错误');
  });

  it('空补丁应返回错误', async () => {
    const tool = createApplyPatchTool();
    const result = await tool.execute({ patch: '*** Begin Patch\n*** End Patch' });
    expect(result).toContain('未解析到');
  });
});
