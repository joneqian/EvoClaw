# HealthClaw — 自我进化端到端验证 Runbook

> 验证目标：**P1-B Skill Inline Review** 闭环（信号检测 → 异步触发 → LLM 决策 refine/keep/disable → 写 skill_evolution_log → diff 可见）。
>
> 这是 4 条自我进化主线里**反馈最快**的一条（5 min 限速窗 vs Cron Evolver 6h），适合做端到端冒烟。

---

## 一、前置条件

1. **HealthClaw sidecar 已运行**
   ```bash
   BRAND=healthclaw pnpm dev:core      # 仅 sidecar（推荐，输出干净）
   # 或
   pnpm dev:healthclaw                  # 完整 Tauri 应用（前端 + sidecar）
   ```
   sidecar 启动后 stdout 首行会打印 `{ "port": 49152, "token": "..." }`，复制下来。

2. **LLM Provider 已配置**
   - 主 provider（用户对话用）：在 HealthClaw 应用 Settings → Providers 加一个 active provider
   - Secondary provider（evolver 用）：默认沿用主 provider；若想单独配置见 `config.security.skillEvolver.model`

3. **至少 1 个 active agent 存在**（后续手动用它对话触发 skill）

---

## 二、运行验证脚本

```bash
PORT=49152 TOKEN=<复制来的 token> ./scripts/validate-self-evolution.sh
# 或
./scripts/validate-self-evolution.sh --port 49152 --token <token>
```

**默认 BRAND=healthclaw**。要切别的品牌：`BRAND=evoclaw ...`。

脚本会：

1. ✅ 探活 `/readyz`、验 token
2. ✅ 在 `~/.healthclaw/skills/validate-healthclaw-<ts>/SKILL.md` 种入一个故意写得粗糙的 fixture skill
3. ✅ 读取 7 天内 inline review baseline 计数
4. **打印手动触发指引**（重点：这步要你接手）
5. ⏳ 每 5s 轮询 `/skill-evolution/log?skill=<fixture>`，最多等 5 min
6. 命中后拉详情 + 打印 `decision / 内容是否变 / before-after 长度`
7. 退出前自动 `rm -rf` 清理 fixture

退出码：`0` 成功 / `1` 超时 / `2` 前置失败。

---

## 三、第 4 步：手动触发（脚本运行中操作）

脚本会停在轮询界面。同时去 HealthClaw 应用：

### ① 让 Agent 调用 fixture skill

用任意 active agent 起一段对话，例如：

```
请用 validate-healthclaw-<ts> skill 帮我处理一下：你好
```

> 如果 LLM 没主动调，**直接说**："请调用 invoke_skill 工具，name=validate-healthclaw-<ts>" — 强制触发。

观察 Agent 完成本轮回复（脚本会通过 skill_usage 表知道这次调用）。

### ② 5 分钟内回一句负反馈

紧接着回一句负反馈，命中 `feedback-signal-detector` 的 ZH 模式：

| 触发样本（任选） |
|---|
| 这工具不对 |
| 这个 skill 又错了 |
| 再来一次还是错的 |
| 这玩意儿没用 |
| 别用它了 |

**关键**：不要再调用任何 skill，仅说一句反馈即可。

### ③ 等脚本观察

回到脚本终端，看是否抓到：

```
✅ 命中！抓到 inline review 记录
📋 最新 inline review (id=...):
{
  "decision": "refine",
  "reasoning": "...",
  "previousLen": 234,
  "newLen": 487,
  "contentChanged": true
}
🎯 decision=refine，且 SKILL.md 内容真发生变化 — 自我进化通路 OK
```

---

## 四、超时不出怎么办

脚本退出码 1 + 提示。手动 debug：

```bash
# 1. 看 sidecar 日志（路径来自 brand.json -> dataDir）
tail -f ~/.healthclaw/logs/core.log | grep -E '\[inline-review|skill-evolver|peer-impression\]'

# 关键事件：
# [inline-review-signal-hit] skill=... pattern=...    ← 信号检测命中
# [skill-evolver] decision=refine ...                 ← LLM 给出决策
# [skill-evolver-error] ...                           ← evolver 失败
```

**常见失败原因**：

| 现象 | 原因 | 修复 |
|---|---|---|
| 没有 `[inline-review-signal-hit]` | 信号检测没命中 | 用更直白的负反馈样本 |
| 命中但没 `[skill-evolver]` | 限速 / 防递归阻断（10 min 同 skill 内不重复） | 等 10 min 或换 fixture name |
| evolver 报错 | secondary LLM 没配 / API key 失效 | 检查 `config.security.skillEvolver.model` + 主 provider |
| 触发了但 decision=keep | LLM 评估后觉得没必要改 | 把 fixture skill 写得更糟（明显反讽 / 错别字 / 自相矛盾） |

---

## 五、其他自我进化主线的验证入口

| 主线 | 入口 | 触发周期 |
|---|---|---|
| **Skill Inline Review (P1-B)** | 本 runbook | 5 min |
| Skill Cron Evolver (M7) | `config.security.skillEvolver.cronSchedule` 默认 `0 0 */6 * * *` | 6 h |
| Memory L0/L1/L2 + AutoDream | 多轮对话即可 / 24h 后跑 consolidator | 实时 + 24h |
| Peer Impression (M13 #3) | 同群 2 个 Agent peer @ 互动 → `GET /peer-impressions?agentId=X` | 实时（10min 限速） |

后三条想验证可同样套这个 fixture + REST 观察的模式做。
