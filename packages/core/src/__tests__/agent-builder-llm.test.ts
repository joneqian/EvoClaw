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
      // 默认返回值（用于 contextual hints）
      .mockResolvedValue('建议A、建议B、建议C')
      // SOUL.md 个性化（第 4 次调用 = role hint + expertise hint + style hint 后）
      .mockResolvedValueOnce('建议A、建议B') // role → expertise hint
      .mockResolvedValueOnce('建议C、建议D') // expertise → style hint
      .mockResolvedValueOnce('建议E')        // style → constraints hint
      .mockResolvedValueOnce('## 我的角色\n\n我是一位资深 TypeScript 工程师...')
      .mockResolvedValueOnce('## 角色对话规范\n\n- 代码优先，简洁回答...');

    const builder = new AgentBuilder(agentManager, mockLLM);
    const session = builder.createSession();

    await builder.advance(session, '资深程序员');
    await builder.advance(session, 'TypeScript');
    await builder.advance(session, '简洁高效');
    const result = await builder.advance(session, '无');

    expect(result.stage).toBe('preview');
    expect(result.preview).toBeTruthy();

    // LLM 被调用了 5 次（3 次 contextual hints + 2 次文件生成）
    expect(mockLLM).toHaveBeenCalledTimes(5);

    // SOUL.md = 通用底层 + LLM 个性化
    expect(result.preview!['SOUL.md']).toContain('Core Truths');       // 通用底层
    expect(result.preview!['SOUL.md']).toContain('TypeScript 工程师'); // LLM 生成

    // AGENTS.md = 通用操作规程 + LLM 个性化
    expect(result.preview!['AGENTS.md']).toContain('Every Session');   // 通用底层
    expect(result.preview!['AGENTS.md']).toContain('代码优先');        // LLM 生成

    // IDENTITY.md 仍由模板生成
    expect(result.preview!['IDENTITY.md']).toContain('name:');
    expect(result.preview!['IDENTITY.md']).toContain('emoji:');

    // 静态文件
    expect(result.preview!['TOOLS.md']).toContain('Local Notes');
    expect(result.preview!['USER.md']).toBe('');
    expect(result.preview!['MEMORY.md']).toBe('');

    // BOOTSTRAP.md 由模板生成，包含出生仪式和角色信息
    expect(result.preview!['BOOTSTRAP.md']).toContain('Hello, World');
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

    // SOUL.md = 通用底层 + fallback 模板
    expect(result.preview!['SOUL.md']).toContain('Core Truths');  // 通用底层
    expect(result.preview!['SOUL.md']).toContain('英语老师');    // fallback 角色内容
    expect(result.preview!['AGENTS.md']).toContain('耐心教学');  // fallback 风格
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
      .mockResolvedValue('建议A、建议B'); // default for hints

    // Override for SOUL + AGENTS generation (calls 3 and 4, after 3 hint calls)
    mockLLM
      .mockResolvedValueOnce('建议1')   // hint: role → expertise
      .mockResolvedValueOnce('建议2')   // hint: expertise → style
      .mockResolvedValueOnce('建议3')   // hint: style → constraints
      .mockResolvedValueOnce('# SOUL')  // SOUL.md generation
      .mockResolvedValueOnce('# AGENTS'); // AGENTS.md generation

    const builder = new AgentBuilder(agentManager, mockLLM);
    const session = builder.createSession();

    await builder.advance(session, '全栈开发');
    await builder.advance(session, 'React + Node.js');
    await builder.advance(session, '轻松幽默');
    await builder.advance(session, '代码必须有注释');

    // 验证 LLM 调用：3 次 hints + 2 次文件生成 = 5 次
    expect(mockLLM).toHaveBeenCalledTimes(5);

    // SOUL.md 生成调用（第 4 次，index 3）
    const soulCall = mockLLM.mock.calls[3];
    expect(soulCall[0]).toContain('SOUL.md');
    expect(soulCall[1]).toContain('全栈开发');
    expect(soulCall[1]).toContain('React + Node.js');
    expect(soulCall[1]).toContain('轻松幽默');
    expect(soulCall[1]).toContain('代码必须有注释');

    // AGENTS.md 生成调用（第 5 次，index 4）
    const agentsCall = mockLLM.mock.calls[4];
    expect(agentsCall[0]).toContain('AGENTS.md');
    expect(agentsCall[1]).toContain('全栈开发');
  });
});
