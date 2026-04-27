-- M13 cross-app cold-start 修复：prebake 上线打招呼去重表
--
-- 用途：每个 (chat, bot) 组合在 24h 内只发一次"上线打招呼"消息，
-- 避免 sidecar 频繁重启时群里被刷屏。
--
-- 设计权衡：
--   - 主键 (chat_id, account_id)：bot 在每个群独立去重；
--     同一 bot 加入多群每群各一次
--   - last_prebake_at 用 ISO 字符串方便人读 + 排序
--   - 不存"消息内容"——内容由 prebake 模块构造时决定，运行时变化
CREATE TABLE feishu_chat_prebakes (
  chat_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  last_prebake_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (chat_id, account_id)
);

CREATE INDEX idx_feishu_chat_prebakes_account ON feishu_chat_prebakes(account_id);
