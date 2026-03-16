/**
 * 记忆扩展 — PI 框架与记忆系统的桥接层
 * 提供 Agent 生命周期钩子，在对话前后自动执行记忆操作
 */

import { MemoryExtractor, type LLMCallFn } from '../memory/memory-extractor.js';
import { UserMdRenderer } from '../memory/user-md-renderer.js';
import { HybridSearcher } from '../memory/hybrid-searcher.js';
import { ConversationLogger } from '../memory/conversation-logger.js';
import { FtsStore } from '../infrastructure/db/fts-store.js';
import { VectorStore } from '../infrastructure/db/vector-store.js';
import { KnowledgeGraphStore } from '../memory/knowledge-graph.js';
import { MemoryStore } from '../memory/memory-store.js';
import { wrapMemoryContext } from '../memory/text-sanitizer.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { ChatMessage } from '@evoclaw/shared';
import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('MemoryExtension');

export class MemoryExtension {
  private extractor: MemoryExtractor;
  private renderer: UserMdRenderer;
  private searcher: HybridSearcher;
  private logger: ConversationLogger;

  constructor(
    private db: SqliteStore,
    private llmCall: LLMCallFn,
  ) {
    this.extractor = new MemoryExtractor(db, llmCall);
    this.renderer = new UserMdRenderer(db);
    const fts = new FtsStore(db);
    const vec = new VectorStore();
    const kg = new KnowledgeGraphStore(db);
    const ms = new MemoryStore(db);
    this.searcher = new HybridSearcher(fts, vec, kg, ms);
    this.logger = new ConversationLogger(db);
  }

  /**
   * before_agent_start 钩子
   * 1. 渲染 USER.md / MEMORY.md → 写入工作区
   * 2. 返回记忆上下文供注入 system prompt
   */
  async beforeAgentStart(agentId: string, workspacePath: string): Promise<string> {
    // 渲染 USER.md
    const userMd = this.renderer.renderUserMd(agentId);
    const userMdPath = path.join(workspacePath, 'USER.md');
    fs.writeFileSync(userMdPath, userMd, 'utf-8');

    // 渲染 MEMORY.md
    const memoryMd = this.renderer.renderMemoryMd(agentId);
    const memoryMdPath = path.join(workspacePath, 'MEMORY.md');
    fs.writeFileSync(memoryMdPath, memoryMd, 'utf-8');

    return userMd + '\n\n' + memoryMd;
  }

  /**
   * before_turn 钩子
   * 从用户最新消息检索相关记忆，返回包裹标记的记忆上下文
   */
  async beforeTurn(agentId: string, lastUserMessage: string): Promise<string> {
    const results = await this.searcher.hybridSearch(lastUserMessage, agentId, { limit: 10 });
    if (results.length === 0) return '';

    const memoryBlock = results.map(r => {
      return `- [${r.category}] ${r.l0Index}\n  ${r.l1Overview}`;
    }).join('\n');

    return wrapMemoryContext(`## 相关记忆\n${memoryBlock}`);
  }

  /**
   * agent_end 钩子
   * 触发记忆提取 Pipeline
   */
  async afterAgentEnd(messages: ChatMessage[], agentId: string, sessionKey?: string): Promise<void> {
    try {
      await this.extractor.extractAndPersist(messages, agentId, sessionKey);
    } catch (err) {
      log.error('记忆提取失败:', err);
    }
  }

  /**
   * tool_result_persist 钩子
   * 记录工具执行到 conversation_log
   */
  logToolResult(agentId: string, sessionKey: string, toolName: string, input: string, output: string): void {
    this.logger.log({
      id: crypto.randomUUID(),
      agentId,
      sessionKey,
      role: 'tool',
      content: `Tool: ${toolName}`,
      toolName,
      toolInput: input,
      toolOutput: output,
      tokenCount: Math.ceil((input.length + output.length) / 4),
    });
  }

  /**
   * session_before_compact 钩子
   * Pre-compaction Memory Flush — 在压缩前提取未处理的消息
   */
  async beforeCompact(agentId: string, sessionKey: string): Promise<void> {
    const pending = this.logger.getPendingMessages(agentId, sessionKey);
    if (pending.length === 0) return;

    // 将未处理的消息转换为 ChatMessage 格式
    const messages: ChatMessage[] = pending.map(p => ({
      id: p.id,
      conversationId: '',
      role: p.role,
      content: p.content,
      createdAt: new Date().toISOString(),
    }));

    await this.extractor.extractAndPersist(messages, agentId, sessionKey);
  }
}
