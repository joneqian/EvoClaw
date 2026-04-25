/**
 * Task Plan 类型定义
 *
 * - DB row 类型（与 migration 031 表结构对齐）
 * - 服务层快照（外部使用）
 * - 工具入参（builtin tools 的 params 校验）
 */

import type {
  GroupSessionKey,
  PlanStatus,
  TaskStatus,
  ArtifactKind,
  TaskPlanSnapshot,
  TaskNodeSnapshot,
  ArtifactSummary,
} from '../../../channel/team-mode/team-channel.js';

// 重新导出，方便上层 import 一处
export type {
  GroupSessionKey,
  PlanStatus,
  TaskStatus,
  ArtifactKind,
  TaskPlanSnapshot,
  TaskNodeSnapshot,
  ArtifactSummary,
};

/** task_plans 表行（原始 DB 字段） */
export interface TaskPlanRow {
  id: string;
  group_session_key: string;
  channel_type: string;
  goal: string;
  created_by_agent_id: string;
  status: PlanStatus;
  board_card_id: string | null;
  initiator_user_id: string | null;
  revised_from: string | null;
  created_at: string;
  completed_at: string | null;
}

/** tasks 表行 */
export interface TaskRow {
  id: string;
  plan_id: string;
  local_id: string;
  assignee_agent_id: string;
  created_by_agent_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  /** JSON: 字符串数组 */
  depends_on: string;
  output_summary: string | null;
  last_note: string | null;
  stale_marker: 'yellow_15min' | 'red_30min' | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
}

/** task_artifacts 表行 */
export interface TaskArtifactRow {
  id: string;
  task_id: string;
  plan_id: string;
  kind: ArtifactKind;
  title: string;
  uri: string;
  mime_type: string | null;
  size_bytes: number | null;
  inline_content: string | null;
  summary: string;
  created_by_agent_id: string;
  created_at: string;
  supersedes_id: string | null;
  metadata: string | null;
}

/** create_task_plan 工具入参（结构化任务） */
export interface CreatePlanTaskInput {
  /** 稳定本地 ID，PM 自定义（如 t1 / t2 / "design"） */
  localId: string;
  /** 任务标题 */
  title: string;
  /** 任务描述（可选） */
  description?: string;
  /** 指派给的 Agent（peer agent_id） */
  assigneeAgentId: string;
  /** 依赖的前置任务 localId（数组，可空） */
  dependsOn?: string[];
}

/** create_task_plan 入参 */
export interface CreateTaskPlanArgs {
  goal: string;
  tasks: CreatePlanTaskInput[];
}

/** update_task_status 入参 */
export interface UpdateTaskStatusArgs {
  taskId: string;
  status: TaskStatus;
  note?: string;
  outputSummary?: string;
}

/** request_clarification 入参 */
export interface RequestClarificationArgs {
  taskId: string;
  question: string;
}
