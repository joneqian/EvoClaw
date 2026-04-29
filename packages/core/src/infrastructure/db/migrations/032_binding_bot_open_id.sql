-- bindings 表加 bot_open_id 列（M13 多 Agent 团队协作 @ 死锁修复）
--
-- 背景：多 bot 群聊里 PM 想 mention_peer @ 产品经理时，需要产品经理 bot 自身的 open_id
-- 才能渲染真·飞书 `<at user_id="ou_xxx"/>` 元素触发推送。FeishuPeerBotRegistry 走被动
-- 学习——只有当目标 bot 自己在群里发过言时才记得 open_id。冷启动场景下永远学不到，
-- 退化为纯文本 "@产品经理"，飞书不识别 → 产品经理 bot 不会被触发 → 死锁。
--
-- 此处把 bot 自身 open_id 在 connect 时（adapter 拉到 /open-apis/bot/v3/info）回填到
-- binding 行，listInChat 可用 binding.bot_open_id 兜底，绕过 registry 冷启动。
ALTER TABLE bindings ADD COLUMN bot_open_id TEXT;
