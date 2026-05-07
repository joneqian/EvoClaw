-- M1.1 Checkpoint Manager: 工具调用前自动备份元数据表
--
-- 每次 agent 调用破坏性工具（write / edit / apply_patch 等）前，
-- checkpoint-manager 会把被改文件的当前内容存入 .evoclaw/checkpoints/objects/<sha256>.gz
-- （内容寻址 + 引用计数共享，参考 Hermes single-store checkpoint 设计 a0fedfbb1），
-- 并在本表登记一条记录便于：
-- - REST `/checkpoint/recent` 列出最近 N 条供 UI 撤销
-- - 工具失败时 manager 按 tool_invocation_id 自动 revert
-- - 手动 `/checkpoint/revert/:id` 让用户在 Files Tab 一键撤销最近改动
-- - cron GC 按 created_at 7 天前 + reverted_at 已 revert 的清理
--
-- 不存文件原始内容（那在 objects/<sha256>.gz）—— 本表只是索引和元数据。

CREATE TABLE IF NOT EXISTS checkpoint_log (
  -- toolInvocationId（kernel 侧每次工具调用的唯一 ID，UUID 字符串）作主键
  -- 一条工具调用只对应一个 checkpoint，多文件批量改动也共享同一 invocation_id
  tool_invocation_id TEXT PRIMARY KEY,
  agent_id TEXT,
  session_key TEXT,
  tool_name TEXT NOT NULL,
  -- 被改文件清单 JSON：[{ path, sha256_before, sha256_after? }]
  -- sha256_before 必填（用于 revert）；sha256_after 可空（写后哈希，便于 GC 引用计数验证）
  files_json TEXT NOT NULL,
  -- 关联的工具调用结果（成功 / 失败原因摘要），用于 UI 展示
  tool_status TEXT,
  -- Unix ms 时间戳
  created_at INTEGER NOT NULL,
  -- 已撤销标记：null = 未撤销，否则为撤销时刻 ms
  reverted_at INTEGER
);

-- 按 created_at 倒序查最近 N 条（UI 列表 + GC 都走这个索引）
CREATE INDEX IF NOT EXISTS idx_checkpoint_log_created_at
  ON checkpoint_log(created_at DESC);

-- 按 agent 查所有 checkpoint（agent 维度审计 / 撤销自己的改动）
CREATE INDEX IF NOT EXISTS idx_checkpoint_log_agent
  ON checkpoint_log(agent_id, created_at DESC);

-- 已撤销 + 旧 checkpoint 的 GC 候选查询索引
CREATE INDEX IF NOT EXISTS idx_checkpoint_log_reverted_at
  ON checkpoint_log(reverted_at)
  WHERE reverted_at IS NOT NULL;
