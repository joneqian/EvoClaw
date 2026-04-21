/**
 * skill-tool telemetry 注入测试 — M7 Phase 2
 *
 * 用假 skill 目录 + 内存 telemetry sink 验证：
 * - inline 成功路径 → success=true
 * - skill 不存在路径 → success=false + errorSummary
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSkillTool } from '../skill/skill-tool.js';
import type { SkillTelemetrySink, SkillUsageRecord } from '../skill/skill-usage-store.js';

function mkTmpDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeSkill(baseDir: string, name: string, body = 'Hello'): void {
  const dir = path.join(baseDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'SKILL.md'),
    `---\nname: ${name}\ndescription: test skill\n---\n\n${body}\n`,
    'utf-8',
  );
}

class InMemorySink implements SkillTelemetrySink {
  records: SkillUsageRecord[] = [];
  record(r: SkillUsageRecord): void {
    this.records.push(r);
  }
}

describe('skill-tool telemetry', () => {
  let baseDir: string;
  let sink: InMemorySink;

  beforeEach(() => {
    baseDir = mkTmpDir('skill-tool-tel-');
    sink = new InMemorySink();
  });

  afterEach(() => {
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it('inline 成功 → 记录 success=true + executionMode=inline', async () => {
    writeSkill(baseDir, 'hello');
    const tool = createSkillTool([baseDir], {
      telemetry: sink, agentId: 'a1', sessionKey: 's1',
    });
    const result = await tool.call({ skill: 'hello' });
    expect(result.isError).toBeFalsy();
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0].success).toBe(true);
    expect(sink.records[0].executionMode).toBe('inline');
    expect(sink.records[0].skillName).toBe('hello');
    expect(sink.records[0].agentId).toBe('a1');
    expect(sink.records[0].sessionKey).toBe('s1');
    expect(sink.records[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it('skill 不存在 → 记录 success=false + errorSummary', async () => {
    const tool = createSkillTool([baseDir], {
      telemetry: sink, agentId: 'a1', sessionKey: 's1',
    });
    const result = await tool.call({ skill: 'nonexistent' });
    expect(result.isError).toBe(true);
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0].success).toBe(false);
    expect(sink.records[0].errorSummary).toContain('skill not found');
  });

  it('SKILL.md 损坏（无 frontmatter）→ success=false', async () => {
    const dir = path.join(baseDir, 'broken');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), 'no frontmatter', 'utf-8');
    const tool = createSkillTool([baseDir], {
      telemetry: sink, agentId: 'a1', sessionKey: 's1',
    });
    await tool.call({ skill: 'broken' });
    expect(sink.records[0].success).toBe(false);
    expect(sink.records[0].errorSummary).toContain('invalid SKILL.md');
  });

  it('telemetry sink 未配置 → 调用仍正常', async () => {
    writeSkill(baseDir, 'nosink');
    const tool = createSkillTool([baseDir], {});   // 无 telemetry
    const result = await tool.call({ skill: 'nosink' });
    expect(result.isError).toBeFalsy();
    // 无 sink 时 emit 直接短路，不抛
  });

  it('agentId/sessionKey 缺失 → 不记录（防脏数据）', async () => {
    writeSkill(baseDir, 'noctx');
    const tool = createSkillTool([baseDir], { telemetry: sink });   // 有 sink 无 agentId
    await tool.call({ skill: 'noctx' });
    expect(sink.records).toHaveLength(0);
  });

  it('空 skill 名 → 不记录', async () => {
    const tool = createSkillTool([baseDir], {
      telemetry: sink, agentId: 'a1', sessionKey: 's1',
    });
    const result = await tool.call({ skill: '' });
    expect(result.isError).toBe(true);
    // 空名快速失败前已 return，telemetry emit 没走到
    expect(sink.records).toHaveLength(0);
  });
});
