import crypto from 'node:crypto';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { CapabilityNode, CapabilityDimension } from '@evoclaw/shared';

/** 能力关键词映射 */
const CAPABILITY_KEYWORDS: Record<CapabilityDimension, string[]> = {
  coding: ['code', 'function', 'class', 'implement', '代码', '实现', '编程', '函数', '类'],
  analysis: ['analyze', 'compare', 'evaluate', '分析', '比较', '评估', '对比'],
  writing: ['write', 'draft', 'compose', 'article', '写', '文章', '撰写', '文案'],
  research: ['search', 'find', 'investigate', 'research', '搜索', '查找', '研究', '调查'],
  planning: ['plan', 'design', 'architect', 'strategy', '计划', '设计', '架构', '规划'],
  debugging: ['debug', 'fix', 'error', 'bug', 'issue', '调试', '修复', '错误', '问题'],
  data: ['data', 'database', 'sql', 'query', 'csv', '数据', '数据库', '查询'],
  communication: ['explain', 'translate', 'summarize', 'help', '解释', '翻译', '总结', '帮助'],
};

/** 工具 → 能力映射 */
const TOOL_CAPABILITY_MAP: Record<string, CapabilityDimension> = {
  Read: 'research',
  Write: 'coding',
  Edit: 'coding',
  Bash: 'coding',
  Grep: 'research',
  Glob: 'research',
};

/**
 * 能力图谱 — 追踪 Agent 各维度能力
 */
export class CapabilityGraph {
  constructor(private db: SqliteStore) {}

  /** 从消息和工具调用中识别能力维度 */
  detectCapabilities(
    messages: { role: string; content: string }[],
    toolCalls?: { toolName: string }[],
  ): CapabilityDimension[] {
    const detected = new Set<CapabilityDimension>();

    // 关键词匹配
    const text = messages
      .map((m) => m.content)
      .join(' ')
      .toLowerCase();

    for (const [dimension, keywords] of Object.entries(CAPABILITY_KEYWORDS)) {
      if (keywords.some((kw) => text.includes(kw))) {
        detected.add(dimension as CapabilityDimension);
      }
    }

    // 工具类型映射
    if (toolCalls) {
      for (const call of toolCalls) {
        const cap = TOOL_CAPABILITY_MAP[call.toolName];
        if (cap) detected.add(cap);
      }
    }

    return Array.from(detected);
  }

  /** 更新能力记录（UPSERT） */
  updateCapability(agentId: string, capability: string, success: boolean): void {
    const existing = this.db.get<{
      id: string;
      use_count: number;
      success_rate: number;
      level: number;
    }>(
      'SELECT id, use_count, success_rate, level FROM capability_graph WHERE agent_id = ? AND capability = ?',
      agentId,
      capability,
    );

    const now = new Date().toISOString();

    if (existing) {
      const newCount = existing.use_count + 1;
      const newSuccessRate =
        (existing.success_rate * existing.use_count + (success ? 1 : 0)) / newCount;
      // level 基于使用次数和成功率计算
      const newLevel = Math.min(10, Math.log1p(newCount) * newSuccessRate * 2);

      this.db.run(
        `UPDATE capability_graph
         SET use_count = ?, success_rate = ?, level = ?, last_used_at = ?, updated_at = ?
         WHERE id = ?`,
        newCount,
        newSuccessRate,
        newLevel,
        now,
        now,
        existing.id,
      );
    } else {
      const id = crypto.randomUUID();
      const successRate = success ? 1.0 : 0.0;
      const level = success ? Math.log1p(1) * 2 : 0;

      this.db.run(
        `INSERT INTO capability_graph (id, agent_id, capability, level, use_count, success_rate, last_used_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?)`,
        id,
        agentId,
        capability,
        level,
        successRate,
        now,
        now,
        now,
      );
    }
  }

  /** 获取 Agent 完整能力图谱 */
  getCapabilityGraph(agentId: string): CapabilityNode[] {
    const rows = this.db.all<{
      capability: string;
      level: number;
      use_count: number;
      success_rate: number;
      last_used_at: string | null;
    }>(
      'SELECT capability, level, use_count, success_rate, last_used_at FROM capability_graph WHERE agent_id = ? ORDER BY level DESC',
      agentId,
    );

    return rows.map((r) => ({
      name: r.capability,
      level: r.level,
      useCount: r.use_count,
      successRate: r.success_rate,
      lastUsedAt: r.last_used_at,
    }));
  }

  /** 获取 Top N 能力 */
  getTopCapabilities(agentId: string, limit = 5): CapabilityNode[] {
    const rows = this.db.all<{
      capability: string;
      level: number;
      use_count: number;
      success_rate: number;
      last_used_at: string | null;
    }>(
      'SELECT capability, level, use_count, success_rate, last_used_at FROM capability_graph WHERE agent_id = ? ORDER BY level DESC LIMIT ?',
      agentId,
      limit,
    );

    return rows.map((r) => ({
      name: r.capability,
      level: r.level,
      useCount: r.use_count,
      successRate: r.success_rate,
      lastUsedAt: r.last_used_at,
    }));
  }
}
