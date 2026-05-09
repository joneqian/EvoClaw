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
  /**
   * M13 Phase 1 PR-1B: 跨渠道员工身份锚点
   *
   * 由 memory_extractor 在 LLM extract 后基于当前 sessionKey 的 peerId 反查
   * identity_links 填充。null 表示未关联到 canonical（系统级记忆 / 旧记忆）。
   *
   * 用途：跨渠道员工偏好/角色等记忆的锚定合并 — 即使 LLM 在飞书/企微 extract
   * 出不同 mergeKey，也可按 (agentId, canonicalUserId) 维度检索/聚合。
   */
  canonicalUserId?: string | null;
}

/**
 * Peer 印象记忆 L1 结构（M13 #3 同事印象记忆）
 * 存储位置：memory_units.l1_overview，category='entity'，merge_key='peer:{peerAgentId}'
 */
export interface PeerImpressionL1 {
  /** 被记忆的同事 Agent ID */
  peerAgentId: string;
  /** 同事 Agent 名称（冗余存便于注入 prompt 时不再查 agents 表） */
  peerName: string;
  /** 协作风格摘要：直接/含蓄/资料控/口语化等自由文本 */
  collaborationStyle: string;
  /** 强项领域 */
  strengths: string[];
  /** 摩擦/困难点 */
  frictions: string[];
  /** 累计互动轮数（每次提取 +1，未到 3 视为不稳定印象） */
  interactionCount: number;
  /** 最近一次互动时间（ISO 8601） */
  lastInteractionAt: string;
  /** 最近一次任务结果：完成/部分完成/未完成/搁置/未知 */
  lastTaskOutcome: string;
  /** 最近一次任务一行总结 */
  lastTaskSummary: string;
  /** 最近所在群（可选，便于排障） */
  lastSeenInGroup?: string;
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
