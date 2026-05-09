-- M13 Phase 1 PR-1B — memory_units 加 canonical_user_id 列（D7 决策）
--
-- 业务场景：identityLinks 把员工跨渠道身份聚合到 canonical_id。如果不锚定到
-- memory_units，记忆层仍然按 LLM extract 的 merge_key 字符串合并，员工跨渠道
-- 偏好/角色等记忆容易因 LLM 一致性偏差而分裂。
--
-- 本迁移让 memory_extractor 在 LLM extract 后填 canonical_user_id（基于当前
-- sessionKey 的 peerId 反查 identity_links）。findByMergeKey 可加 canonical 过
-- 滤选项。
--
-- 旧记忆 NULL 不影响：当前查询不带 canonical 过滤；新提取强制填。
-- D7 决策（2026-05-09）：identityLinks 必须同步锚定 memory，避免身份分裂。

ALTER TABLE memory_units ADD COLUMN canonical_user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_memory_canonical
  ON memory_units(agent_id, canonical_user_id)
  WHERE canonical_user_id IS NOT NULL;
