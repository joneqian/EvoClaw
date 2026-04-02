/**
 * 会话摘要器 — 维护周期性会话级 Markdown 笔记
 *
 * 独立于 Kernel 上下文压缩，用于会话回顾和恢复。
 */

import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { ChatMessage } from '@evoclaw/shared';
import type { LLMCallFn } from './memory-extractor.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('session-summarizer');

export class SessionSummarizer {
  constructor(
    private db: SqliteStore,
    private llmCall: LLMCallFn,
  ) {}

  /** 生成或增量更新会话摘要 */
  async summarize(
    agentId: string,
    sessionKey: string,
    messages: ChatMessage[],
    existingSummary?: string,
  ): Promise<string> {
    const conversation = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `[${m.role}]: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
      .join('\n\n');

    const system = `你是一个会话摘要引擎。你的任务是为 AI Agent 的对话生成简洁的 Markdown 摘要笔记。

## 摘要要求
- 使用 Markdown 格式
- 按话题分段，每段 2-3 句话
- 记录关键决策、任务进展、待办事项
- 不记录闲聊和礼貌用语
- 中文撰写
- 总长度控制在 500 字以内`;

    let userPrompt: string;
    if (existingSummary) {
      userPrompt = `以下是之前的会话摘要：

${existingSummary}

以下是新增的对话内容：

<conversation>
${conversation}
</conversation>

请在之前摘要的基础上，整合新增对话的关键信息，生成更新后的摘要。直接输出 Markdown 摘要，不要前言。`;
    } else {
      userPrompt = `请为以下对话生成摘要笔记：

<conversation>
${conversation}
</conversation>

直接输出 Markdown 摘要，不要前言。`;
    }

    try {
      const summary = await this.llmCall(system, userPrompt);
      this.save(agentId, sessionKey, summary, messages.length, 0, 0);
      log.info(`会话摘要${existingSummary ? '更新' : '生成'}: agent=${agentId}, session=${sessionKey.slice(0, 40)}`);
      return summary;
    } catch (err) {
      log.error(`会话摘要失败: ${err instanceof Error ? err.message : String(err)}`);
      return existingSummary ?? '';
    }
  }

  /** 读取已有摘要 */
  getExisting(agentId: string, sessionKey: string): string | null {
    const row = this.db.get<{ summary_markdown: string }>(
      `SELECT summary_markdown FROM session_summaries WHERE agent_id = ? AND session_key = ?`,
      agentId, sessionKey,
    );
    return row?.summary_markdown ?? null;
  }

  /** 保存摘要（UPSERT） */
  save(
    agentId: string,
    sessionKey: string,
    summary: string,
    tokenCount: number,
    turnCount: number,
    toolCallCount: number,
  ): void {
    const now = new Date().toISOString();
    const existing = this.db.get<{ id: string }>(
      `SELECT id FROM session_summaries WHERE agent_id = ? AND session_key = ?`,
      agentId, sessionKey,
    );

    if (existing) {
      this.db.run(
        `UPDATE session_summaries SET summary_markdown = ?, token_count_at = ?, turn_count_at = ?, tool_call_count_at = ?, updated_at = ? WHERE id = ?`,
        summary, tokenCount, turnCount, toolCallCount, now, existing.id,
      );
    } else {
      this.db.run(
        `INSERT INTO session_summaries (id, agent_id, session_key, summary_markdown, token_count_at, turn_count_at, tool_call_count_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        crypto.randomUUID(), agentId, sessionKey, summary, tokenCount, turnCount, toolCallCount, now, now,
      );
    }
  }
}
