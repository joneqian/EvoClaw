/**
 * XML 解析器 — 解析 LLM 记忆提取的 XML 输出
 * 使用正则解析，无需 XML 库依赖
 */

import type { MemoryCategory, MergeType } from '@evoclaw/shared';

/** 解析后的单条记忆 */
export interface ParsedMemory {
  category: MemoryCategory;
  mergeType: MergeType;
  mergeKey: string | null;
  l0Index: string;
  l1Overview: string;
  l2Content: string;
  confidence: number;
}

/** 解析后的知识图谱关系 */
export interface ParsedRelation {
  subject: string;
  predicate: string;
  object: string;
  confidence: number;
}

/** 提取结果 */
export interface ExtractionResult {
  memories: ParsedMemory[];
  relations: ParsedRelation[];
}

/** 合法的记忆类别集合 */
const VALID_CATEGORIES: ReadonlySet<string> = new Set<MemoryCategory>([
  'profile', 'preference', 'entity', 'event',
  'case', 'pattern', 'tool', 'skill', 'correction',
]);

/** 合法的合并类型集合 */
const VALID_MERGE_TYPES: ReadonlySet<string> = new Set<MergeType>([
  'merge', 'independent',
]);

/**
 * 从 XML 标签中提取文本内容
 * @param xml - XML 字符串
 * @param tag - 标签名
 * @returns 标签内的文本，未找到则返回空字符串
 */
function extractTag(xml: string, tag: string): string {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`);
  const match = pattern.exec(xml);
  return match ? match[1].trim() : '';
}

/**
 * 提取所有匹配的 XML 块
 * @param xml - XML 字符串
 * @param tag - 标签名
 * @returns 所有匹配块的内容数组
 */
function extractAllBlocks(xml: string, tag: string): string[] {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g');
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    blocks.push(match[1]);
  }
  return blocks;
}

/**
 * 将置信度字符串解析为 0-1 之间的浮点数
 * @param raw - 原始字符串
 * @returns 钳位到 [0, 1] 的数值，无效时默认 0.5
 */
function parseConfidence(raw: string): number {
  const value = parseFloat(raw);
  if (isNaN(value)) return 0.5;
  return Math.max(0, Math.min(1, value));
}

/**
 * 校验并规范化记忆类别
 * @param raw - 原始类别字符串
 * @returns 合法的 MemoryCategory，无效时默认 'entity'
 */
function normalizeCategory(raw: string): MemoryCategory {
  const trimmed = raw.trim().toLowerCase();
  if (VALID_CATEGORIES.has(trimmed)) {
    return trimmed as MemoryCategory;
  }
  return 'entity';
}

/**
 * 校验并规范化合并类型
 * @param raw - 原始合并类型字符串
 * @returns 合法的 MergeType，无效时默认 'independent'
 */
function normalizeMergeType(raw: string): MergeType {
  const trimmed = raw.trim().toLowerCase();
  if (VALID_MERGE_TYPES.has(trimmed)) {
    return trimmed as MergeType;
  }
  return 'independent';
}

/**
 * 解析单个 memory 块
 * @param block - memory 标签内的 XML 内容
 * @returns 解析后的 ParsedMemory
 */
function parseMemoryBlock(block: string): ParsedMemory {
  const category = normalizeCategory(extractTag(block, 'category'));
  const mergeType = normalizeMergeType(extractTag(block, 'merge_type'));

  // merge_key：仅 merge 类型有效，其余为 null
  const rawMergeKey = extractTag(block, 'merge_key');
  const mergeKey = mergeType === 'merge' && rawMergeKey && rawMergeKey !== 'null'
    ? rawMergeKey
    : null;

  return {
    category,
    mergeType,
    mergeKey,
    l0Index: extractTag(block, 'l0_index'),
    l1Overview: extractTag(block, 'l1_overview'),
    l2Content: extractTag(block, 'l2_content'),
    confidence: parseConfidence(extractTag(block, 'confidence')),
  };
}

/**
 * 解析单个 relation 块
 * @param block - relation 标签内的 XML 内容
 * @returns 解析后的 ParsedRelation
 */
function parseRelationBlock(block: string): ParsedRelation {
  return {
    subject: extractTag(block, 'subject'),
    predicate: extractTag(block, 'predicate'),
    object: extractTag(block, 'object'),
    confidence: parseConfidence(extractTag(block, 'confidence')),
  };
}

/**
 * 解析 LLM 记忆提取的 XML 输出
 *
 * 处理以下情况：
 * - `<no_extraction/>` 或 `<no_extraction>` → 返回空结果
 * - 正常的 `<extraction>` XML → 解析 memories 和 relations
 * - 格式异常 → 尽力解析，返回能提取到的内容
 *
 * @param xml - LLM 输出的 XML 字符串
 * @returns 提取结果，包含记忆列表和关系列表
 */
export function parseExtractionResult(rawXml: string): ExtractionResult {
  const emptyResult: ExtractionResult = { memories: [], relations: [] };

  // 空输入
  if (!rawXml || !rawXml.trim()) {
    return emptyResult;
  }

  // 检查 no_extraction 标记（自闭合或空标签）
  if (/< *no_extraction\s*\/?>/.test(rawXml)) {
    return emptyResult;
  }

  // 容错：如果 LLM 输出了混合内容（文字+XML），尝试提取 XML 部分
  let xml = rawXml;
  const extractionMatch = rawXml.match(/<extraction[\s\S]*<\/extraction>/);
  if (extractionMatch) {
    xml = extractionMatch[0];
  } else if (!rawXml.includes('<memory>') && !rawXml.includes('<relation>')) {
    // 完全没有 XML 标签，尝试从 markdown 代码块中提取
    const codeBlockMatch = rawXml.match(/```(?:xml)?\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      xml = codeBlockMatch[1]!;
    }
  }

  // 解析 memory 块
  const memoryBlocks = extractAllBlocks(xml, 'memory');
  const memories = memoryBlocks.map(parseMemoryBlock);

  // 解析 relation 块
  const relationBlocks = extractAllBlocks(xml, 'relation');
  const relations = relationBlocks.map(parseRelationBlock);

  return { memories, relations };
}
