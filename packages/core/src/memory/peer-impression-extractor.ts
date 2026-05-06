/**
 * 同事印象记忆提取器（M13 #3）
 *
 * 从 Agent A 的视角，提取它对同事 Agent B 的协作印象，写入 entity 类记忆。
 * 复用 memory_units 表，约束：
 *   - category = 'entity'
 *   - merge_key = `peer:${peerAgentId}`
 *   - agent_id  = ownerAgentId（owner 视角，单向）
 *
 * 与通用 memory-extractor 区别：
 *   - 输入是结构化的 (owner, peer, recentMessages, existingImpression)
 *   - 输出固定 schema（PeerImpressionL1 + l0Summary），用 Zod 验证
 *   - 不写 conversation_log（已由 chat.ts 负责）
 */

import { z } from 'zod';
import crypto from 'node:crypto';
import type { ChatMessage, MemoryUnit, PeerImpressionL1 } from '@evoclaw/shared';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { VectorStore } from '../infrastructure/db/vector-store.js';
import { MemoryStore } from './memory-store.js';
import { KnowledgeGraphStore } from './knowledge-graph.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('peer-impression');

/** LLM 调用函数签名（与 memory-extractor 一致） */
export type LLMCallFn = (system: string, user: string) => Promise<string>;

/** 单条消息提取上下文（避免直接依赖 ChatMessage 全字段） */
export interface PeerImpressionMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
}

export interface PeerImpressionExtractInput {
  ownerAgentId: string;
  ownerAgentName?: string;
  peerAgentId: string;
  peerAgentName?: string;
  /** 最近若干消息（建议 20-40 条，调用方自行截断） */
  recentMessages: PeerImpressionMessage[];
  /** 当前所在群 session key（可选，写入 lastSeenInGroup 字段） */
  groupSessionKey?: string;
  db: SqliteStore;
  vectorStore?: VectorStore;
  llmCall: LLMCallFn;
  /**
   * 是否同步在 knowledge_graph 写入 (memoryId, 'impression_of', 'agent:{peerAgentId}')。
   * 默认 true；测试可关闭。
   */
  writeKnowledgeGraph?: boolean;
}

export interface PeerImpressionExtractResult {
  memoryId: string | null;
  merged: boolean;
  skipped: boolean;
  reason?: string;
}

/** Zod schema：LLM 输出契约 */
const llmOutputSchema = z.object({
  l0Summary: z.string().min(2).max(160),
  collaborationStyle: z.string().min(1).max(80),
  strengths: z.array(z.string().min(1).max(40)).max(8).default([]),
  frictions: z.array(z.string().min(1).max(40)).max(8).default([]),
  lastTaskOutcome: z.enum(['完成', '部分完成', '未完成', '搁置', '未知']).default('未知'),
  lastTaskSummary: z.string().min(0).max(200).default(''),
});

type LlmOutput = z.infer<typeof llmOutputSchema>;

/**
 * 主入口：从最近的对话中提取/更新对 peer 的印象。
 *
 * 流程：
 *  1. 校验输入（自我引用 / 空消息 → skipped）
 *  2. 加载已有印象（merge_key = peer:{peerAgentId}）
 *  3. 调 LLM 输出 JSON，Zod 验证
 *  4. 合并已有印象（interactionCount +1，frictions/strengths 去重合并）
 *  5. upsert MemoryUnit；可选 upsert KG 三元组
 */
export async function extractAndPersistPeerImpression(
  input: PeerImpressionExtractInput,
): Promise<PeerImpressionExtractResult> {
  const { ownerAgentId, peerAgentId, recentMessages } = input;

  // [validate] 输入完整性
  if (!ownerAgentId || !peerAgentId) {
    log.warn(`[skip] reason=missing-id owner=${ownerAgentId} peer=${peerAgentId}`);
    return { memoryId: null, merged: false, skipped: true, reason: 'missing-id' };
  }
  if (ownerAgentId === peerAgentId) {
    log.warn(`[skip] reason=self-reference owner=${ownerAgentId}`);
    return { memoryId: null, merged: false, skipped: true, reason: 'self-reference' };
  }
  if (!recentMessages || recentMessages.length === 0) {
    log.debug(`[skip] reason=no-messages owner=${ownerAgentId} peer=${peerAgentId}`);
    return { memoryId: null, merged: false, skipped: true, reason: 'no-messages' };
  }

  const memoryStore = new MemoryStore(input.db, input.vectorStore);
  const mergeKey = `peer:${peerAgentId}`;
  const existing = memoryStore.findByMergeKey(ownerAgentId, mergeKey);
  const existingL1 = parseExistingL1(existing?.l1Overview);

  // [llm] 调用模型
  const conversationText = formatConversation(recentMessages);

  // [validate] 文本太短（少于 30 字符）跳过 — 避免给 LLM 喂噪声
  if (conversationText.length < 30) {
    log.debug(`[skip] reason=conversation-too-short owner=${ownerAgentId} peer=${peerAgentId} len=${conversationText.length}`);
    return { memoryId: null, merged: false, skipped: true, reason: 'conversation-too-short' };
  }

  const startMs = Date.now();
  log.info(`[extract][start] owner=${ownerAgentId} peer=${peerAgentId} msgCount=${recentMessages.length} hasExisting=${existing !== null}`);

  const { system, user } = buildPrompt({
    ownerName: input.ownerAgentName ?? ownerAgentId,
    peerName: input.peerAgentName ?? peerAgentId,
    existingImpression: existingL1,
    conversationText,
  });

  let llmRaw: string;
  try {
    llmRaw = await input.llmCall(system, user);
  } catch (err) {
    log.warn(`[extract][error] owner=${ownerAgentId} peer=${peerAgentId} err=${errMsg(err)}`);
    return { memoryId: null, merged: false, skipped: true, reason: 'llm-error' };
  }
  const llmMs = Date.now() - startMs;

  const parsed = parseLlmOutput(llmRaw);
  if (!parsed.ok) {
    log.warn(`[extract][skip] reason=invalid-output owner=${ownerAgentId} peer=${peerAgentId} err=${parsed.err} raw="${llmRaw.slice(0, 200)}"`);
    return { memoryId: null, merged: false, skipped: true, reason: 'invalid-output' };
  }

  // [merge] 合并已有印象 → 新 L1
  const now = new Date().toISOString();
  const newL1 = mergeImpression({
    peerAgentId,
    peerName: input.peerAgentName ?? existingL1?.peerName ?? peerAgentId,
    existing: existingL1,
    llm: parsed.value,
    lastInteractionAt: now,
    lastSeenInGroup: input.groupSessionKey,
  });

  // [persist] upsert
  const writeStart = Date.now();
  let memoryId: string;
  let merged = false;

  if (existing) {
    memoryStore.update(existing.id, {
      l1Overview: serializeL1(newL1),
      l2Content: existing.l2Content, // 保留旧 L2，本期不扩
      confidence: clamp01(existing.confidence + 0.05),
    });
    memoryStore.bumpActivation([existing.id]);
    memoryId = existing.id;
    merged = true;
  } else {
    const unit: MemoryUnit = {
      id: crypto.randomUUID(),
      agentId: ownerAgentId,
      category: 'entity',
      mergeType: 'merge',
      mergeKey,
      l0Index: parsed.value.l0Summary,
      l1Overview: serializeL1(newL1),
      l2Content: '', // 本期不存原始片段
      confidence: 0.6,
      activation: 1.0,
      accessCount: 0,
      visibility: 'private',
      sourceConversationId: input.groupSessionKey ?? null,
      createdAt: now,
      updatedAt: now,
      archivedAt: null,
    };
    memoryStore.insert(unit);
    memoryId = unit.id;
  }

  // [kg] 可选写知识图谱
  if (input.writeKnowledgeGraph !== false) {
    try {
      const kg = new KnowledgeGraphStore(input.db);
      kg.insertRelation({
        agentId: ownerAgentId,
        subjectId: memoryId,
        predicate: 'impression_of',
        objectId: `agent:${peerAgentId}`,
        confidence: 0.6,
        sourceMemoryId: memoryId,
      });
    } catch (err) {
      // KG 失败不影响印象写入
      log.warn(`[kg][error] owner=${ownerAgentId} peer=${peerAgentId} err=${errMsg(err)}`);
    }
  }

  const writeMs = Date.now() - writeStart;
  log.info(`[extract][done] owner=${ownerAgentId} peer=${peerAgentId} llmMs=${llmMs} writeMs=${writeMs} merged=${merged} interactionCount=${newL1.interactionCount}`);

  return { memoryId, merged, skipped: false };
}

// ---------- helpers ----------

function formatConversation(messages: PeerImpressionMessage[]): string {
  // 简单格式化；调用方负责截断长度。
  return messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `[${m.role}]: ${m.content}`)
    .join('\n\n');
}

interface BuildPromptInput {
  ownerName: string;
  peerName: string;
  existingImpression: PeerImpressionL1 | null;
  conversationText: string;
}

function buildPrompt(p: BuildPromptInput): { system: string; user: string } {
  const existingBlock = p.existingImpression
    ? `\n## 已有印象（请基于新对话刷新，不要全部覆盖）\n${JSON.stringify(p.existingImpression, null, 2)}\n`
    : '\n## 已有印象\n（首次记录此同事，无历史印象）\n';

  const system = `你是 Agent "${p.ownerName}" 的内省助手，正在为它总结对同事 Agent "${p.peerName}" 的协作印象。
你的输出会被持久化为 owner 视角的"同事印象记忆"，下次见到这位同事时会注入到 system prompt。

## 输出要求（严格 JSON，不要 markdown 代码块）
{
  "l0Summary": "≤80 字一句话描述这个同事的协作风格 + 强项",
  "collaborationStyle": "≤30 字，例：直接果断 / 含蓄谨慎 / 资料控 / 口语化",
  "strengths": ["最多 8 个标签，每个 ≤20 字"],
  "frictions": ["最多 8 个标签，每个 ≤20 字"],
  "lastTaskOutcome": "完成 | 部分完成 | 未完成 | 搁置 | 未知",
  "lastTaskSummary": "≤100 字描述本次互动的任务和结果"
}

## 准则
- 客观、基于本轮对话证据，不要想象未发生的事
- 已有印象要保留有价值的信息，把新观察"叠加"进去（strengths/frictions 去重合并由系统自动做，你可以重复列出关键项）
- 单次互动看不出的字段写"未知"或留空（[]）
- 不要写出对方人格攻击、隐私推测、敏感信息`;

  const user = `## 同事
- 名称：${p.peerName}
${existingBlock}
## 最近一轮协作对话
${p.conversationText}

请输出 JSON。`;

  return { system, user };
}

function parseLlmOutput(raw: string): { ok: true; value: LlmOutput } | { ok: false; err: string } {
  // 容忍 ```json 代码块包裹 / 前后日志噪声 — 提取首个 `{` 到末尾匹配的 `}`
  const candidate = extractJsonObject(raw);
  if (candidate === null) {
    return { ok: false, err: '未在响应中找到 JSON 对象' };
  }

  let json: unknown;
  try {
    json = JSON.parse(candidate);
  } catch (err) {
    return { ok: false, err: `JSON.parse 失败: ${errMsg(err)}` };
  }

  const result = llmOutputSchema.safeParse(json);
  if (!result.success) {
    return { ok: false, err: `Zod 验证失败: ${result.error.message}` };
  }
  return { ok: true, value: result.data };
}

/** 从混杂文本中抽出第一个 JSON 对象（最外层 { ... }，简单括号匹配） */
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') { inString = false; }
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function parseExistingL1(raw: string | undefined): PeerImpressionL1 | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (typeof v === 'object' && v !== null && 'peerAgentId' in v) {
      return v as PeerImpressionL1;
    }
    return null;
  } catch {
    return null;
  }
}

function serializeL1(l1: PeerImpressionL1): string {
  return JSON.stringify(l1, null, 2);
}

interface MergeImpressionInput {
  peerAgentId: string;
  peerName: string;
  existing: PeerImpressionL1 | null;
  llm: LlmOutput;
  lastInteractionAt: string;
  lastSeenInGroup?: string;
}

function mergeImpression(p: MergeImpressionInput): PeerImpressionL1 {
  const prev = p.existing;
  return {
    peerAgentId: p.peerAgentId,
    peerName: p.peerName,
    collaborationStyle: p.llm.collaborationStyle, // 取最新
    strengths: dedupCap([...(prev?.strengths ?? []), ...p.llm.strengths], 12),
    frictions: dedupCap([...(prev?.frictions ?? []), ...p.llm.frictions], 12),
    interactionCount: (prev?.interactionCount ?? 0) + 1,
    lastInteractionAt: p.lastInteractionAt,
    lastTaskOutcome: p.llm.lastTaskOutcome,
    lastTaskSummary: p.llm.lastTaskSummary,
    ...(p.lastSeenInGroup !== undefined ? { lastSeenInGroup: p.lastSeenInGroup } : {}),
  };
}

function dedupCap(items: string[], cap: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    const key = it.trim();
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= cap) break;
  }
  return out;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** 暴露给消费方的便捷读取函数：根据 owner+peer 取当前印象（PeerImpressionL1 或 null） */
export function readPeerImpression(
  db: SqliteStore,
  ownerAgentId: string,
  peerAgentId: string,
): { memoryUnit: MemoryUnit; l1: PeerImpressionL1 } | null {
  const store = new MemoryStore(db);
  const mergeKey = `peer:${peerAgentId}`;
  const unit = store.findByMergeKey(ownerAgentId, mergeKey);
  if (!unit) return null;
  const l1 = parseExistingL1(unit.l1Overview);
  if (!l1) return null;
  return { memoryUnit: unit, l1 };
}

/**
 * 列出 owner 视角下所有 peer 印象（merge_key LIKE 'peer:%' 的 entity 记忆）
 * 用于 prompt 注入 / REST endpoint。已自动过滤 archived。
 */
export function listPeerImpressions(
  db: SqliteStore,
  ownerAgentId: string,
  options?: { peerAgentIds?: string[]; limit?: number },
): Array<{ memoryUnit: MemoryUnit; l1: PeerImpressionL1 }> {
  const limit = options?.limit ?? 50;
  let rows: Array<Record<string, unknown>>;
  if (options?.peerAgentIds && options.peerAgentIds.length > 0) {
    const placeholders = options.peerAgentIds.map(() => '?').join(',');
    const keys = options.peerAgentIds.map(id => `peer:${id}`);
    rows = db.all<Record<string, unknown>>(
      `SELECT * FROM memory_units
       WHERE agent_id = ?
         AND category = 'entity'
         AND merge_key IN (${placeholders})
         AND archived_at IS NULL
       ORDER BY updated_at DESC
       LIMIT ?`,
      ownerAgentId, ...keys, limit,
    );
  } else {
    rows = db.all<Record<string, unknown>>(
      `SELECT * FROM memory_units
       WHERE agent_id = ?
         AND category = 'entity'
         AND merge_key LIKE 'peer:%'
         AND archived_at IS NULL
       ORDER BY updated_at DESC
       LIMIT ?`,
      ownerAgentId, limit,
    );
  }

  const out: Array<{ memoryUnit: MemoryUnit; l1: PeerImpressionL1 }> = [];
  for (const row of rows) {
    // 复用 rowToUnit 映射（与 MemoryStore 一致）
    const unit: MemoryUnit = {
      id: row['id'] as string,
      agentId: row['agent_id'] as string,
      category: row['category'] as MemoryUnit['category'],
      mergeType: row['merge_type'] as MemoryUnit['mergeType'],
      mergeKey: (row['merge_key'] as string) ?? null,
      l0Index: row['l0_index'] as string,
      l1Overview: row['l1_overview'] as string,
      l2Content: row['l2_content'] as string,
      confidence: row['confidence'] as number,
      activation: row['activation'] as number,
      accessCount: row['access_count'] as number,
      visibility: row['visibility'] as MemoryUnit['visibility'],
      sourceConversationId: (row['source_session_key'] as string) ?? null,
      createdAt: row['created_at'] as string,
      updatedAt: row['updated_at'] as string,
      archivedAt: (row['archived_at'] as string) ?? null,
    };
    const l1 = parseExistingL1(unit.l1Overview);
    if (!l1) continue;
    out.push({ memoryUnit: unit, l1 });
  }
  return out;
}

/** 仅为测试暴露的内部辅助（不要在生产代码引用） */
export const _internals = {
  parseLlmOutput,
  mergeImpression,
  buildPrompt,
  serializeL1,
  parseExistingL1,
  dedupCap,
};

/** 兼容输入类型：从 ChatMessage 简化为 PeerImpressionMessage */
export function toPeerImpressionMessages(messages: ChatMessage[]): PeerImpressionMessage[] {
  return messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));
}
