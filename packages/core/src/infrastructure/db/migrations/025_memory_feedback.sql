-- Sprint 15.12 Phase B — 记忆反馈表
--
-- 用户在前端记忆中心点"不准确 / 涉及隐私 / 过时"按钮时，写入此表。
-- 提交反馈时同时把 memory_units.confidence -= 0.15（在 store 层做，不在迁移里）。
-- 后续 AutoDream 整合时优先合并/裁剪 confidence 低的记忆。
--
-- type 含义：
--   inaccurate — 内容错误（事实不符）
--   sensitive — 涉及隐私不应保留
--   outdated  — 过时（信息已变化）
--
-- resolved_at 为 NULL 表示未处理；非 NULL 表示已解决（被编辑/归档/确认无效）。

CREATE TABLE IF NOT EXISTS memory_feedback (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('inaccurate', 'sensitive', 'outdated')),
  note TEXT,
  reported_at TEXT NOT NULL DEFAULT (datetime('now')),
  resolved_at TEXT,
  FOREIGN KEY (memory_id) REFERENCES memory_units(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_memory_feedback_memory ON memory_feedback(memory_id);
CREATE INDEX IF NOT EXISTS idx_memory_feedback_agent_unresolved
  ON memory_feedback(agent_id, reported_at DESC)
  WHERE resolved_at IS NULL;
