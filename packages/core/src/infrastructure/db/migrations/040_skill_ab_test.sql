-- M7-Tier3 PR-T3-1a — Skill A-B 对照实验主表
--
-- 每次 Evolver refine 一个 skill 后启动一次 A-B 测试：
--   - variant A = 旧版本 hash（previous_hash）
--   - variant B = 新版本 hash（new_hash）
--   - status='active' 期内 invoke_skill 按 hash 桶位选 A/B 加载内容
--   - 测试期满（min_calls_per_variant 满足 或 max_test_days 到期）→ 跑 Mann-Whitney
--     检验 → status 进 'promoted' / 'rolled_back' / 'inconclusive'
--
-- 设计取舍（详见 docs/iteration-plans/M7-Tier3-Plan.md D2/D3/D6）：
--   - 桶位 = hash 确定性（同 sessionKey 同 variant，跨机一致）
--   - 检验 = Mann-Whitney U（手写无 SciPy 依赖）
--   - 阈值保守：success 退化 ≥10% 且 p<0.05 → rollback；提升 ≥5% 且 p<0.05 → promote

CREATE TABLE IF NOT EXISTS skill_ab_test (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  skill_name            TEXT NOT NULL,
  -- 触发本次 A-B 的 skill_evolution_log 行（refine 决策）
  evolution_log_id      INTEGER NOT NULL,
  -- 'active' | 'promoted' | 'rolled_back' | 'inconclusive'
  status                TEXT NOT NULL DEFAULT 'active',
  -- 旧版本 hash（A 桶加载）
  variant_a_hash        TEXT NOT NULL,
  -- 新版本 hash（B 桶加载，也是当前 SKILL.md 磁盘版本）
  variant_b_hash        TEXT NOT NULL,
  started_at            TEXT NOT NULL DEFAULT (datetime('now')),
  -- 测试结束时间（promoted/rolled_back/inconclusive 时填）
  ended_at              TEXT,
  -- 每变体最少调用次数才检验（默认 30）
  min_calls_per_variant INTEGER NOT NULL DEFAULT 30,
  -- 测试期上限（天）（默认 7）
  max_test_days         INTEGER NOT NULL DEFAULT 7,
  -- 'promoted: B success +12% p=0.02' / 'rolled_back: B duration +85%'
  decision_reason       TEXT,
  -- Mann-Whitney U 检验的 p 值（NULL 表示未检验或检验失败）
  p_value               REAL,
  -- B 对 A 的相对差（success rate diff，正数 = B 好）
  effect_size           REAL,
  FOREIGN KEY (evolution_log_id) REFERENCES skill_evolution_log(id)
);

-- 查 active 测试用（invoke_skill 入口高频访问，必须命中索引）
CREATE INDEX IF NOT EXISTS idx_skill_ab_test_active
  ON skill_ab_test(status, skill_name);

-- 按 skill 查历史 A-B（前端 EvolutionLogPanel 详情视图）
CREATE INDEX IF NOT EXISTS idx_skill_ab_test_skill
  ON skill_ab_test(skill_name);
