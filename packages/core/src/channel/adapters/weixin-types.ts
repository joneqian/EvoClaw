/**
 * iLink Bot 平台 API 类型定义
 *
 * 基于 @tencent-weixin/openclaw-weixin v1.0.2 协议分析
 * 平台地址: https://ilinkai.weixin.qq.com
 */

// ---------------------------------------------------------------------------
// 凭证
// ---------------------------------------------------------------------------

/** 微信凭证 — QR 扫码登录后获得 */
export interface WeixinCredentials {
  /** Bearer token (从 QR 扫码确认后获取) */
  botToken: string;
  /** ilink_bot_id — 作为 accountId */
  ilinkBotId: string;
  /** API 基础 URL */
  baseUrl: string;
}

/** 默认 iLink Bot API 基础 URL */
export const DEFAULT_WEIXIN_BASE_URL = 'https://ilinkai.weixin.qq.com';

/** 默认 bot_type (渠道类型标识) */
export const DEFAULT_BOT_TYPE = '3';

// ---------------------------------------------------------------------------
// 消息项类型
// ---------------------------------------------------------------------------

/** iLink 消息项类型枚举 */
export const WeixinItemType = {
  TEXT: 1,
  IMAGE: 2,
  VOICE: 3,
  FILE: 4,
  VIDEO: 5,
} as const;

/** iLink 消息类型 */
export const WeixinMessageType = {
  USER: 1,
  BOT: 2,
} as const;

/** iLink 消息状态 */
export const WeixinMessageState = {
  NEW: 0,
  GENERATING: 1,
  FINISH: 2,
} as const;

/** Typing 状态 */
export const WeixinTypingStatus = {
  TYPING: 1,
  CANCEL: 2,
} as const;

// ---------------------------------------------------------------------------
// 消息结构
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// CDN 媒体引用
// ---------------------------------------------------------------------------

/** CDN 媒体引用 — 所有媒体类型通过 CDN 传输，使用 AES-128-ECB 加密 */
export interface CDNMedia {
  /** CDN 下载/上传的加密参数 */
  encrypt_query_param?: string;
  /** base64 编码的 AES-128 密钥 */
  aes_key?: string;
  /** 加密类型: 0=只加密fileid, 1=打包缩略图/中图等信息 */
  encrypt_type?: number;
}

// ---------------------------------------------------------------------------
// 消息项
// ---------------------------------------------------------------------------

/** 文本消息项 */
export interface WeixinTextItem {
  text?: string;
}

/** 图片消息项 */
export interface WeixinImageItem {
  /** 原图 CDN 引用 */
  media?: CDNMedia;
  /** 缩略图 CDN 引用 */
  thumb_media?: CDNMedia;
  /** Raw AES-128 key as hex string (16 bytes)；入站解密优先使用此字段 */
  aeskey?: string;
  url?: string;
  mid_size?: number;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
  hd_size?: number;
}

/** 语音消息项 */
export interface WeixinVoiceItem {
  media?: CDNMedia;
  /** 语音编码类型：1=pcm 2=adpcm 3=feature 4=speex 5=amr 6=silk 7=mp3 8=ogg-speex */
  encode_type?: number;
  bits_per_sample?: number;
  /** 采样率 (Hz) */
  sample_rate?: number;
  /** 语音长度 (毫秒) */
  playtime?: number;
  /** 语音转文字内容 — 平台侧 ASR 结果 */
  text?: string;
}

/** 文件消息项 */
export interface WeixinFileItem {
  media?: CDNMedia;
  file_name?: string;
  md5?: string;
  len?: string;
}

/** 视频消息项 */
export interface WeixinVideoItem {
  media?: CDNMedia;
  video_size?: number;
  play_length?: number;
  video_md5?: string;
  thumb_media?: CDNMedia;
  thumb_size?: number;
  thumb_height?: number;
  thumb_width?: number;
}

/** 引用消息 */
export interface WeixinRefMessage {
  message_item?: WeixinMessageItem;
  /** 引用摘要 */
  title?: string;
}

/** 消息项 — 支持文本 + 所有媒体类型 */
export interface WeixinMessageItem {
  type?: number;
  create_time_ms?: number;
  update_time_ms?: number;
  msg_id?: string;
  text_item?: WeixinTextItem;
  image_item?: WeixinImageItem;
  voice_item?: WeixinVoiceItem;
  file_item?: WeixinFileItem;
  video_item?: WeixinVideoItem;
  /** 引用/回复消息 */
  ref_msg?: WeixinRefMessage;
}

/** iLink 消息结构 */
export interface WeixinMessage {
  seq?: number;
  message_id?: number;
  from_user_id?: string;
  to_user_id?: string;
  /** 客户端消息 ID（发送时用于幂等性） */
  client_id?: string;
  create_time_ms?: number;
  session_id?: string;
  /** 1=USER, 2=BOT */
  message_type?: number;
  /** 0=NEW, 1=GENERATING, 2=FINISH */
  message_state?: number;
  item_list?: WeixinMessageItem[];
  /** 回复时必须回传 */
  context_token?: string;
}

// ---------------------------------------------------------------------------
// API 请求/响应
// ---------------------------------------------------------------------------

/** getUpdates 请求 */
export interface WeixinGetUpdatesReq {
  /** 上次响应返回的同步游标，首次传空字符串 */
  get_updates_buf?: string;
}

/** getUpdates 响应 */
export interface WeixinGetUpdatesResp {
  ret?: number;
  /** 错误码 (如 -14 = 会话超时) */
  errcode?: number;
  errmsg?: string;
  msgs?: WeixinMessage[];
  /** 新的同步游标 */
  get_updates_buf?: string;
  /** 服务端建议的下次长轮询超时 (ms) */
  longpolling_timeout_ms?: number;
}

/** sendMessage 请求 */
export interface WeixinSendMessageReq {
  msg?: WeixinMessage;
}

/** sendTyping 请求 */
export interface WeixinSendTypingReq {
  ilink_user_id?: string;
  typing_ticket?: string;
  /** 1=typing, 2=cancel */
  status?: number;
}

/** getConfig 响应 */
export interface WeixinGetConfigResp {
  ret?: number;
  errmsg?: string;
  /** base64 编码的 typing ticket */
  typing_ticket?: string;
}

/** QR 码获取响应 */
export interface WeixinQrCodeResp {
  /** QR 码字符串 (轮询状态用) */
  qrcode: string;
  /** QR 码图片 URL (展示给用户扫描) */
  qrcode_img_content: string;
}

/** QR 码状态响应 */
export interface WeixinQrStatusResp {
  status: 'wait' | 'scaned' | 'confirmed' | 'expired';
  bot_token?: string;
  ilink_bot_id?: string;
  baseurl?: string;
  ilink_user_id?: string;
}

/** 会话过期错误码 */
export const SESSION_EXPIRED_ERRCODE = -14;

// ---------------------------------------------------------------------------
// CDN 上传
// ---------------------------------------------------------------------------

/** 上传媒体类型 (与 WeixinItemType 编号不同) */
export const UploadMediaType = {
  IMAGE: 1,
  VIDEO: 2,
  FILE: 3,
  VOICE: 4,
} as const;

/** getUploadUrl 请求 */
export interface WeixinGetUploadUrlReq {
  filekey?: string;
  /** 媒体类型，见 UploadMediaType */
  media_type?: number;
  to_user_id?: string;
  /** 原文件明文大小 */
  rawsize?: number;
  /** 原文件明文 MD5 */
  rawfilemd5?: string;
  /** 原文件密文大小 (AES-128-ECB 加密后) */
  filesize?: number;
  /** 缩略图明文大小 (IMAGE/VIDEO 时必填) */
  thumb_rawsize?: number;
  /** 缩略图明文 MD5 (IMAGE/VIDEO 时必填) */
  thumb_rawfilemd5?: string;
  /** 缩略图密文大小 (IMAGE/VIDEO 时必填) */
  thumb_filesize?: number;
  /** 不需要缩略图上传 URL */
  no_need_thumb?: boolean;
  /** 加密 key */
  aeskey?: string;
}

/** getUploadUrl 响应 */
export interface WeixinGetUploadUrlResp {
  /** 原图上传加密参数 */
  upload_param?: string;
  /** 缩略图上传加密参数 */
  thumb_upload_param?: string;
}

/** 上传完成后的媒体信息 */
export interface UploadedMediaInfo {
  /** CDN 下载用的加密查询参数 */
  downloadEncryptedQueryParam: string;
  /** AES-128 密钥 (hex 字符串) */
  aesKey: string;
  /** 文件唯一标识 */
  fileKey: string;
  /** 明文文件大小 */
  rawSize: number;
  /** 密文文件大小 */
  cipherSize: number;
  /** 明文 MD5 */
  md5: string;
}

/** 默认 CDN 基础 URL */
export const CDN_BASE_URL = 'https://novac2c.cdn.weixin.qq.com/c2c';
