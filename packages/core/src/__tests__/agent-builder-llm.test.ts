/**
 * AgentBuilder LLM 生成测试
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AgentBuilder } from '../agent/agent-builder.js';
import { AgentManager } from '../agent/agent-manager.js';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';

function loadMigrations(): string {
  const dir = path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations');
  return fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
    .map(f => fs.readFileSync(path.join(dir, f), 'utf-8')).join('\n');
}

describe('AgentBuilder LLM 生成', () => {
  let tmpDir: string;
  let store: SqliteStore;
  let agentManager: AgentManager;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-builder-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    store = new SqliteStore(path.join(tmpDir, 'test.db'));
    store.exec(loadMigrations());
    agentManager = new AgentManager(store, path.join(tmpDir, 'agents'));
  });

  afterEach(() => {
    try { store.close(); } catch { /* */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('有 LLM 时调用 LLM 生成 SOUL.md 和 AGENTS.md', async () => {
    const mockLLM = vi.fn()
      .mockResolvedValueOnce('# 行为哲学\n\n## 角色定位\n我是一位资深 TypeScript 工程师...')
      .mockResolvedValueOnce('# 操作规程\n\n## 对话规范\n- 代码优先，简洁回答...');

    const builder = new AgentBuilder(agentManager, mockLLM);
    const session = builder.createSession();

    // 推进到 preview
    await builder.advance(session, '资深程序员');
    await builder.advance(session, 'TypeScript');
    await builder.advance(session, '简洁高效');
    const result = await builder.advance(session, '无');

    expect(result.stage).toBe('preview');
    expect(result.preview).toBeTruthy();

    // 验证 LLM 被调用了 2 次（SOUL.md + AGENTS.md）
    expect(mockLLM).toHaveBeenCalledTimes(2);

    // 验证 SOUL.md 内容来自 LLM
    expect(result.preview!['SOUL.md']).toContain('TypeScript 工程师');

    // 验证 AGENTS.md 内容来自 LLM
    expect(result.preview!['AGENTS.md']).toContain('代码优先');

    // IDENTITY.md 仍由模板生成（包含 YAML frontmatter）
    expect(result.preview!['IDENTITY.md']).toContain('name:');
    expect(result.preview!['IDENTITY.md']).toContain('emoji:');

    // 静态文件不受影响
    expect(result.preview!['TOOLS.md']).toContain('工具列表将在启动时动态注入');
    expect(result.preview!['USER.md']).toBe('');
    expect(result.preview!['MEMORY.md']).toBe('');
  });

  it('LLM 调用失败时 fallback 到模板', async () => {
    const mockLLM = vi.fn().mockRejectedValue(new Error('API 超时'));

    const builder = new AgentBuilder(agentManager, mockLLM);
    const session = builder.createSession();

    await builder.advance(session, '英语老师');
    await builder.advance(session, '英语口语');
    await builder.advance(session, '耐心教学');
    const result = await builder.advance(session, '无');

    expect(result.stage).toBe('preview');
    expect(result.preview).toBeTruthy();

    // Fallback 模板内容
    expect(result.preview!['SOUL.md']).toContain('英语老师');
    expect(result.preview!['SOUL.md']).toContain('核心价值观');
    expect(result.preview!['AGENTS.md']).toContain('耐心教学');
  });

  it('无 LLM 时使用模板生成', async () => {
    const builder = new AgentBuilder(agentManager); // 不传 llmGenerate
    const session = builder.createSession();

    await builder.advance(session, '数据分析师');
    await builder.advance(session, '数据可视化');
    await builder.advance(session, '专业严谨');
    const result = await builder.advance(session, '无');

    expect(result.stage).toBe('preview');
    expect(result.preview!['SOUL.md']).toContain('数据分析师');
    expect(result.preview!['AGENTS.md']).toContain('专业严谨');
  });

  it('LLM 生成的 prompt 包含用户所有输入', async () => {
    const mockLLM = vi.fn()
      .mockResolvedValueOnce('# SOUL')
      .mockResolvedValueOnce('# AGENTS');

    const builder = new AgentBuilder(agentManager, mockLLM);
    const session = builder.createSession();

    await builder.advance(session, '全栈开发');
    await builder.advance(session, 'React + Node.js');
    await builder.advance(session, '轻松幽默');
    await builder.advance(session, '代码必须有注释');

    // 验证 LLM 调用包含所有用户输入
    const soulCall = mockLLM.mock.calls[0];
    expect(soulCall[0]).toContain('SOUL.md');          // system prompt 提到 SOUL.md
    expect(soulCall[1]).toContain('全栈开发');           // role
    expect(soulCall[1]).toContain('React + Node.js');   // expertise
    expect(soulCall[1]).toContain('轻松幽默');           // style
    expect(soulCall[1]).toContain('代码必须有注释');      // constraints

    const agentsCall = mockLLM.mock.calls[1];
    expect(agentsCall[0]).toContain('AGENTS.md');       // system prompt 提到 AGENTS.md
    expect(agentsCall[1]).toContain('全栈开发');
  });
});
