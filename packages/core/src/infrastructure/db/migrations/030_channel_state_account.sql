-- Channel 多账号支持：channel_state 主键扩展为 (channel, account_id, key)
--
-- 动机：允许同一渠道（如飞书）挂多个独立应用凭据 + 独立 WS 长连接，
-- 每个 Agent 可以绑不同应用实现"独立机器人头像"的 Team 语义。
--
-- 老数据 account_id 暂填 ''，启动时由 recoverChannels 读 credentials.appId
-- 回写真实 accountId 并删除空值行（幂等的一次性数据修复）。
--
-- SQLite 无 ALTER TABLE ADD PRIMARY KEY，用"建新表 → 复制 → drop → rename"套路。

CREATE TABLE channel_state_new (
  channel TEXT NOT NULL,
  account_id TEXT NOT NULL DEFAULT '',
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (channel, account_id, key)
);

INSERT INTO channel_state_new (channel, account_id, key, value, updated_at)
  SELECT channel, '', key, value, updated_at FROM channel_state;

DROP TABLE channel_state;

ALTER TABLE channel_state_new RENAME TO channel_state;
