/**
 * 模型 ID forward-compat 解析
 *
 * 当用户配置的模型 ID 不在预设清单中（新发布的模型版本），
 * 用 token 前缀匹配回退到同 provider 内最接近的低版本模板，
 * 让 contextWindow / reasoning / maxTokens 等能力位有合理默认值。
 *
 * 算法：
 *   1. 精确匹配
 *   2. 剥离日期戳后缀（-20260219 / -20260219:0）后再精确匹配
 *   3. Token 前缀回退：按 [-.] 切 token，找同 provider 中
 *      共享 token 前缀 ≥ 2 的候选，按以下优先级排序：
 *        a. 共享 token 数（LCP）越长越好
 *        b. 候选是查询的严格 token 前缀（family root）优先
 *        c. 分歧位置都是数字 token（版本号 bump）优先
 *        d. 数字距离越近优先（5.4 比 5.3 更接近 5.5）
 *        e. 候选 ID 短优先（更通用的模板）
 *        f. 文件中先出现优先（确定性）
 */

import type { ModelDefinition, ProviderDefinition } from './types.js';

const DATE_SUFFIX_RE = /-\d{8}(?::\d+)?$/;
const NUMERIC_TOKEN_RE = /^\d+(?:\.\d+)?$/;
const MIN_SHARED_TOKENS = 2;

function tokenize(id: string): string[] {
  return id.split(/[-.]/).filter(Boolean);
}

function commonPrefixLen(a: readonly string[], b: readonly string[]): number {
  const max = Math.min(a.length, b.length);
  let n = 0;
  while (n < max && a[n] === b[n]) n++;
  return n;
}

function isNumericToken(t: string | undefined): boolean {
  return typeof t === 'string' && NUMERIC_TOKEN_RE.test(t);
}

interface Ranked {
  readonly def: ModelDefinition;
  readonly lcp: number;
  readonly candIsStrictPrefix: boolean;
  readonly numericDivergence: boolean;
  readonly numericDistance: number;
  readonly idLen: number;
  readonly fileOrder: number;
}

function rank(
  def: ModelDefinition,
  fileOrder: number,
  queryTokens: readonly string[],
): Ranked | undefined {
  const candTokens = tokenize(def.id);
  const lcp = commonPrefixLen(queryTokens, candTokens);
  if (lcp < MIN_SHARED_TOKENS) return undefined;

  const candIsStrictPrefix =
    candTokens.length === lcp && queryTokens.length > lcp;

  const queryNext = queryTokens[lcp];
  const candNext = candTokens[lcp];
  const numericDivergence =
    !candIsStrictPrefix && isNumericToken(queryNext) && isNumericToken(candNext);

  const numericDistance =
    numericDivergence && queryNext !== undefined && candNext !== undefined
      ? Math.abs(parseFloat(queryNext) - parseFloat(candNext))
      : Number.POSITIVE_INFINITY;

  return {
    def,
    lcp,
    candIsStrictPrefix,
    numericDivergence,
    numericDistance,
    idLen: def.id.length,
    fileOrder,
  };
}

function isBetter(a: Ranked, b: Ranked): boolean {
  if (a.lcp !== b.lcp) return a.lcp > b.lcp;
  if (a.candIsStrictPrefix !== b.candIsStrictPrefix) return a.candIsStrictPrefix;
  if (a.numericDivergence !== b.numericDivergence) return a.numericDivergence;
  if (a.numericDistance !== b.numericDistance)
    return a.numericDistance < b.numericDistance;
  if (a.idLen !== b.idLen) return a.idLen < b.idLen;
  return a.fileOrder < b.fileOrder;
}

/**
 * 在 provider 的预设模型中找最接近 modelId 的模板（forward-compat）。
 * 仅在精确匹配失败时使用；embedding 模型（dimension 字段）不参与回退。
 */
export function findForwardCompatTemplate(
  provider: ProviderDefinition,
  modelId: string,
): ModelDefinition | undefined {
  const stripped = modelId.replace(DATE_SUFFIX_RE, '');

  // 日期戳剥离后再次精确匹配
  if (stripped !== modelId) {
    const exact = provider.models.find((m) => m.id === stripped);
    if (exact) return exact;
  }

  const queryTokens = tokenize(stripped);
  if (queryTokens.length < MIN_SHARED_TOKENS) return undefined;

  let best: Ranked | undefined;
  for (let i = 0; i < provider.models.length; i++) {
    const def = provider.models[i];
    if (!def) continue;
    if (def.dimension !== undefined) continue; // 排除 embedding 模型
    const ranked = rank(def, i, queryTokens);
    if (!ranked) continue;
    if (!best || isBetter(ranked, best)) {
      best = ranked;
    }
  }

  return best?.def;
}
