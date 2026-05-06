-- M13 #3: 同事印象记忆 (Peer Impression Memory)
-- 为复用 memory_units 表存储 peer 印象（category='entity', merge_key='peer:{agentId}'）增加专用索引，
-- 加速按 owner+peer 的 by-mergeKey 查询。不新建主表，复用 entity merge 语义。

CREATE INDEX IF NOT EXISTS idx_memory_units_peer_entity
  ON memory_units(agent_id, merge_key)
  WHERE category = 'entity'
    AND merge_key LIKE 'peer:%'
    AND archived_at IS NULL;
