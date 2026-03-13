import { MemoryStore } from './memory-store.js';
import type { ParsedMemory } from './xml-parser.js';
import type { MemoryUnit } from '@evoclaw/shared';

/**
 * 记忆合并/独立写入解析器
 * 根据 mergeType 决定是合并已有记忆还是插入新记录
 */
export class MergeResolver {
  constructor(private store: MemoryStore) {}

  /**
   * Resolve a parsed memory: either merge with existing or insert new.
   * Returns the memory unit ID (new or existing).
   */
  resolve(agentId: string, parsed: ParsedMemory): string {
    if (parsed.mergeType === 'merge' && parsed.mergeKey) {
      const existing = this.store.findByMergeKey(agentId, parsed.mergeKey);
      if (existing) {
        // 仅更新 L1 和 L2（L0 保持稳定，用于向量索引）
        this.store.update(existing.id, {
          l1Overview: parsed.l1Overview,
          l2Content: parsed.l2Content,
          confidence: parsed.confidence,
        });
        this.store.bumpActivation([existing.id]);
        return existing.id;
      }
    }
    // 插入新记录
    const unit: MemoryUnit = {
      id: crypto.randomUUID(),
      agentId,
      category: parsed.category,
      mergeType: parsed.mergeType,
      mergeKey: parsed.mergeKey,
      l0Index: parsed.l0Index,
      l1Overview: parsed.l1Overview,
      l2Content: parsed.l2Content,
      confidence: parsed.confidence,
      activation: 1.0,
      accessCount: 0,
      visibility: 'private',
      sourceConversationId: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archivedAt: null,
    };
    this.store.insert(unit);
    return unit.id;
  }

  /**
   * 批量解析记忆列表
   * Returns array of memory unit IDs.
   */
  resolveAll(agentId: string, parsed: ParsedMemory[]): string[] {
    return parsed.map(p => this.resolve(agentId, p));
  }
}
