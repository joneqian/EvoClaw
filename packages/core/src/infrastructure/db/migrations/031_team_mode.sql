-- M13 Team Mode: 多 Agent 团队协作核心表
--
-- 三张表 + 一个字段扩展：
--   1. task_plans      - 项目计划（DAG 容器）
--   2. tasks           - 任务节点（含责任链字段 created_by_agent_id + assignee_agent_id）
--   3. task_artifacts  - 中间产物（统一 URI 抽象）
--   4. agents.role     - 角色字段（信息性，不做 tool gating；前端预埋）
--
-- 关键设计：
--   - channel-agnostic：用 group_session_key + channel_type，无 chat_id / feishu_ 字段
--   - 同群可并发多个 active plan（用户可同时跟进多条线）
--   - artifact.uri 统一 schema（feishu-doc:// / file:// / https:// 等）

CREATE TABLE IF NOT EXISTS task_plans (
  id TEXT PRIMARY KEY,
  group_session_key TEXT NOT NULL,                    -- "feishu:chat:oc_xxx" / "ilink:room:yyy"（渠道无关）
  channel_type TEXT NOT NULL,                         -- 'feishu' | 'ilink' | 'wecom' | 'slack' ...
  goal TEXT NOT NULL,
  created_by_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT, -- 责任链第二跳 / plan 兜底
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'completed', 'cancelled')),
  board_card_id TEXT,                                 -- 渠道原生卡片 ID（飞书 message_id / Slack ts / 其他）
  initiator_user_id TEXT,                             -- 原始发起用户（责任链最后一跳）
  revised_from TEXT REFERENCES task_plans(id) ON DELETE SET NULL, -- /revise 命令链接的上一版 plan
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_task_plans_group ON task_plans(group_session_key, status);
CREATE INDEX IF NOT EXISTS idx_task_plans_creator ON task_plans(created_by_agent_id, status);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES task_plans(id) ON DELETE CASCADE,
  local_id TEXT NOT NULL,                             -- PM 创建时给的稳定引用 t1/t2/t3
  assignee_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  created_by_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT, -- 谁派的活；责任链第一跳
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN (
      'pending',                     -- 等待依赖完成 / 等待启动
      'in_progress',                 -- assignee 进行中
      'done',                        -- 完成
      'cancelled',                   -- /cancel 命令终止
      'blocked',                     -- 依赖未完成 (等价 pending，仅展示用)
      'needs_help',                  -- assignee 主动求助
      'blocked_on_clarification',    -- 等 creator 回复澄清
      'paused',                      -- 被 /pause 暂停
      'stalled'                      -- assignee 被停用自动标记
    )),
  depends_on TEXT NOT NULL DEFAULT '[]',              -- JSON: array of local_id
  output_summary TEXT,
  last_note TEXT,
  stale_marker TEXT                                   -- null / 'yellow_15min' / 'red_30min'
    CHECK (stale_marker IS NULL OR stale_marker IN ('yellow_15min', 'red_30min')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  started_at TEXT,
  completed_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(plan_id, local_id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_plan ON tasks(plan_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON tasks(assignee_agent_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_creator ON tasks(created_by_agent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_stale ON tasks(stale_marker, updated_at) WHERE stale_marker IS NOT NULL;

CREATE TABLE IF NOT EXISTS task_artifacts (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES task_plans(id) ON DELETE CASCADE, -- 冗余，按 plan 汇总用
  kind TEXT NOT NULL
    CHECK (kind IN ('text', 'markdown', 'image', 'file', 'doc', 'link')),
  title TEXT NOT NULL,
  uri TEXT NOT NULL,                                  -- 统一 schema：evoclaw-artifact:// / feishu-doc:// / file:// 等
  mime_type TEXT,
  size_bytes INTEGER,
  inline_content TEXT,                                -- text/短 markdown 直接塞这里
  summary TEXT NOT NULL,                              -- 一行摘要（所有 kind 必填，用于 prompt 注入）
  created_by_agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  supersedes_id TEXT REFERENCES task_artifacts(id) ON DELETE SET NULL, -- 简易版本链
  metadata TEXT                                       -- JSON: image 宽高、doc 权限、file sha256 等
);

CREATE INDEX IF NOT EXISTS idx_artifacts_task ON task_artifacts(task_id);
CREATE INDEX IF NOT EXISTS idx_artifacts_plan ON task_artifacts(plan_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_supersedes ON task_artifacts(supersedes_id) WHERE supersedes_id IS NOT NULL;

-- 既有 agents 表追加 role 字段（前端预埋用）
-- pm / backend / product / design / general / 自定义文本
-- 仅作信息性用途：填充 system prompt 自我介绍 + peer roster role 字段
-- 不做 tool gating（去 PM 中心化）
ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'general';
