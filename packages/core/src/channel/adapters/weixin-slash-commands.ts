/**
 * Weixin 斜杠指令处理模块
 *
 * 支持的指令：
 * - /echo <message>       直接回复消息（不经过 AI），附带通道耗时统计
 * - /toggle-debug          开关 debug 模式，启用后每条 AI 回复追加全链路耗时
 */

import { createLogger } from '../../infrastructure/logger.js';

import type { WeixinCredentials } from './weixin-types.js';
import { sendTextMessage } from './weixin-api.js';
import type { ChannelStateRepo } from '../channel-state-repo.js';
import { toggleDebugMode } from './weixin-debug.js';

const log = createLogger('weixin-slash');

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 斜杠指令上下文 */
export interface SlashCommandContext {
  /** 回复目标用户 ID */
  toUserId: string;
  /** 回复关联 token (必须回传才能关联会话) */
  contextToken?: string;
  /** 微信凭证 */
  credentials: WeixinCredentials;
  /** 通道状态仓库 */
  stateRepo: ChannelStateRepo;
  /** 账号 ID */
  accountId: string;
  /** 插件收到消息的时间戳 (ms) */
  receivedAt: number;
  /** 平台侧事件时间戳 (ms) */
  eventTimeMs?: number;
}

/** 斜杠指令处理结果 */
export interface SlashCommandResult {
  /** 是否已处理 (true 表示不需要继续走 AI 管道) */
  handled: boolean;
  /** 可选的响应文本 (仅用于调试/测试) */
  response?: string;
}

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

/** 检查文本是否是斜杠指令 */
export function isSlashCommand(text: string): boolean {
  return text.trimStart().startsWith('/');
}

/**
 * 尝试处理斜杠指令
 *
 * @returns handled=true 表示该消息已作为指令处理，不需要继续走 AI 管道
 */
export async function handleSlashCommand(
  text: string,
  ctx: SlashCommandContext,
): Promise<SlashCommandResult> {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) {
    return { handled: false };
  }

  const spaceIdx = trimmed.indexOf(' ');
  const command = spaceIdx === -1 ? trimmed.toLowerCase() : trimmed.slice(0, spaceIdx).toLowerCase();
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);

  log.info(`斜杠指令: ${command}, args: ${args.slice(0, 50)}`);

  try {
    switch (command) {
      case '/echo':
        return await handleEcho(ctx, args);
      case '/toggle-debug':
        return await handleToggleDebug(ctx);
      default:
        return { handled: false };
    }
  } catch (err) {
    log.error(`斜杠指令执行失败: ${String(err)}`);
    try {
      await sendReply(ctx, `❌ 指令执行失败: ${String(err).slice(0, 200)}`);
    } catch {
      // 发送错误消息也失败了，只能记日志
    }
    return { handled: true };
  }
}

// ---------------------------------------------------------------------------
// 内部方法
// ---------------------------------------------------------------------------

/** 发送回复消息 */
async function sendReply(ctx: SlashCommandContext, text: string): Promise<void> {
  await sendTextMessage({
    baseUrl: ctx.credentials.baseUrl,
    token: ctx.credentials.botToken,
    toUserId: ctx.toUserId,
    text,
    contextToken: ctx.contextToken,
  });
}

/** 处理 /echo 指令 — 直接回显消息并附带耗时统计 */
async function handleEcho(ctx: SlashCommandContext, args: string): Promise<SlashCommandResult> {
  const message = args.trim();
  if (message) {
    await sendReply(ctx, message);
  }

  const eventTs = ctx.eventTimeMs ?? 0;
  const platformDelay = eventTs > 0 ? `${ctx.receivedAt - eventTs}ms` : 'N/A';
  const timing = [
    '⏱ 通道耗时',
    `├ 事件时间: ${eventTs > 0 ? new Date(eventTs).toISOString() : 'N/A'}`,
    `├ 平台→插件: ${platformDelay}`,
    `└ 插件处理: ${Date.now() - ctx.receivedAt}ms`,
  ].join('\n');

  await sendReply(ctx, timing);
  return { handled: true, response: message || timing };
}

/** 处理 /toggle-debug 指令 — 切换 debug 模式 */
async function handleToggleDebug(ctx: SlashCommandContext): Promise<SlashCommandResult> {
  const enabled = toggleDebugMode(ctx.accountId, ctx.stateRepo);
  const response = enabled ? 'Debug 模式已开启' : 'Debug 模式已关闭';
  await sendReply(ctx, response);
  return { handled: true, response };
}
