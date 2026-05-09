-- M13 Phase 1 PR-1B — identityLinks 跨渠道员工身份聚合
--
-- 业务场景：员工在飞书 ou_xxx / 企微 userid_yyy / 微信 wxid_zzz，三个不同 ID
-- 实际是同一员工。本表让 EvoClaw 把它们聚合到 canonical_id（如 'self'），
-- 让 Agent 在跨渠道时识别员工是同一人。
--
-- 用法：
--   - SettingsPage UI 让员工自助绑定（"飞书 ou_xxx 是我"）
--   - generateSessionKey 在拼 sessionKey 前查 identity_links → 命中替换 peerId
--     为 canonical_id（让 sessionKey 跨渠道合并）
--   - memory_extractor 提取记忆时填 canonical_user_id（详见 migration 046）
--
-- 桌面应用单租户特性：每员工本地 app 通常只有 1 个 canonical（自己），
-- identity_links 表行数一般 1-3 行。
--
-- 取舍：
--   - UNIQUE(channel, peer_id) 防同一渠道 ID 多 canonical（一对一映射）
--   - canonical_id 可任意字符串（不强约束 'self'）
--   - 不存 channel 是否启用（员工创建 binding 时已隐含启用）

CREATE TABLE IF NOT EXISTS identity_links (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  canonical_id  TEXT NOT NULL,
  channel       TEXT NOT NULL,
  peer_id       TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(channel, peer_id)
);

CREATE INDEX IF NOT EXISTS idx_identity_links_canonical ON identity_links(canonical_id);
CREATE INDEX IF NOT EXISTS idx_identity_links_lookup ON identity_links(channel, peer_id);
