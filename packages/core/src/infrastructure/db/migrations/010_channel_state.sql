-- 通道适配器持久化状态 (通用 KV 存储)
-- 微信渠道用于存储长轮询游标 (get_updates_buf)，未来其他渠道也可复用
CREATE TABLE IF NOT EXISTS channel_state (
  channel TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (channel, key)
);
