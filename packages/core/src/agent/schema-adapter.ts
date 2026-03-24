/**
 * Schema Provider Adaptation — 根据 LLM Provider 规范化工具 JSON Schema
 *
 * 不同 provider 对 JSON Schema 关键字的支持程度不同：
 * - Anthropic: 完整支持
 * - OpenAI/OpenAI-compatibles: 需要顶层 type:"object"
 * - Google (Gemini): 不支持大量 Schema 关键字
 * - xAI (Grok): 不支持部分约束关键字
 */

/** Gemini 不支持的 JSON Schema 关键字 */
const GEMINI_STRIP_KEYWORDS = new Set([
  'patternProperties',
  'additionalProperties',
  '$schema',
  '$id',
  '$ref',
  '$defs',
  'definitions',
  'examples',
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'multipleOf',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
]);

/** xAI 不支持的约束关键字 */
const XAI_STRIP_KEYWORDS = new Set([
  'minLength',
  'maxLength',
  'minimum',
  'maximum',
  'multipleOf',
  'pattern',
  'format',
  'minItems',
  'maxItems',
]);

/** 扁平化 anyOf/oneOf union schema */
export function flattenUnionSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const anyOf = schema['anyOf'] as Record<string, unknown>[] | undefined;
  const oneOf = schema['oneOf'] as Record<string, unknown>[] | undefined;
  const variants = anyOf ?? oneOf;

  if (!variants || schema['type']) return schema; // 已有 type 或非 union

  // 仅当至少有一个变体包含 properties 时才扁平化（原始类型 union 保持原样）
  const hasObjectVariant = variants.some(v => v['properties'] != null);
  if (!hasObjectVariant) return schema;

  // 合并所有变体的 properties
  const mergedProperties: Record<string, unknown> = {};
  const requiredSets: Set<string>[] = [];

  for (const variant of variants) {
    const props = variant['properties'] as Record<string, unknown> | undefined;
    if (props) {
      for (const [key, value] of Object.entries(props)) {
        if (!mergedProperties[key]) {
          mergedProperties[key] = value;
        } else {
          // 合并 const -> enum
          const existing = mergedProperties[key] as Record<string, unknown>;
          const incoming = value as Record<string, unknown>;
          if (existing['const'] && incoming['const']) {
            mergedProperties[key] = {
              type: 'string',
              enum: [existing['const'], incoming['const']],
            };
          } else if (existing['enum'] && incoming['const']) {
            (existing['enum'] as unknown[]).push(incoming['const']);
          }
        }
      }
    }
    const req = variant['required'] as string[] | undefined;
    if (req) requiredSets.push(new Set(req));
  }

  // 找出所有变体共同的 required
  const commonRequired = requiredSets.length > 0
    ? [...requiredSets[0]].filter(r => requiredSets.every(s => s.has(r)))
    : [];

  const result: Record<string, unknown> = {
    type: 'object',
    properties: mergedProperties,
  };
  if (commonRequired.length > 0) {
    result['required'] = commonRequired;
  }

  return result;
}

/**
 * 根据 provider 规范化工具 schema
 * @param schema - 原始 JSON Schema
 * @param provider - EvoClaw provider ID（如 anthropic, openai, google, xai）
 * @returns 规范化后的 schema（不可变，返回新对象）
 */
export function normalizeToolSchema(
  schema: Record<string, unknown>,
  provider: string,
): Record<string, unknown> {
  // Step 1: 扁平化 anyOf/oneOf union schema
  const flattened = flattenUnionSchema(schema);

  // Step 2: 根据 provider 适配
  if (provider === 'google' || provider === 'google-generative-ai') {
    return stripKeywords(flattened, GEMINI_STRIP_KEYWORDS);
  }
  if (provider === 'xai') {
    return stripKeywords(flattened, XAI_STRIP_KEYWORDS);
  }
  if (provider === 'openai' || provider === 'openai-completions') {
    // OpenAI 要求顶层必须有 type: "object"
    return { type: 'object', ...flattened };
  }
  // Anthropic 及其他 provider：保持原样
  return flattened;
}

/**
 * 递归剥离指定的 JSON Schema 关键字
 * @param obj - 待处理的 schema 对象或数组
 * @param keywords - 需要剥离的关键字集合
 * @returns 新的 schema 对象（不可变）
 */
function stripKeywords(obj: unknown, keywords: Set<string>): any {
  if (typeof obj !== 'object' || obj === null) return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => stripKeywords(item, keywords));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (!keywords.has(key)) {
      result[key] = stripKeywords(value, keywords);
    }
  }
  return result;
}
