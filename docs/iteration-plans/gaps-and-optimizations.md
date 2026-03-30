# EvoClaw 差距补齐与优化清单

> 来源：EvoClaw vs Claude Code & OpenClaw 对比分析
> 更新日期：2026-03-29

---

## 🔴 关键差距（必须补齐）

### 1. TodoWrite 约束工具

**现状**：EvoClaw 没有结构化的任务追踪工具，Agent 依赖自觉用 write 写计划，复杂任务时容易遗忘或偏离目标。

**Claude Code 做法**：
- 专用 `TodoWrite` 工具，参数为 `{ tasks: [{id, description, status}] }`
- 约束规则：最多 20 项，同时仅 1 个 `in_progress`
- 连续 3 轮 Agent 未调用 TodoWrite 时，系统自动注入提醒消息
- 当前 todo 状态注入到 system prompt 中

**影响**：这是 Claude Code 在 SWE-bench 测试中从 42% 提升到 78% 的关键因素之一。

**实现方案**：
1. 新增 `todo_write` 工具，注册到工具注入流程
2. 存储在 Agent workspace 的 `TODO.json` 文件中
3. 在 `embedded-runner-prompt.ts` 的 system prompt 中注入当前 todo 状态
4. 在 `embedded-runner-attempt.ts` 中加入轮次计数器，3 轮未调用时注入提醒

**涉及文件**：
- `packages/core/src/tools/todo-tool.ts` — 新增
- `packages/core/src/agent/embedded-runner-prompt.ts` — 注入 todo 状态
- `packages/core/src/agent/embedded-runner-attempt.ts` — 轮次提醒
- `packages/core/src/routes/chat.ts` — 工具注册

**预估工期**：3 天

---

### 2. Heartbeat 零污染回滚

**现状**：Heartbeat 轮次无论 Agent 是否有事做，都会留在对话历史中，长期累积污染上下文、增加 token 消耗。

**OpenClaw 做法**：
- Agent 回答 `HEARTBEAT_OK` 或 `NO_REPLY` 时，截断并回滚这轮 transcript
- 恢复时间戳，就好像这一轮从未发生过
- 不浪费一次 API 调用，不污染一丝上下文

**影响**：长期运行的 Agent 上下文持续膨胀，心跳频率越高浪费越大。

**实现方案**：
1. 在 Heartbeat 运行后检测响应内容
2. 如果响应为 `HEARTBEAT_OK` / `NO_REPLY` / 空内容：
   - 从 PI session 的 messages 中移除这轮 user + assistant 消息
   - 不写入 `conversation_log` 表
   - 不触发 `conversations-changed` 事件
3. 如果响应有实际内容，正常保留

**涉及文件**：
- `packages/core/src/routes/chat.ts` — Heartbeat 会话处理逻辑
- `packages/core/src/agent/embedded-runner-attempt.ts` — 消息回滚

**预估工期**：2 天

---

## 🟡 部分对齐（需优化）

### 3. Heartbeat 间隔门控

**现状**：有 quiet hours（23:00-08:00）和 HEARTBEAT.md 非空检查，但缺少「距离上次执行够久」的间隔检查，可能频繁触发浪费 token。

**OpenClaw 做法**：4 道门控检查依次通过才触发 Agent Turn：
1. HEARTBEAT.md 存在？
2. 文件非空？
3. 距上次执行间隔够久？
4. 在活跃时段内？

**实现方案**：
1. 在 Heartbeat 调度器中记录 `lastHeartbeatAt` 时间戳
2. 触发前检查 `Date.now() - lastHeartbeatAt >= minIntervalMs`（默认 5 分钟）
3. 可在 Agent 配置中自定义间隔

**涉及文件**：
- Heartbeat 调度器（待确认具体文件位置）

**预估工期**：0.5 天

---

## 🔧 已识别的其他优化项

### 4. 工具调用卡片样式优化

**现状**：工具调用交错显示已实现（segments），但卡片样式与 EasyClaw 截图效果差距较大。

**优化方向**：
- 卡片更低调（减少边框和背景色）
- 结果区域默认折叠，点击展开
- 工具名称 + 参数摘要 + 状态指示器对齐

**预估工期**：1 天

---

### 5. Bundled Skills 路径问题

**现状**：Tauri sidecar 通过 `_up_` 虚拟目录运行，`seedBundledSkills()` 的路径查找在某些情况下无法定位到 bundled 目录。

**优化方向**：
- 在 `build.ts` 构建时将 bundled skills 复制到 `dist/skill/bundled/`
- 运行时优先从 `dist/` 查找，dev 模式回退到 `src/`

**预估工期**：0.5 天

---

### 6. 设置页面 UI 优化

**现状**：环境变量管理页面功能完整但留白过多，视觉不够精致。

**优化方向**：
- 全宽布局（已改）
- 分组预设样式优化
- 添加已配置变量的快速测试功能

**预估工期**：1 天

---

## 📊 优先级排序

| 优先级 | 项目 | 类型 | 工期 | 价值 |
|:---:|------|------|:---:|------|
| P0 | Heartbeat 零污染回滚 | 🔴 差距 | 2 天 | 消除上下文污染和 token 浪费 |
| P1 | TodoWrite 约束工具 | 🔴 差距 | 3 天 | 复杂任务成功率关键提升 |
| P2 | Heartbeat 间隔门控 | 🟡 优化 | 0.5 天 | 防频繁触发，节省 API 成本 |
| P3 | Bundled Skills 路径修复 | 🔧 修复 | 0.5 天 | 首次安装体验 |
| P4 | 工具调用卡片样式 | 🔧 优化 | 1 天 | 用户体验 |
| P5 | 设置页面 UI | 🔧 优化 | 1 天 | 用户体验 |

**总计**：约 8 天
