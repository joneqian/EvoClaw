/** 能力图谱节点 */
export interface CapabilityNode {
  name: string;
  level: number;
  useCount: number;
  successRate: number;
  lastUsedAt: string | null;
}

/** 能力维度 */
export type CapabilityDimension =
  | 'coding'
  | 'analysis'
  | 'writing'
  | 'research'
  | 'planning'
  | 'debugging'
  | 'data'
  | 'communication';

/** 成长事件 */
export interface GrowthEvent {
  type: 'capability_up' | 'capability_down' | 'new_capability' | 'milestone';
  capability: string;
  delta: number;
  timestamp: string;
}

/** 满意度信号 */
export interface SatisfactionSignal {
  score: number; // 0-1
  signals: string[];
  messageId?: string;
}

/** Heartbeat 配置 */
export interface HeartbeatConfig {
  intervalMinutes: number;
  activeHours: { start: string; end: string };
  enabled: boolean;
  /** 最小执行间隔（分钟），防止频繁触发浪费 token（默认 5） */
  minIntervalMinutes?: number;
  /** 投递目标：'none'（默认）= 不投递 | 'last' = 最近渠道 | 渠道 ID */
  target?: 'none' | 'last' | string;
  /** 是否投递 HEARTBEAT_OK 确认消息（默认 false） */
  showOk?: boolean;
  /** 是否投递告警内容（默认 true） */
  showAlerts?: boolean;
  /** 自定义 prompt 覆盖（默认使用内置英文 prompt） */
  prompt?: string;
  /** HEARTBEAT_OK 后允许的最大附带文本字符数（默认 300） */
  ackMaxChars?: number;
  /** 是否使用隔离 session（默认 false = 共享主 session） */
  isolatedSession?: boolean;
  /** 是否使用轻量上下文 — 仅加载 HEARTBEAT.md（默认 false） */
  lightContext?: boolean;
  /** 模型覆盖 — 使用更便宜的模型运行 heartbeat */
  model?: string;
}

/** Cron 任务配置 */
export interface CronJobConfig {
  id: string;
  agentId: string;
  name: string;
  cronExpression: string;
  actionType: 'prompt' | 'tool' | 'pipeline' | 'event';
  actionConfig: Record<string, unknown>;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 成长向量 — 各维度最近变化 */
export interface GrowthVector {
  dimension: string;
  delta: number;
  trend: 'up' | 'down' | 'stable';
}
