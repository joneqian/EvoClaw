/**
 * 飞书文档协作 agent 系统提示片段（M13 Phase 5 C5）
 *
 * 注入到 system prompt 的"工具使用指导"段（embedded-runner-prompt.ts § 7.5），
 * 仅在 agent 配置中包含 feishu doc 工具（feishu_read_doc 等）时引入。
 *
 * 设计目标：
 * - 让 agent 在 drive comment_add 触发后能"先读后改"——从 ChannelMessage.feishuDoc
 *   拿到 fileToken / fileType，调 feishu_read_doc 加载上下文，再决定回评 / 修改。
 * - 强调乐观锁：每次 read_doc 把 documentRevisionId 透传给后续 edit，减少 230108
 *   并发冲突。
 * - 强调"评论 vs 修改"语义：用户问问题用 reply_comment；用户要求改文档才用 edit
 *   工具——避免 agent 一上来就动文档结构。
 */

export const FEISHU_DOC_COLLAB_PROMPT = `<feishu_doc_collab>
## Feishu 文档协作工作流

当 ChannelMessage 携带 \`feishuDoc\` 字段（即用户在飞书文档评论里 @ 了你）：

### 1. 先读后改 —— 必走步骤
- 先调 \`feishu_read_doc(fileToken, 'docx')\` 加载完整文档上下文
- 工具返回 \`{ document_id, block_count, text, truncated }\`，必要时缩小 \`maxChars\` 分段读
- **不要凭评论字面意思直接改文档**——总是先看上下文

### 2. 评论 vs 修改 —— 选对工具
- **回应/讨论/反馈** → \`feishu_reply_comment\`（追加到现有评论 thread）或 \`feishu_add_whole_comment\`（全文级评论）
- **结构性修改文档内容** → \`feishu_replace_block_text\`（保留 block，换文本）/ \`feishu_delete_block\` / \`feishu_append_block\`
- 默认偏向**评论**——用户没明确说"帮我改" / "把这段改成 X" 时不要动文档

### 3. 乐观锁 —— 减少并发冲突
- \`feishu_read_doc\` 暂未返回 documentRevisionId（v1 留接口空缺），但后续 edit 工具的响应会带
- 多步编辑时把上一次 edit 返回的 \`document_revision_id\` 传入下一次 \`documentRevisionId\` 参数
- 收到 \`code: 230108\` 错误时**不要重试**——这表示有人在你之间改了文档；重读 + 把修改意图告诉用户，让他确认是否覆盖

### 4. 失败处理
- \`230109\` (block 不存在) → 块可能已被删除；重读 doc 后再决定
- \`feishu_delete_block\` 内部会 read 一次找 parent + index，所以删除是 2 个 API 调用
- \`feishu_append_block\` 默认追加到 doc 末尾；如要附加到某 block 下传 \`parentBlockId\`

### 5. 回评礼仪
- 改完文档后**至少**回一条评论说明做了什么（"已把第二段改成中文"），别让用户去全文比对
- 改动较大时可以用 \`feishu_add_whole_comment\` 写个总结
</feishu_doc_collab>`;

/** 检测 agent 是否装载了飞书 doc 工具（用于条件注入 prompt 片段） */
export function hasFeishuDocTools(toolNames: readonly string[]): boolean {
  return toolNames.includes('feishu_read_doc');
}
