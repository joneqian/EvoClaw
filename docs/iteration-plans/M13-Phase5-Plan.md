# M13 Phase 5 — 飞书文档 agent 协作闭环（5-7 工作日）

> **状态**：2026-05-09 通过用户确认 → 起 PR `feat/m13-phase5-feishu-doc-agent-loop`

## 0. 现状盘点（关键发现）

经实地探查，**Phase 5 多数底层能力已在 M11.1 PR6 + 后续工作里完成**：

| 能力 | 状态 |
|---|---|
| `drive.notice.comment_add_v1` 事件 hook | ✅ |
| 4 个 doc 编辑工具（read/replace/delete/append + 乐观锁） | ✅ |
| 3 个评论工具（reply / add_whole / list_replies） | ✅ |
| `ChannelMessage.feishuDoc` 字段（FeishuDocContext） | ✅ |
| `FEISHU_DOC_COLLAB_PROMPT` agent 系统提示 | ✅ |
| doc-api 完整链路（含 230108/230109 错误码） | ✅ |

## 1. 真实 Gap

### Gap 1（最关键）— `feishuDoc` 字段未被 channel-message-handler 消费
event-handler 唯一写入点，handler 0 处消费。LLM 看不到结构化 `fileToken`，agent 无法主动调 doc 工具。

**修复**：handler 检测到 `feishuDoc` 时，前缀注入 `<feishu_doc_context>` XML 块。

### Gap 2 — Comment timeline 不预加载
agent 看不到 thread 内其他人的回复。修复：调 `listCommentReplies` 拉最近 5 条 → `<comment_timeline>` 块。

### Gap 3 — 没有"已读"反馈
飞书 reaction API 仅对 IM message 有效，对 comment 不适用。**v1 不做**（PR-T3-2a 节奏，避免过度工程）。

### Gap 4 — sessionKey 是否要细化到 commentId
当前 peerId 是 `feishu_doc_${fileToken}`，doc 级隔离已足。**默认不细化**（同 doc 多 thread 共享上下文反而有用）。

## 2. 实施

单 PR：`feat/m13-phase5-feishu-doc-agent-loop`

| Step | 文件 | 变更 |
|---|---|---|
| 1 | `feishu/inbound/doc-context-builder.ts` | 新模块 — buildFeishuDocContextPrefix 拼 XML |
| 2 | `routes/channel-message-handler.ts` | ChannelMessageContext 加 feishuDoc 字段；handler 检测到时注入 prefix |
| 3 | `server.ts` | 2 处 handleChannelMessage 调用转发 msg.feishuDoc |
| 4 | `__tests__/feishu/doc-context-builder.test.ts` | 10 条 unit test |

## 3. 决策点

| 编号 | 议题 | 选择 |
|---|---|---|
| D5.1 | 预加载文档全文 vs 按需读 | 按需读（避免 token 爆炸） |
| D5.2 | 占位回复 vs reaction | **v1 不做**（飞书 comment 无 reaction API） |
| D5.3 | timeline 默认条数 | 5 条 |
| D5.4 | sessionKey 细化到 commentId | 不细化 |
| D5.5 | builder 失败兜底 | silent fallback（最小 context block） |

## 4. 不在本 PR 范围

- ❌ 占位回复 + 完成更新（飞书无 update_comment_reply API；未来如果加再做）
- ❌ 跨文档 cross-link
- ❌ sheet / file / slides 编辑（v1 仅 docx）
- ❌ comment thread 自动总结
