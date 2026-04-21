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
});

export type FeishuCredentials = z.infer<typeof FeishuCredentialsSchema>;

/** 从任意 credentials 对象解析出规范化的飞书凭据 */
export function parseFeishuCredentials(raw: Record<string, string>): FeishuCredentials {
  return FeishuCredentialsSchema.parse({
    appId: raw['appId'] ?? '',
    appSecret: raw['appSecret'] ?? '',
    encryptKey: raw['encryptKey'] || undefined,
    verificationToken: raw['verificationToken'] || undefined,
    domain: (raw['domain'] as FeishuDomain | undefined) ?? 'feishu',
  });
}
