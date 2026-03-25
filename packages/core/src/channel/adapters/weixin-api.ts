/**
 * iLink Bot 平台 API 客户端
 *
 * 封装与 https://ilinkai.weixin.qq.com 的 HTTP 通信
 * 参考: @tencent-weixin/openclaw-weixin src/api/api.ts
 */

import crypto from 'node:crypto';

import { createLogger } from '../../infrastructure/logger.js';

import { redactUrl, redactBody } from './weixin-redact.js';
import type {
  WeixinGetUpdatesResp,
  WeixinGetConfigResp,
  WeixinGetUploadUrlResp,
  WeixinQrCodeResp,
  WeixinQrStatusResp,
  WeixinMessage,
  WeixinMessageItem,
} from './weixin-types.js';
import {
  DEFAULT_WEIXIN_BASE_URL,
  DEFAULT_BOT_TYPE,
  WeixinMessageType,
  WeixinMessageState,
  WeixinItemType,
  WeixinTypingStatus,
} from './weixin-types.js';

const log = createLogger('weixin-api');

// ---------------------------------------------------------------------------
// 超时常量
// ---------------------------------------------------------------------------

/** 长轮询超时 (服务端 ~35s + 客户端缓冲) */
const LONG_POLL_TIMEOUT_MS = 40_000;
/** 普通 API 调用超时 */
const API_TIMEOUT_MS = 15_000;
/** 轻量 API 调用超时 (getConfig, sendTyping) */
const CONFIG_TIMEOUT_MS = 10_000;
/** QR 状态长轮询超时 */
const QR_POLL_TIMEOUT_MS = 35_000;

// ---------------------------------------------------------------------------
// 公共工具
// ---------------------------------------------------------------------------

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

/** X-WECHAT-UIN 请求头: random uint32 → 十进制字符串 → base64 */
function randomWechatUin(): string {
  const uint32 = crypto.randomBytes(4).readUInt32BE(0);
  return Buffer.from(String(uint32), 'utf-8').toString('base64');
}

/** 构建 iLink Bot API 公共请求头 */
function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'AuthorizationType': 'ilink_bot_token',
    'X-WECHAT-UIN': randomWechatUin(),
  };
  if (token?.trim()) {
    headers['Authorization'] = `Bearer ${token.trim()}`;
  }
  return headers;
}

/**
 * 通用 POST 请求封装
 * 包含超时控制和错误处理
 */
async function apiFetch(params: {
  baseUrl: string;
  endpoint: string;
  body: string;
  token?: string;
  timeoutMs: number;
  label: string;
}): Promise<string> {
  const base = ensureTrailingSlash(params.baseUrl);
  const url = new URL(params.endpoint, base).toString();
  const headers = buildHeaders(params.token);

  log.debug(`POST ${params.label} → ${redactUrl(url)}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), params.timeoutMs);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: params.body,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const rawText = await res.text();
    log.debug(`${params.label} status=${res.status} body=${redactBody(rawText)}`);

    if (!res.ok) {
      throw new Error(`${params.label} HTTP ${res.status}: ${rawText.substring(0, 200)}`);
    }
    return rawText;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// API 方法
// ---------------------------------------------------------------------------

export interface WeixinApiOpts {
  baseUrl: string;
  token?: string;
}

/**
 * 长轮询拉取新消息
 * 客户端超时时返回空响应 (ret=0, msgs=[])，调用方可直接重试
 */
export async function getUpdates(opts: WeixinApiOpts & {
  getUpdatesBuf?: string;
  timeoutMs?: number;
}): Promise<WeixinGetUpdatesResp> {
  const timeout = opts.timeoutMs ?? LONG_POLL_TIMEOUT_MS;
  try {
    const rawText = await apiFetch({
      baseUrl: opts.baseUrl,
      endpoint: 'ilink/bot/getupdates',
      body: JSON.stringify({ get_updates_buf: opts.getUpdatesBuf ?? '' }),
      token: opts.token,
      timeoutMs: timeout,
      label: 'getUpdates',
    });
    return JSON.parse(rawText) as WeixinGetUpdatesResp;
  } catch (err) {
    // 长轮询超时是正常行为，返回空响应
    if (err instanceof Error && err.name === 'AbortError') {
      log.debug(`getUpdates: 客户端超时 ${timeout}ms，返回空响应`);
      return { ret: 0, msgs: [], get_updates_buf: opts.getUpdatesBuf };
    }
    throw err;
  }
}

/** 发送消息 */
export async function sendMessage(opts: WeixinApiOpts & {
  toUserId: string;
  contextToken?: string;
  itemList: WeixinMessageItem[];
}): Promise<void> {
  const msg: WeixinMessage = {
    from_user_id: '',
    to_user_id: opts.toUserId,
    context_token: opts.contextToken,
    // iLink 平台要求以下字段，缺失会导致消息不投递
    message_type: WeixinMessageType.BOT,
    message_state: WeixinMessageState.FINISH,
    client_id: crypto.randomUUID(),
    item_list: opts.itemList,
  };

  const rawText = await apiFetch({
    baseUrl: opts.baseUrl,
    endpoint: 'ilink/bot/sendmessage',
    body: JSON.stringify({ msg, base_info: { channel_version: '2.0.1' } }),
    token: opts.token,
    timeoutMs: API_TIMEOUT_MS,
    label: 'sendMessage',
  });

  // 检查 iLink 业务错误码（HTTP 200 但 ret 非 0 表示投递失败）
  if (rawText) {
    try {
      const resp = JSON.parse(rawText) as { ret?: number; errmsg?: string };
      if (resp.ret !== undefined && resp.ret !== 0) {
        log.warn(`sendMessage 业务错误: ret=${resp.ret} errmsg=${resp.errmsg ?? '未知'} toUserId=${opts.toUserId}`);
        throw new Error(`iLink sendMessage 失败: ret=${resp.ret} ${resp.errmsg ?? ''}`);
      }
    } catch (e) {
      // JSON 解析失败时仅当 e 是我们自己抛的才重新抛出
      if (e instanceof Error && e.message.startsWith('iLink sendMessage')) throw e;
    }
  }
}

/** 发送文本消息 (便捷方法) */
export async function sendTextMessage(opts: WeixinApiOpts & {
  toUserId: string;
  text: string;
  contextToken?: string;
}): Promise<void> {
  await sendMessage({
    ...opts,
    itemList: [{ type: WeixinItemType.TEXT, text_item: { text: opts.text } }],
  });
}

/** 获取账号配置 (typing ticket 等) */
export async function getConfig(opts: WeixinApiOpts & {
  ilinkUserId: string;
  contextToken?: string;
}): Promise<WeixinGetConfigResp> {
  const rawText = await apiFetch({
    baseUrl: opts.baseUrl,
    endpoint: 'ilink/bot/getconfig',
    body: JSON.stringify({
      ilink_user_id: opts.ilinkUserId,
      context_token: opts.contextToken,
    }),
    token: opts.token,
    timeoutMs: CONFIG_TIMEOUT_MS,
    label: 'getConfig',
  });
  return JSON.parse(rawText) as WeixinGetConfigResp;
}

/** 发送/取消输入状态指示 */
export async function sendTypingIndicator(opts: WeixinApiOpts & {
  ilinkUserId: string;
  typingTicket: string;
  cancel?: boolean;
}): Promise<void> {
  await apiFetch({
    baseUrl: opts.baseUrl,
    endpoint: 'ilink/bot/sendtyping',
    body: JSON.stringify({
      ilink_user_id: opts.ilinkUserId,
      typing_ticket: opts.typingTicket,
      status: opts.cancel ? WeixinTypingStatus.CANCEL : WeixinTypingStatus.TYPING,
    }),
    token: opts.token,
    timeoutMs: CONFIG_TIMEOUT_MS,
    label: 'sendTyping',
  });
}

/** 获取 CDN 上传 URL */
export async function getUploadUrl(opts: WeixinApiOpts & {
  filekey: string;
  mediaType: number;
  toUserId: string;
  rawSize: number;
  rawMd5: string;
  cipherSize: number;
  aesKeyHex: string;
}): Promise<WeixinGetUploadUrlResp> {
  const rawText = await apiFetch({
    baseUrl: opts.baseUrl,
    endpoint: 'ilink/bot/getuploadurl',
    body: JSON.stringify({
      filekey: opts.filekey,
      media_type: opts.mediaType,
      to_user_id: opts.toUserId,
      rawsize: opts.rawSize,
      rawfilemd5: opts.rawMd5,
      filesize: opts.cipherSize,
      no_need_thumb: true,
      aeskey: opts.aesKeyHex,
      base_info: { channel_version: '2.0.1' },
    }),
    token: opts.token,
    timeoutMs: API_TIMEOUT_MS,
    label: 'getUploadUrl',
  });
  return JSON.parse(rawText) as WeixinGetUploadUrlResp;
}

// ---------------------------------------------------------------------------
// QR 码登录 API
// ---------------------------------------------------------------------------

/** 获取登录二维码 */
export async function getQrCode(
  baseUrl: string = DEFAULT_WEIXIN_BASE_URL,
): Promise<WeixinQrCodeResp> {
  const base = ensureTrailingSlash(baseUrl);
  const url = new URL(
    `ilink/bot/get_bot_qrcode?bot_type=${encodeURIComponent(DEFAULT_BOT_TYPE)}`,
    base,
  ).toString();

  log.info(`获取登录二维码: ${url}`);

  const res = await fetch(url);
  if (!res.ok) {
    const body = await res.text().catch(() => '(unreadable)');
    throw new Error(`获取二维码失败: HTTP ${res.status} ${body.substring(0, 200)}`);
  }
  return await res.json() as WeixinQrCodeResp;
}

/** 轮询二维码扫描状态 (长轮询，~35s 超时) */
export async function pollQrStatus(
  baseUrl: string = DEFAULT_WEIXIN_BASE_URL,
  qrcode: string,
): Promise<WeixinQrStatusResp> {
  const base = ensureTrailingSlash(baseUrl);
  const url = new URL(
    `ilink/bot/get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}`,
    base,
  ).toString();

  log.debug(`轮询 QR 状态: ${url}`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), QR_POLL_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      headers: { 'iLink-App-ClientVersion': '1' },
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`QR 状态查询失败: HTTP ${res.status} ${body.substring(0, 200)}`);
    }
    return await res.json() as WeixinQrStatusResp;
  } catch (err) {
    clearTimeout(timer);
    // 长轮询超时 → 返回 wait 状态
    if (err instanceof Error && err.name === 'AbortError') {
      log.debug(`QR 状态轮询超时 ${QR_POLL_TIMEOUT_MS}ms，返回 wait`);
      return { status: 'wait' };
    }
    throw err;
  }
}
