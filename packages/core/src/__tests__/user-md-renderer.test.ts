import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import { UserMdRenderer } from '../memory/user-md-renderer.js';
import type { MemoryUnit, MemoryCategory } from '@evoclaw/shared';

/** 读取迁移 SQL */
const MIGRATION_001 = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '001_initial.sql'),
  'utf-8',
);
const MIGRATION_002 = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '002_memory_units.sql'),
  'utf-8',
);
const MIGRATION_004 = fs.readFileSync(
  path.join(import.meta.dirname, '..', 'infrastructure', 'db', 'migrations', '004_conversation_log.sql'),
  'utf-8',
);

/** 测试用 Agent ID */
const TEST_AGENT_ID = 'test-agent-renderer-001';

/** 创建测试记忆单元 */
function createTestUnit(overrides: Partial<MemoryUnit> = {}): MemoryUnit {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    agentId: TEST_AGENT_ID,
    category: 'entity',
    mergeType: 'independent',
    mergeKey: null,
    l0Index: '测试索引',
    l1Overview: '测试概览',
    l2Content: '测试完整内容',
    confidence: 0.8,
    activation: 1.0,
    accessCount: 0,
    visibility: 'private',
    sourceConversationId: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: null,
    ...overrides,
  };
}

/** 将 MemoryUnit 插入数据库 */
function insertMemory(store: SqliteStore, unit: MemoryUnit): void {
  store.run(
    `INSERT INTO memory_units (
      id, agent_id, category, merge_type, merge_key,
      l0_index, l1_overview, l2_content,
      confidence, activation, access_count,
      visibility, source_session_key,
      created_at, updated_at, archived_at, pinned
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    unit.id, unit.agentId, unit.category, unit.mergeType, unit.mergeKey,
    unit.l0Index, unit.l1Overview, unit.l2Content,
    unit.confidence, unit.activation, unit.accessCount,
    unit.visibility, unit.sourceConversationId,
    unit.createdAt, unit.updatedAt, unit.archivedAt,
    0, // pinned
  );
}

describe('UserMdRenderer', () => {
  let store: SqliteStore;
  let renderer: UserMdRenderer;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = path.join(os.tmpdir(), `evoclaw-renderer-test-${crypto.randomUUID()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    const dbPath = path.join(tmpDir, 'test.db');

    store = new SqliteStore(dbPath);
    // 执行迁移：001（agents 表）+ 002（memory_units 表）+ 004（conversation_log 表）
    store.exec(MIGRATION_001);
    store.exec(MIGRATION_002);
    store.exec(MIGRATION_004);
    // 插入测试 Agent
    store.run(
      `INSERT INTO agents (id, name, emoji, status) VALUES (?, ?, ?, ?)`,
      TEST_AGENT_ID, '渲染测试助手', '📝', 'active',
    );

    renderer = new UserMdRenderer(store);
  });

  afterEach(() => {
    try { store.close(); } catch { /* 忽略 */ }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ---------- renderUserMd ----------

  describe('renderUserMd', () => {
    it('应包含 profile、preference、correction 三个分类', () => {
      // 插入各类别记忆
      insertMemory(store, createTestUnit({
        category: 'profile',
        l0Index: '用户名是小明',
      }));
      insertMemory(store, createTestUnit({
        category: 'preference',
        l0Index: '喜欢简洁回复',
      }));
      insertMemory(store, createTestUnit({
        category: 'correction',
        l0Index: '纠正：不是北京人而是上海人',
      }));

      const md = renderer.renderUserMd(TEST_AGENT_ID);

      // 检查标题和各分区
      expect(md).toContain('# 用户画像');
      expect(md).toContain('## 个人信息');
      expect(md).toContain('用户名是小明');
      expect(md).toContain('## 偏好习惯');
      expect(md).toContain('喜欢简洁回复');
      expect(md).toContain('## 纠正反馈');
      expect(md).toContain('纠正：不是北京人而是上海人');
    });

    it('没有记忆时应只返回标题头', () => {
      const md = renderer.renderUserMd(TEST_AGENT_ID);

      expect(md).toContain('# 用户画像');
      // 不应包含任何分区标题
      expect(md).not.toContain('## 个人信息');
      expect(md).not.toContain('## 偏好习惯');
      expect(md).not.toContain('## 纠正反馈');
    });

    it('只有部分类别有记忆时应只渲染该类别', () => {
      insertMemory(store, createTestUnit({
        category: 'profile',
        l0Index: '30 岁的开发者',
      }));

      const md = renderer.renderUserMd(TEST_AGENT_ID);

      expect(md).toContain('## 个人信息');
      expect(md).toContain('30 岁的开发者');
      expect(md).not.toContain('## 偏好习惯');
      expect(md).not.toContain('## 纠正反馈');
    });

    it('correction 类别记忆应带有警告标记', () => {
      insertMemory(store, createTestUnit({
        category: 'correction',
        l0Index: '不要使用英文回复',
      }));

      const md = renderer.renderUserMd(TEST_AGENT_ID);
      // correction 前缀有 ⚠️ 标记
      expect(md).toContain('⚠️ 不要使用英文回复');
    });
  });

  // ---------- renderMemoryMd ----------

  describe('renderMemoryMd', () => {
    it('应过滤 activation <= 0.3 的记忆', () => {
      // 活跃记忆（activation > 0.3）
      insertMemory(store, createTestUnit({
        category: 'entity',
        l0Index: '活跃知识',
        activation: 0.8,
      }));
      // 低活跃记忆（activation <= 0.3）
      insertMemory(store, createTestUnit({
        category: 'entity',
        l0Index: '沉寂知识',
        activation: 0.2,
      }));

      const md = renderer.renderMemoryMd(TEST_AGENT_ID);

      expect(md).toContain('活跃知识');
      expect(md).not.toContain('沉寂知识');
    });

    it('应按类别分组显示', () => {
      // 插入不同类别的活跃记忆
      const categories: Array<{ cat: MemoryCategory; label: string; index: string }> = [
        { cat: 'entity', label: '实体知识', index: 'React 框架' },
        { cat: 'event', label: '事件经历', index: '上周的会议' },
        { cat: 'tool', label: '工具使用', index: 'Git 命令' },
      ];

      for (const { cat, index } of categories) {
        insertMemory(store, createTestUnit({
          category: cat,
          l0Index: index,
          activation: 0.9,
        }));
      }

      const md = renderer.renderMemoryMd(TEST_AGENT_ID);

      expect(md).toContain('# 活跃记忆');
      expect(md).toContain('## 实体知识');
      expect(md).toContain('React 框架');
      expect(md).toContain('## 事件经历');
      expect(md).toContain('上周的会议');
      expect(md).toContain('## 工具使用');
      expect(md).toContain('Git 命令');
    });

    it('没有活跃记忆时应显示"暂无活跃记忆"', () => {
      // 只插入低 activation 记忆
      insertMemory(store, createTestUnit({
        category: 'entity',
        l0Index: '不活跃的记忆',
        activation: 0.1,
      }));

      const md = renderer.renderMemoryMd(TEST_AGENT_ID);

      expect(md).toContain('暂无活跃记忆');
    });

    it('完全没有记忆时应显示"暂无活跃记忆"', () => {
      const md = renderer.renderMemoryMd(TEST_AGENT_ID);
      expect(md).toContain('暂无活跃记忆');
    });

    it('高频访问记忆应带有📌标记', () => {
      insertMemory(store, createTestUnit({
        category: 'entity',
        l0Index: '高频知识点',
        activation: 0.9,
        accessCount: 10, // > 5
        confidence: 0.9,
      }));

      const md = renderer.renderMemoryMd(TEST_AGENT_ID);

      expect(md).toContain('📌 高频知识点');
      expect(md).toContain('置信度: 0.9');
    });

    it('低频访问记忆不应带有📌标记', () => {
      insertMemory(store, createTestUnit({
        category: 'entity',
        l0Index: '普通知识点',
        activation: 0.9,
        accessCount: 3, // <= 5
      }));

      const md = renderer.renderMemoryMd(TEST_AGENT_ID);

      expect(md).not.toContain('📌');
      expect(md).toContain('普通知识点');
    });
  });

  // ---------- renderDailyLog ----------

  describe('renderDailyLog', () => {
    it('有对话日志时应返回格式化的日志', () => {
      // 插入对话日志
      const sessionKey = `agent:${TEST_AGENT_ID}:default:direct:`;
      store.run(
        `INSERT INTO conversation_log
          (id, agent_id, session_key, role, content, token_count, compaction_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'raw', ?)`,
        'log-001', TEST_AGENT_ID, sessionKey, 'user', '你好，请帮我分析代码', 10,
        new Date().toISOString(),
      );
      store.run(
        `INSERT INTO conversation_log
          (id, agent_id, session_key, role, content, token_count, compaction_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'raw', ?)`,
        'log-002', TEST_AGENT_ID, sessionKey, 'assistant', '好的，请把代码发给我', 8,
        new Date().toISOString(),
      );

      const today = new Date().toISOString().slice(0, 10);
      const md = renderer.renderDailyLog(TEST_AGENT_ID, today);

      // 应包含日期标题
      expect(md).toContain(`# ${today} 对话日志`);
      // 应包含用户和助手的消息
      expect(md).toContain('👤');
      expect(md).toContain('**user**');
      expect(md).toContain('你好，请帮我分析代码');
      expect(md).toContain('🤖');
      expect(md).toContain('**assistant**');
      expect(md).toContain('好的，请把代码发给我');
    });

    it('没有日志时应显示"暂无记录"', () => {
      // 使用一个不同的 agentId，确保没有日志
      const md = renderer.renderDailyLog('nonexistent-agent', '2026-01-01');

      expect(md).toContain('暂无记录');
    });

    it('超长内容应被截断到 200 字符', () => {
      const sessionKey = `agent:${TEST_AGENT_ID}:default:direct:`;
      const longContent = '长'.repeat(300);
      store.run(
        `INSERT INTO conversation_log
          (id, agent_id, session_key, role, content, token_count, compaction_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'raw', ?)`,
        'log-long', TEST_AGENT_ID, sessionKey, 'user', longContent, 300,
        new Date().toISOString(),
      );

      const today = new Date().toISOString().slice(0, 10);
      const md = renderer.renderDailyLog(TEST_AGENT_ID, today);

      // 内容应被截断，末尾有 "..."
      expect(md).toContain('...');
      // 不应包含完整的 300 个字符
      expect(md).not.toContain('长'.repeat(300));
    });
  });
});
