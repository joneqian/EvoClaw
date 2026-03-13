import { sanitizeForExtraction } from './text-sanitizer.js';
import { buildExtractionPrompt } from './extraction-prompt.js';
import { parseExtractionResult } from './xml-parser.js';
import { MergeResolver } from './merge-resolver.js';
import { KnowledgeGraphStore } from './knowledge-graph.js';
import { ConversationLogger } from './conversation-logger.js';
import { MemoryStore } from './memory-store.js';
import type { ChatMessage } from '@evoclaw/shared';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';

/** LLM 调用函数签名：接收 system/user prompt，返回原始响应文本 */
export type LLMCallFn = (system: string, user: string) => Promise<string>;

/**
 * 记忆提取器 — 完整的记忆提取 Pipeline 编排器
 * 将预处理、LLM 调用、解析、持久化串联为一条完整流水线
 */
export class MemoryExtractor {
  private mergeResolver: MergeResolver;
  private knowledgeGraph: KnowledgeGraphStore;
  private conversationLogger: ConversationLogger;
  private memoryStore: MemoryStore;

  constructor(
    private db: SqliteStore,
    private llmCall: LLMCallFn,
  ) {
    this.memoryStore = new MemoryStore(db);
    this.mergeResolver = new MergeResolver(this.memoryStore);
    this.knowledgeGraph = new KnowledgeGraphStore(db);
    this.conversationLogger = new ConversationLogger(db);
  }

  /**
   * 完整的记忆提取 Pipeline
   * Stage 1: 预处理 (sanitize)
   * Stage 2: LLM 调用 (prompt → call → parse)
   * Stage 3: 持久化 (merge-resolver + knowledge_graph + conversation_log)
   */
  async extractAndPersist(messages: ChatMessage[], agentId: string, sessionKey?: string): Promise<{
    memoryIds: string[];
    relationCount: number;
    skipped: boolean;
  }> {
    // Stage 1: 预处理 — 过滤并清洗对话文本
    const conversationText = messages
      .filter(m => m.role === 'user' || m.role === 'assistant')
      .map(m => `[${m.role}]: ${m.content}`)
      .join('\n\n');

    const sanitized = sanitizeForExtraction(conversationText);
    if (!sanitized) {
      return { memoryIds: [], relationCount: 0, skipped: true };
    }

    // Stage 2: LLM 调用 — 构建提示词、调用模型、解析 XML 响应
    const { system, user } = buildExtractionPrompt(sanitized);
    const llmResponse = await this.llmCall(system, user);
    const result = parseExtractionResult(llmResponse);

    if (result.memories.length === 0 && result.relations.length === 0) {
      return { memoryIds: [], relationCount: 0, skipped: true };
    }

    // Stage 3: 持久化 — 合并/插入记忆单元、写入知识图谱、记录会话日志
    const memoryIds = this.mergeResolver.resolveAll(agentId, result.memories);

    // 写入知识图谱关系
    let relationCount = 0;
    for (const rel of result.relations) {
      this.knowledgeGraph.insertRelation({
        agentId,
        subjectId: rel.subject,
        predicate: rel.predicate,
        objectId: rel.object,
        confidence: rel.confidence,
      });
      relationCount++;
    }

    // 若提供 sessionKey 则记录会话日志
    if (sessionKey) {
      for (const msg of messages) {
        this.conversationLogger.log({
          id: crypto.randomUUID(),
          agentId,
          sessionKey,
          role: msg.role,
          content: msg.content,
          tokenCount: Math.ceil(msg.content.length / 4), // 粗略估算 token 数
        });
      }
    }

    return { memoryIds, relationCount, skipped: false };
  }
}
