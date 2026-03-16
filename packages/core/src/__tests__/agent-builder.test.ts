import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { AgentManager } from '../agent/agent-manager.js';
import { AgentBuilder, type BuilderState } from '../agent/agent-builder.js';

/** 读取初始迁移 SQL */
const MIGRATION_SQL = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '001_initial.sql'),
  'utf-8'
);

describe('AgentBuilder', () => {
  let store: SqliteStore;
  let manager: AgentManager;
  let builder: AgentBuilder;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-builder-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const dbPath = path.join(tmpDir, 'test.db');
    const agentsDir = path.join(tmpDir, 'agents');

    store = new SqliteStore(dbPath);
    store.exec(MIGRATION_SQL);
    manager = new AgentManager(store, agentsDir);
    builder = new AgentBuilder(manager);
  });

  afterEach(() => {
    try { store.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('createSession 应该返回初始状态，阶段为 role', () => {
    const state = builder.createSession();
    expect(state.stage).toBe('role');
    expect(state.inputs).toEqual({});
    expect(state.preview).toEqual({});
    expect(state.agentId).toBeUndefined();
  });

  it('完整流程: role → expertise → style → constraints → preview → confirm → done', async () => {
    const state = builder.createSession();

    // role → expertise
    const r1 = await builder.advance(state, '资深前端程序员');
    expect(r1.stage).toBe('expertise');
    expect(r1.done).toBe(false);
    expect(state.inputs.role).toBe('资深前端程序员');

    // expertise → style
    const r2 = await builder.advance(state, 'React 和 TypeScript 开发');
    expect(r2.stage).toBe('style');
    expect(r2.done).toBe(false);
    expect(state.inputs.expertise).toBe('React 和 TypeScript 开发');

    // style → constraints
    const r3 = await builder.advance(state, '专业严谨');
    expect(r3.stage).toBe('constraints');
    expect(r3.done).toBe(false);
    expect(state.inputs.style).toBe('专业严谨');

    // constraints → preview
    const r4 = await builder.advance(state, '回答控制在 200 字以内');
    expect(r4.stage).toBe('preview');
    expect(r4.done).toBe(false);
    expect(r4.preview).toBeDefined();
    expect(state.inputs.constraints).toBe('回答控制在 200 字以内');
    expect(state.inputs.name).toBeDefined();
    expect(state.inputs.emoji).toBeDefined();

    // preview → done (确认)
    const r5 = await builder.advance(state, '确认');
    expect(r5.stage).toBe('done');
    expect(r5.done).toBe(true);
    expect(r5.agentId).toBeDefined();

    // 验证 Agent 已创建并激活
    const agent = manager.getAgent(r5.agentId!);
    expect(agent).toBeDefined();
    expect(agent!.status).toBe('active');
  });

  it('constraints 阶段输入"无"时 constraints 为 undefined', async () => {
    const state = builder.createSession();
    await builder.advance(state, '助手');
    await builder.advance(state, '通用');
    await builder.advance(state, '轻松');
    await builder.advance(state, '无');

    expect(state.inputs.constraints).toBeUndefined();
    expect(state.stage).toBe('preview');
  });

  it('preview 阶段: "修改名称 XXX" 应该更改名称', async () => {
    const state = builder.createSession();
    await builder.advance(state, '编程助手');
    await builder.advance(state, '全栈');
    await builder.advance(state, '简洁');
    await builder.advance(state, '无');

    const r = await builder.advance(state, '修改名称 小码');
    expect(r.stage).toBe('preview');
    expect(r.done).toBe(false);
    expect(state.inputs.name).toBe('小码');
    expect(r.message).toContain('小码');
  });

  it('preview 阶段: "重来" 应该重置到 role 阶段', async () => {
    const state = builder.createSession();
    await builder.advance(state, '翻译官');
    await builder.advance(state, '英中翻译');
    await builder.advance(state, '准确');
    await builder.advance(state, '无');

    expect(state.stage).toBe('preview');

    const r = await builder.advance(state, '重来');
    expect(r.stage).toBe('role');
    expect(r.done).toBe(false);
    expect(state.stage).toBe('role');
    expect(state.inputs).toEqual({});
  });

  it('preview 阶段: 无效输入应该返回帮助信息', async () => {
    const state = builder.createSession();
    await builder.advance(state, '测试');
    await builder.advance(state, '测试');
    await builder.advance(state, '测试');
    await builder.advance(state, '无');

    const r = await builder.advance(state, '随便输入');
    expect(r.stage).toBe('preview');
    expect(r.done).toBe(false);
    expect(r.message).toContain('确认');
    expect(r.message).toContain('修改名称');
    expect(r.message).toContain('重来');
  });

  it('preview 阶段: "确定"、"ok"、"yes" 也能确认创建', async () => {
    for (const confirmWord of ['确定', 'ok', 'yes']) {
      const state = builder.createSession();
      await builder.advance(state, '测试角色');
      await builder.advance(state, '测试领域');
      await builder.advance(state, '测试风格');
      await builder.advance(state, '无');

      const r = await builder.advance(state, confirmWord);
      expect(r.stage).toBe('done');
      expect(r.done).toBe(true);
      expect(r.agentId).toBeDefined();
    }
  });

  it('generateName 应该从角色描述提取关键词', () => {
    expect(builder.generateName('资深前端程序员')).toBe('资深前端程序员助手');
    expect(builder.generateName('资深 前端')).toBe('资深前端助手');
    expect(builder.generateName('英语老师')).toBe('英语老师助手');
    expect(builder.generateName('A')).toBe('AI 助手'); // 短词被过滤
  });

  it('generateEmoji 应该根据关键词匹配 emoji', () => {
    expect(builder.generateEmoji('编程助手')).toBe('💻');
    expect(builder.generateEmoji('写作专家')).toBe('✍️');
    expect(builder.generateEmoji('数据分析师')).toBe('📊');
    expect(builder.generateEmoji('日语学习')).toBe('📚');
    expect(builder.generateEmoji('法律顾问')).toBe('⚖️');
    expect(builder.generateEmoji('未知角色')).toBe('🤖'); // 默认 emoji
  });

  it('生成的工作区文件应该包含用户输入', async () => {
    const state = builder.createSession();
    await builder.advance(state, '数据分析师');
    await builder.advance(state, 'Python 数据科学');
    await builder.advance(state, '严谨专业');
    await builder.advance(state, '附带数据来源');

    const preview = state.preview;
    expect(preview['SOUL.md']).toContain('数据分析师');
    expect(preview['SOUL.md']).toContain('附带数据来源');
    expect(preview['SOUL.md']).toContain('行为哲学');
    expect(preview['AGENTS.md']).toContain('严谨专业');
    expect(preview['AGENTS.md']).toContain('Python 数据科学');
    expect(preview['IDENTITY.md']).toContain('数据分析师');
    expect(preview['IDENTITY.md']).toContain('Python 数据科学');
    // 静态文件也应该存在
    expect(preview['TOOLS.md']).toBeDefined();
    expect(preview['HEARTBEAT.md']).toBeDefined();
    expect(preview['BOOTSTRAP.md']).toBeDefined();
    expect(preview['USER.md']).toBeDefined();
    expect(preview['MEMORY.md']).toBeDefined();
  });

  it('Agent 创建后工作区文件被覆盖为生成内容', async () => {
    const state = builder.createSession();
    await builder.advance(state, '写作助手');
    await builder.advance(state, '小说创作');
    await builder.advance(state, '幽默风趣');
    await builder.advance(state, '无');

    const r = await builder.advance(state, '确认');
    expect(r.agentId).toBeDefined();

    // 验证工作区文件内容包含通用底层 + 角色内容
    const soulContent = manager.readWorkspaceFile(r.agentId!, 'SOUL.md');
    expect(soulContent).toContain('写作助手');
    expect(soulContent).toContain('核心真理');  // 通用底层

    const agentsContent = manager.readWorkspaceFile(r.agentId!, 'AGENTS.md');
    expect(agentsContent).toContain('幽默风趣');
    expect(agentsContent).toContain('小说创作');
  });

  it('done 阶段的 advance 应该返回完成消息', async () => {
    const state = builder.createSession();
    state.stage = 'done';

    const r = await builder.advance(state, '任意输入');
    expect(r.done).toBe(true);
    expect(r.message).toContain('完成');
  });
});
