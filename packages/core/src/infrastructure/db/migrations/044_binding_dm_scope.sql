-- M13 Phase 1 PR-1A — bindings 加 dm_scope 列
--
-- D3 决策（2026-05-09）：DM 默认跨渠道连贯（dm_scope='main'）— 同一 Agent 在飞书/
-- 企微/微信 DM 共享 mainSessionKey（agent:{id}:main），让 Agent 有"全局视角"。
-- 员工可在 BindingsPage 改 dm_scope='per-peer' 显式隔离。
--
-- 取值（与 routing/session-key.ts DmScope 对齐）：
--   'main'                       → agent:{id}:main（默认，跨渠道连贯）
--   'per-peer'                   → agent:{id}:direct:{peer}（每对话独立）
--   'per-channel-peer'           → agent:{id}:{ch}:direct:{peer}（PR-1A 之前的等价行为）
--   'per-account-channel-peer'   → agent:{id}:{ch}:{acc}:direct:{peer}（最细）
--
-- NULL 表示未配置，channel-message-handler 用 DEFAULT_DM_SCOPE='main' fallback。

ALTER TABLE bindings ADD COLUMN dm_scope TEXT;
