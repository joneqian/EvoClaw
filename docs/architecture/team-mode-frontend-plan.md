# Team Mode 前端待开发清单（Phase 2）

> **生效日期**: 2026-04-25
> **关联**: [M13-MultiAgentTeam-Plan.md](../iteration-plans/M13-MultiAgentTeam-Plan.md)
> **状态**: 本期（M13 MVP）后端只占位埋点，前端实际页面推到 Phase 2

## 为什么先不做前端

M13 MVP 把所有团队协作交互都放在飞书群里完成 — 用户在群里 @ Agent，看群消息卡片，发触发词命令。**桌面前端在群协作流程中本来就是观察者角色**，不是关键路径。

为节省 ~5-7 天前端工时，本期只做最小化的"占位 + 字段落库"，确保 Phase 2 前端开发可以无缝填实而不需返工后端。

---

## M13 本期已埋的钩子（Phase 2 开发依据）

### 钩子 1: 路由占位 `/plans`

**文件**: `apps/desktop/src/pages/PlansPage.tsx`

**M13 内容**:
```tsx
// TODO(team-mode/ui): Phase 2 实现项目看板页
export default function PlansPage() {
  return <div className="p-8 text-gray-500">Team Plans coming in Phase 2</div>;
}
```

**路由注册**: `apps/desktop/src/App.tsx`（或 router 入口）添加 `/plans` 路径绑定到 `PlansPage`。

**Phase 2 任务**: 把空壳填成真的看板页（详见下方 Item 1）。

### 钩子 2: `agents.role` 字段已落库

**Migration**: `030_task_plans.sql` 含 `ALTER TABLE agents ADD COLUMN role TEXT NOT NULL DEFAULT 'general';`

**后端读取**: `peer-roster-service` 取该字段填 `PeerBotInfo.role`；prompt 注入时拼入 Agent 自我介绍段。

**Phase 2 任务**: 在 `ExpertSettingsPanel.tsx` 加"角色"下拉（详见 Item 2）。后端 schema 不需要改。

### 钩子 3: Feature Flag 默认开启

**文件**: `packages/core/src/infrastructure/settings/defaults.ts`

```ts
team_mode: {
  enabled: true,           // 总开关
  loop_guard_enabled: true, // 回环防护开关
}
```

**用法**:
- Layer 2 入口检查 `team_mode.enabled`，false 时走旧单 Agent 路径
- 用户可手动改 settings.json 一键回退（应急用）

**Phase 2 任务**: 在桌面应用设置页加 UI 开关（详见 Item 4）。

### 钩子 4: TODO 注释标记

所有前端关联代码点标 `// TODO(team-mode/ui):` 注释，Phase 2 用 grep 一次性扫出来定位。

---

## Phase 2 前端待开发清单

按优先级排序，预计总工时 **5-7 天**。

### Item 1 · 项目看板页 `/plans`（必做，3-4 天）

**目标**: 用户在桌面应用里查看所有 active / completed plan 状态。

**功能**:
- **列表视图**：所有 plan，按 `created_at DESC`，可按 `group_session_key` 筛选
- **详情视图**：单个 plan 的 DAG 可视化（任务节点 + 依赖箭头）
  - 节点显示：标题、负责人头像、状态色（黄/红 stale_marker）
  - 节点点击展开：description / artifact 列表 / 状态历史
- **状态过滤**：active / paused / completed / cancelled
- **手动操作**：未来可加暂停 / 取消按钮（Phase 3，先用群命令）

**技术选型建议**:
- DAG 可视化：[react-flow](https://reactflow.dev/) 或 [dagre-d3](https://github.com/dagrejs/dagre-d3)
- 实时更新：sidecar 已有 SSE 推机制，复用即可

**API 需求**（M13 已存在）:
- GET `/team/plans?status=active&group=xxx`
- GET `/team/plans/:id` 含 tasks + artifacts
- WebSocket / SSE 订阅 plan 状态变化

### Item 2 · Agent 设置加"角色"下拉（必做，0.5 天）

**目标**: 用户创建 Agent 时显式选择角色（影响 prompt + peer roster 展示）。

**位置**: `apps/desktop/src/components/ExpertSettingsPanel.tsx`

**UI**:
- 角色下拉，options：`项目经理 (pm)` / `后端工程师 (backend)` / `产品经理 (product)` / `UI 设计师 (design)` / `通用 (general)` / `自定义`
- 选"自定义"展开文本框，让用户写 role 字符串（如 "技术总监"）
- 保存时写入 `agents.role` 字段

**注意**:
- **不做 tool gating**（用户存过 feedback：不预设特权角色）
- 仅作 prompt 提示和 roster 展示

### Item 3 · Artifact 预览（推荐，1.5-2 天）

**目标**: 用户在桌面应用里直接看 plan 产出的中间文档 / 图片，不必跳到飞书。

**功能**:
- 在 plan 详情页底部 / 侧边栏显示所有 artifact
- 按 kind 渲染：
  - `text` / `markdown`：内联展开（markdown-it 渲染）
  - `image`：缩略图 + 点击大图（复用 image vision 工具的下载机制）
  - `file`：下载按钮（飞书 file_token 用 doc-api 下载）
  - `doc`：跳转到飞书云文档（外部浏览器）
  - `link`：跳转

**API**: 复用 `fetch_artifact` builtin tool 的 HTTP endpoint。

### Item 4 · Team Mode 总开关 UI（可选，0.5 天）

**目标**: 应用设置页可视化开关 `team_mode.enabled` 和 `team_mode.loop_guard_enabled`，避免用户改 JSON。

**位置**: 已有 settings 页面，加一个"团队模式"分组。

**功能**:
- 开关 1：`启用团队模式`（默认 on）
- 开关 2：`启用回环防护`（默认 on，关闭后会有警告 banner "调试用，生产环境必须开启"）

### Item 5 · 团队成员侧栏（可选，1 天）

**目标**: 在群聊页面侧栏显示当前群的 peer roster，让用户直观看到"现在群里有哪些 EvoClaw bot"。

**功能**:
- 实时显示 PeerBotInfo 列表
- 每个 peer 卡片：头像、名字、emoji、role、capability
- 点击展开看完整 IDENTITY.md / SOUL.md 摘要
- 标识 active 状态（绿点）

---

## 不在 Phase 2 范围

- **审计 / 时间线视图**：plan 全量变更历史（Phase 3，配合 audit_log 接入）
- **成本预算监控 UI**：per-plan token / cost 仪表盘（Phase 3，配合预算系统）
- **跨群协作视图**：多群联动 plan 的全局视图（Phase 3+）
- **Agent 印象 / 协作历史**：基于 memory_units 的"和阿辉合作过 N 次"展示（Phase 3+）
- **桌面端发起 / 介入 plan**：用户从桌面 UI 创建 plan、暂停 / 改派任务（Phase 3，需配套权限模型）

---

## 开发顺序建议

Phase 2 拆分两个 PR：

| PR | 范围 | 工时 |
|---|---|---|
| **Phase2-PR1** | Item 1（项目看板页）+ Item 2（角色下拉）+ Item 4（总开关） | 4 天 |
| **Phase2-PR2** | Item 3（artifact 预览）+ Item 5（团队成员侧栏） | 2-3 天 |

---

## 与现有前端的集成点

- `apps/desktop/src/App.tsx` 路由注册
- `apps/desktop/src/pages/PlansPage.tsx`（M13 占位 → Phase 2 填实）
- `apps/desktop/src/components/ExpertSettingsPanel.tsx`（M13 不动 → Phase 2 加角色下拉）
- 应用设置页（路径待确认 → Phase 2 加 team_mode 分组）
- 现有 SSE / WebSocket 通道（不改，新增 `/team/*` topic）

---

## API Contract（M13 后端已实现）

Phase 2 前端可直接调用：

| Endpoint | M13 状态 |
|---|---|
| `GET /team/plans` | 计划本期实现（list_tasks 工具 + 包装路由）|
| `GET /team/plans/:id` | 同上 |
| `GET /team/artifacts/:id?mode=summary\|full` | 同上（fetch_artifact 工具包装）|
| `POST /team/plans/:id/pause` | 推迟 Phase 3（MVP 用群触发词）|
| WebSocket `/team/plans/:id/events` | 推迟 Phase 2（M13 暂用现有 SSE 通道，加 plan 事件类型）|
