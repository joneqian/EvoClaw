/**
 * 飞书 Channel 配置 schema
 *
 * 字段来源：
 * - appId / appSecret: 开放平台应用凭据
 * - encryptKey: 事件订阅加密密钥（可选，长连接通常不需要）
 * - verificationToken: 请求验证 token（可选）
 * - domain: 'feishu'（中国）| 'lark'（海外）
 */

import { z } from 'zod';
import { FEISHU_GROUP_SESSION_SCOPES } from './session-key.js';
import { DEFAULT_GROUP_HISTORY_CONFIG } from './group-history.js';

/** Domain 枚举值 */
export const FEISHU_DOMAINS = ['feishu', 'lark'] as const;
export type FeishuDomain = (typeof FEISHU_DOMAINS)[number];

/** 飞书凭据 Schema（仅 credentials 子结构） */
export const FeishuCredentialsSchema = z.object({
  appId: z.string().min(1, '缺少 appId'),
  appSecret: z.string().min(1, '缺少 appSecret'),
  encryptKey: z.string().optional(),
  verificationToken: z.string().optional(),
  domain: z.enum(FEISHU_DOMAINS).default('feishu'),
  /**
   * 群聊会话隔离策略
   * - group (默认)           整群共享一个会话
   * - group_sender           群内按成员分离
   * - group_topic            群内按话题分离
   * - group_topic_sender     群内按「话题 × 成员」分离（最细）
   */
  groupSessionScope: z.enum(FEISHU_GROUP_SESSION_SCOPES).default('group'),
  /**
   * 群聊旁听缓冲（多机器人协作默认能力）
   * - enabled           未 @ 消息记入 buffer，被 @ 时注入最近 N 条前情提要
   * - limit             单群最多保留条数（FIFO 淘汰 oldest）
   * - ttlMinutes        条目过期分钟数（懒淘汰）
   * - includeBotMessages 是否回写 Agent 自己的回复
   */
  groupHistory: z
    .object({
      enabled: z.boolean().default(DEFAULT_GROUP_HISTORY_CONFIG.enabled),
      limit: z
        .number()
        .int()
        .min(0)
        .max(100)
        .default(DEFAULT_GROUP_HISTORY_CONFIG.limit),
      ttlMinutes: z
        .number()
        .int()
        .min(0)
        .max(1440)
        .default(DEFAULT_GROUP_HISTORY_CONFIG.ttlMinutes),
      includeBotMessages: z
        .boolean()
        .default(DEFAULT_GROUP_HISTORY_CONFIG.includeBotMessages),
    })
    .default({ ...DEFAULT_GROUP_HISTORY_CONFIG }),
});

export type FeishuCredentials = z.infer<typeof FeishuCredentialsSchema>;

/** 把 "true"/"1"/"on" 解析为 boolean；空/undefined 返回 fallback */
function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const v = raw.trim().toLowerCase();
  if (v === 'true' || v === '1' || v === 'on' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'off' || v === 'no') return false;
  return fallback;
}

/** 把整数字符串解析为数字，非法 / 空时返回 fallback */
function parseInt10(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === null || raw === '') return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * 从任意 credentials 对象解析出规范化的飞书凭据
 *
 * 使用 safeParse + 翻译为中文错误（CLAUDE.md 约定：外部输入走 safeParse，不抛异常）
 *
 * groupHistory 用扁平键（`groupHistoryEnabled` / `groupHistoryLimit` /
 * `groupHistoryTtlMinutes` / `groupHistoryIncludeBotMessages`），沿用
 * ChannelConfig.credentials 的 `Record<string, string>` 约定（跨 adapter 统一）。
 * @throws Error 凭据不合法时抛出中文错误消息
 */
export function parseFeishuCredentials(raw: Record<string, string>): FeishuCredentials {
  const result = FeishuCredentialsSchema.safeParse({
    appId: raw['appId'] ?? '',
    appSecret: raw['appSecret'] ?? '',
    encryptKey: raw['encryptKey'] || undefined,
    verificationToken: raw['verificationToken'] || undefined,
    domain: raw['domain'] ?? 'feishu',
    groupSessionScope: raw['groupSessionScope'] ?? 'group',
    groupHistory: {
      enabled: parseBool(
        raw['groupHistoryEnabled'],
        DEFAULT_GROUP_HISTORY_CONFIG.enabled,
      ),
      limit: parseInt10(
        raw['groupHistoryLimit'],
        DEFAULT_GROUP_HISTORY_CONFIG.limit,
      ),
      ttlMinutes: parseInt10(
        raw['groupHistoryTtlMinutes'],
        DEFAULT_GROUP_HISTORY_CONFIG.ttlMinutes,
      ),
      includeBotMessages: parseBool(
        raw['groupHistoryIncludeBotMessages'],
        DEFAULT_GROUP_HISTORY_CONFIG.includeBotMessages,
      ),
    },
  });
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first?.path.join('.') ?? '未知字段';
    const msg = first?.message ?? '配置不合法';
    throw new Error(`飞书配置不合法 [${field}]: ${msg}`);
  }
  return result.data;
}
