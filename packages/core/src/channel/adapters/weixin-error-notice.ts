/**
 * Weixin 通道错误通知
 *
 * Fire-and-forget 模式：将错误映射为用户友好的中文提示发送给用户，
 * 自身绝不抛出异常。
 */

import { createLogger } from '../../infrastructure/logger.js';

import type { WeixinCredentials } from './weixin-types.js';
import { sendTextMessage } from './weixin-api.js';

const log = createLogger('weixin-error-notice');

// ---------------------------------------------------------------------------
// 公共 API
// ---------------------------------------------------------------------------

/**
 * 发送错误通知给用户
 *
 * - 没有 contextToken 时静默跳过 (无法关联会话)
 * - 根据错误内容映射为中文提示
 * - Fire-and-forget：内部 try/catch，永不抛出
 */
export async function sendErrorNotice(params: {
  credentials: WeixinCredentials;
  peerId: string;
  contextToken?: string;
  error: Error | string;
}): Promise<void> {
  const { credentials, peerId, contextToken, error } = params;
  const errorMessage = error instanceof Error ? error.message : error;

  // 没有 contextToken 无法回复
  if (!contextToken || errorMessage.includes('contextToken')) {
    log.warn(`无法发送错误通知: 缺少 contextToken, peerId=${peerId}`);
    return;
  }

  const userMessage = mapErrorToMessage(errorMessage);

  try {
    await sendTextMessage({
      baseUrl: credentials.baseUrl,
      token: credentials.botToken,
      toUserId: peerId,
      text: userMessage,
      contextToken,
    });
    log.debug(`错误通知已发送: peerId=${peerId}`);
  } catch (sendErr) {
    log.error(`错误通知发送失败: peerId=${peerId}, err=${String(sendErr)}`);
  }
}

// ---------------------------------------------------------------------------
// 内部方法
// ---------------------------------------------------------------------------

/** 将错误信息映射为用户友好的中文提示 */
function mapErrorToMessage(message: string): string {
  const lower = message.toLowerCase();

  if (lower.includes('fetch') || lower.includes('download')) {
    return '⚠️ 媒体文件下载失败，请检查链接';
  }
  if (lower.includes('upload') || lower.includes('getuploadurl') || lower.includes('cdn')) {
    return '⚠️ 媒体文件上传失败，请稍后重试';
  }

  // 默认：截取前 100 字符防止消息过长
  const truncated = message.length > 100 ? `${message.slice(0, 100)}...` : message;
  return `⚠️ 消息发送失败：${truncated}`;
}
