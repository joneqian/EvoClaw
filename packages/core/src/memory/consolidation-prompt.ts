/**
 * AutoDream 记忆整合 Prompt 模板
 * 指导 LLM 合并重复记忆、消解矛盾、归档过期条目
 */

import type { MemoryUnit } from '@evoclaw/shared';

/** 记忆统计摘要 */
export interface MemoryStats {
  totalCount: number;
  byCategory: Record<string, number>;
  duplicateMergeKeys: { mergeKey: string; count: number; ids: string[] }[];
  lowActivation: { id: string; activation: number; daysSinceAccess: number }[];
}

/** 构建整合 prompt */
export function buildConsolidationPrompt(
  memories: MemoryUnit[],
  stats: MemoryStats,
): { system: string; user: string } {
  const system = `你是一个记忆整合引擎。你的任务是维护 AI Agent 的长期记忆质量。

## 整合目标

1. **合并重复**: 同一 merge_key 下存在多个版本的记忆，合并为最新最准确的一条
2. **消解矛盾**: 当多条记忆包含矛盾信息时，保留最新的、最可信的版本
3. **时间规范化**: 将相对日期表达（"上周"、"最近"、"前几天"）转换为绝对日期
4. **归档过期**: 标记明显过时或已无价值的记忆

## 约束

- **L0 保持稳定**: 合并时不修改 l0_index（它用于向量索引，变更会影响检索）
- **保守原则**: 不确定时保留而非删除
- **不创造信息**: 只整合已有内容，不添加推测

## 输出格式

使用 XML 格式输出整合指令。如果无需整合，输出 \`<no_consolidation/>\`。

\`\`\`xml
<consolidation>
  <!-- 合并: 将 source_id 的内容合并到 target_id -->
  <merge source_id="旧记忆ID" target_id="保留的记忆ID">
    <l1_overview>合并后的 L1 概览</l1_overview>
    <l2_content>合并后的 L2 完整内容</l2_content>
  </merge>

  <!-- 归档: 标记过期/无价值的记忆 -->
  <archive id="要归档的记忆ID" reason="归档原因" />
</consolidation>
\`\`\`

## 决策规则

### 合并规则
- 同一 merge_key 的多条记忆 → 合并为一条，保留最新信息
- 语义高度重叠的独立记忆 → 如果属于 merge 类型且话题相同，合并
- merge 操作中，target_id 应为最新更新的那条

### 归档规则
- activation < 0.1 且 30+ 天未访问 → 归档
- 与更新的记忆明确矛盾 → 归档旧版本
- 内容完全被另一条记忆包含 → 归档冗余条目

### 不操作
- independent 类型（event/case）的记忆：每条都是独立事件，不合并
- 不确定是否矛盾时：保留两条
- pinned 记忆：不归档`;

  // 构建记忆清单
  const memorySummary = memories.map(m => {
    const age = Math.floor((Date.now() - new Date(m.updatedAt).getTime()) / (1000 * 60 * 60 * 24));
    return `<memory id="${m.id}" category="${m.category}" merge_key="${m.mergeKey ?? 'null'}" merge_type="${m.mergeType}" activation="${m.activation.toFixed(3)}" age_days="${age}">
  <l0>${m.l0Index}</l0>
  <l1>${m.l1Overview}</l1>
</memory>`;
  }).join('\n');

  // 构建统计信息
  const dupInfo = stats.duplicateMergeKeys.length > 0
    ? `\n### 重复 merge_key:\n${stats.duplicateMergeKeys.map(d => `- ${d.mergeKey}: ${d.count} 条 (IDs: ${d.ids.join(', ')})`).join('\n')}`
    : '';

  const lowActInfo = stats.lowActivation.length > 0
    ? `\n### 低活跃度记忆:\n${stats.lowActivation.map(l => `- ${l.id}: activation=${l.activation.toFixed(3)}, ${l.daysSinceAccess} 天未访问`).join('\n')}`
    : '';

  const user = `## 统计概览

- 记忆总数: ${stats.totalCount}
- 类别分布: ${Object.entries(stats.byCategory).map(([k, v]) => `${k}=${v}`).join(', ')}
${dupInfo}${lowActInfo}

## 记忆清单

${memorySummary}

请分析以上记忆，按照系统指令输出整合指令。只输出 XML，不要输出分析过程。`;

  return { system, user };
}
