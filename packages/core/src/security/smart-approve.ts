/**
 * Smart Approve — LLM 辅助风险评估
 *
 * 在 mode === 'smart' 下，对工具调用做 3 步评估：
 * 1. intent: 用户意图分类 (explore/modify/destroy/exfiltrate)
 * 2. risk: 工具调用爆炸半径 (none/local/system/external)
 * 3. decision: 综合 1+2 → approve / deny / escalate
 *
 * 安全栅栏：
 * - 静态分析（destructive-detector / bash-parser）应在前置过滤明显危险
 * - LLM 失败/超时 → 默认 escalate（不替用户做风险决策）
 * - session 内缓存（防 LLM 抖动 + 省 token）
 * - 仅 high-risk 工具（bash/edit/write/...）走 LLM；其它跳过
 */

import { createHash } from 'node:crypto';

/** Smart Approve 决策结果 */
export interface SmartDecision {
  decision: 'approve' | 'deny' | 'escalate';
  reason: string;
  /** 是否来自缓存 */
  cached?: boolean;
}

/** 评估输入 */
export interface SmartContext {
  toolName: string;
  params: Record<string, unknown>;
  /** Agent 当前会话的最近用户消息（可选，提供上下文） */
  recentUserMessage?: string;
}

/** LLM 调用函数签名（callLLMSecondary 风格） */
export type SmartLLMCall = (systemPrompt: string, userMessage: string) => Promise<string>;

/** 默认 LLM 超时（10s） */
const DEFAULT_LLM_TIMEOUT_MS = 10_000;

/** 仅 high-risk 工具走 LLM；其它（read/grep/ls 等）由 AUTO_ALLOW 路径放行不走这里 */
const HIGH_RISK_TOOLS = new Set([
  'bash', 'shell',
  'write', 'edit', 'apply_patch',
  'web_fetch', 'web_search',
  'send_message', 'send_email', 'post_tweet',
  'slack_send', 'telegram_send', 'wechat_send',
]);

/** 是否走 LLM 评估 */
export function shouldEvaluate(toolName: string): boolean {
  return HIGH_RISK_TOOLS.has(toolName);
}

/** session 内决策缓存（同 toolName + 同 input hash 复用决策） */
export class SmartDecisionCache {
  private map = new Map<string, SmartDecision>();

  get(ctx: SmartContext): SmartDecision | undefined {
    const decision = this.map.get(this.key(ctx));
    return decision ? { ...decision, cached: true } : undefined;
  }

  set(ctx: SmartContext, decision: SmartDecision): void {
    this.map.set(this.key(ctx), decision);
  }

  clear(): void {
    this.map.clear();
  }

  private key(ctx: SmartContext): string {
    const paramsStr = JSON.stringify(ctx.params, Object.keys(ctx.params).sort());
    return `${ctx.toolName}:${createHash('sha256').update(paramsStr).digest('hex').slice(0, 16)}`;
  }
}

/** 系统 prompt — 3 步评估 + JSON 输出强制 */
const SMART_APPROVE_SYSTEM_PROMPT = `你是 EvoClaw 的工具调用风险评估器。给定一个 Agent 即将执行的工具调用，按 3 步评估并输出 JSON。

步骤 1 - intent: 推测用户意图，分类为：
  - explore: 浏览/读取/查询，无副作用
  - modify: 修改本地文件、安装依赖、配置
  - destroy: 删除、覆盖、破坏性操作
  - exfiltrate: 数据外发到第三方（含未知域名）

步骤 2 - risk: 评估爆炸半径，分类为：
  - none: 无副作用（如 ls）
  - local: 仅影响当前工作区
  - system: 影响系统级资源（home 目录外、root 目录、跨工作区）
  - external: 影响外部系统（远程 API、云资源、外部账户）

步骤 3 - decision: 综合 intent + risk → decision
  - approve: explore + (none|local) 或 modify + local 且无未知域名
  - deny: destroy + system，或 exfiltrate 到非常用/未知域名
  - escalate: 边界情况、信息不全、用户意图模糊

输出严格 JSON，不要解释，不要 markdown：
{"intent":"...","risk":"...","decision":"approve|deny|escalate","reason":"中文一句话说明"}`;

/** 构造 user message */
function buildUserMessage(ctx: SmartContext): string {
  const lines = [`工具: ${ctx.toolName}`];
  // 截断 params，避免 prompt 过长
  const paramsStr = JSON.stringify(ctx.params, null, 2);
  lines.push(`参数:\n${paramsStr.slice(0, 2000)}`);
  if (ctx.recentUserMessage) {
    lines.push(`\n最近用户请求: ${ctx.recentUserMessage.slice(0, 500)}`);
  }
  return lines.join('\n');
}

/** 解析 LLM 输出为 SmartDecision，解析失败返回 escalate */
export function parseSmartDecision(raw: string): SmartDecision {
  // 提取 JSON（容忍 LLM 偶尔返回 markdown 包裹）
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { decision: 'escalate', reason: 'LLM 输出非 JSON 格式，升级人工确认' };
  }
  try {
    const obj = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const decision = obj.decision;
    if (decision !== 'approve' && decision !== 'deny' && decision !== 'escalate') {
      return { decision: 'escalate', reason: `LLM decision 字段非法 (${String(decision)})` };
    }
    const reason = typeof obj.reason === 'string' ? obj.reason : '（无原因）';
    return { decision, reason };
  } catch {
    return { decision: 'escalate', reason: 'LLM 输出 JSON 解析失败，升级人工确认' };
  }
}

/**
 * 评估单个工具调用风险。
 *
 * 调用方应：
 *   1. 仅在 mode === 'smart' 时调
 *   2. 仅当静态检查通过且 requiresConfirmation === true 时调
 *   3. shouldEvaluate(toolName) === true 才调（low-risk 直接放行）
 */
export async function evaluateRisk(
  ctx: SmartContext,
  callLLM: SmartLLMCall,
  cache?: SmartDecisionCache,
  timeoutMs: number = DEFAULT_LLM_TIMEOUT_MS,
): Promise<SmartDecision> {
  // 1. 缓存查询
  const cached = cache?.get(ctx);
  if (cached) {
    return cached;
  }

  // 2. LLM 调用 + 超时
  let raw: string;
  try {
    raw = await Promise.race([
      callLLM(SMART_APPROVE_SYSTEM_PROMPT, buildUserMessage(ctx)),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`smart-approve LLM 超时 (${timeoutMs}ms)`)), timeoutMs),
      ),
    ]);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { decision: 'escalate', reason };
  }

  // 3. 解析输出
  const decision = parseSmartDecision(raw);

  // 4. 缓存（escalate 也缓存，避免重复 LLM 调用浪费 token）
  cache?.set(ctx, decision);

  return decision;
}
