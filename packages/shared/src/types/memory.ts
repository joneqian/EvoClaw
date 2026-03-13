/** 记忆类别 — 9 种 */
export type MemoryCategory =
  | 'profile'    // 个人信息
  | 'preference' // 偏好习惯
  | 'entity'     // 实体知识
  | 'event'      // 事件经历
  | 'case'       // 问题解决案例
  | 'pattern'    // 行为模式
  | 'tool'       // 工具使用
  | 'skill'      // 技能知识
  | 'correction'; // 纠错反馈

/** 合并类型 */
export type MergeType = 'merge' | 'independent';

/** 可见性 */
export type MemoryVisibility = 'private' | 'shared' | 'channel_only';

/** 记忆单元 — 对应 memory_units 表 */
export interface MemoryUnit {
  id: string;
  agentId: string;
  category: MemoryCategory;
  mergeType: MergeType;
  mergeKey: string | null;
  l0Index: string;       // ~50 tokens 摘要
  l1Overview: string;    // ~500-2K tokens 结构化概览
  l2Content: string;     // 完整内容
  embedding?: Float32Array; // sqlite-vec 向量
  confidence: number;    // 0-1
  activation: number;    // hotness 分数
  accessCount: number;
  visibility: MemoryVisibility;
  sourceConversationId: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

/** 知识图谱条目 */
export interface KnowledgeGraphEntry {
  id: string;
  agentId: string;
  subjectId: string;
  relation: string;
  objectId: string;
  confidence: number;
  createdAt: string;
}
