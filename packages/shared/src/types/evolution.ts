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
}

/** Cron 任务配置 */
export interface CronJobConfig {
  id: string;
  agentId: string;
  name: string;
  cronExpression: string;
  actionType: 'prompt' | 'tool' | 'pipeline';
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
