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
});

export type FeishuCredentials = z.infer<typeof FeishuCredentialsSchema>;

/**
 * 从任意 credentials 对象解析出规范化的飞书凭据
 *
 * 使用 safeParse + 翻译为中文错误（CLAUDE.md 约定：外部输入走 safeParse，不抛异常）
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
  });
  if (!result.success) {
    const first = result.error.issues[0];
    const field = first?.path.join('.') ?? '未知字段';
    const msg = first?.message ?? '配置不合法';
    throw new Error(`飞书配置不合法 [${field}]: ${msg}`);
  }
  return result.data;
}
