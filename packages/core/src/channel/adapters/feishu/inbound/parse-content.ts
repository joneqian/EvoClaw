/**
 * 飞书入站消息 content 解析
 *
 * 不同 msg_type 的 content JSON 结构不同，这里把它们统一提取为：
 * - text: 给 LLM 的可读文本
 * - mediaKey: 图片 / 文件 / 音频 / 视频的 key（用于后续下载）
 * - mediaSource: 'image' (image.create 上传的) 还是 'file' (file.create 上传的)
 *
 * 参考：https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/im-v1/message-content
 */

import { parsePostContent } from '../outbound/post-to-text.js';

/** 解析结果 */
export interface ParsedFeishuContent {
  /** 可读文本（空串表示无可显示文本） */
  text: string;
  /** 媒体 key（仅 image/file/audio/media 消息） */
  mediaKey?: string;
  /** 媒体来源接口（决定 message_resource.get 的 type 参数） */
  mediaSource?: 'image' | 'file';
  /** 附加信息（如原文件名，可帮助 LLM 理解） */
  fileName?: string;
}

/** 安全 parse JSON，失败返回 null */
function safeParse<T>(content: string): T | null {
  try {
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

/** 按 msg_type 解析 content */
export function parseFeishuContent(msgType: string, content: string): ParsedFeishuContent {
  switch (msgType) {
    case 'text': {
      const data = safeParse<{ text?: string }>(content);
      return { text: data?.text ?? content };
    }
    case 'post': {
      return { text: parsePostContent(content) };
    }
    case 'image': {
      const data = safeParse<{ image_key?: string }>(content);
      return {
        text: '[图片]',
        mediaKey: data?.image_key,
        mediaSource: 'image',
      };
    }
    case 'file': {
      const data = safeParse<{ file_key?: string; file_name?: string }>(content);
      const label = data?.file_name ? `[文件: ${data.file_name}]` : '[文件]';
      return {
        text: label,
        mediaKey: data?.file_key,
        mediaSource: 'file',
        fileName: data?.file_name,
      };
    }
    case 'audio': {
      const data = safeParse<{ file_key?: string; duration?: number }>(content);
      const label = data?.duration ? `[语音, ${data.duration}ms]` : '[语音]';
      return {
        text: label,
        mediaKey: data?.file_key,
        mediaSource: 'file',
      };
    }
    case 'media': {
      const data = safeParse<{ file_key?: string; file_name?: string; duration?: number }>(content);
      const label = data?.file_name ? `[视频: ${data.file_name}]` : '[视频]';
      return {
        text: label,
        mediaKey: data?.file_key,
        mediaSource: 'file',
        fileName: data?.file_name,
      };
    }
    case 'sticker': {
      const data = safeParse<{ file_key?: string }>(content);
      return {
        text: '[贴纸]',
        mediaKey: data?.file_key,
        mediaSource: 'file',
      };
    }
    case 'interactive': {
      // 卡片消息入站较少见（一般是机器人自己发），PR3 的审批卡也会复用
      const data = safeParse<{ title?: string; elements?: unknown }>(content);
      const title = data?.title ? `「${data.title}」` : '';
      return { text: `[交互卡片]${title}` };
    }
    case 'merge_forward': {
      // 合并转发：简要呈现条数即可，LLM 看不到子消息内容
      const data = safeParse<{ content?: unknown[] }>(content);
      const n = Array.isArray(data?.content) ? data.content.length : 0;
      return { text: `[合并转发，${n} 条]` };
    }
    case 'share_chat': {
      const data = safeParse<{ chat_id?: string }>(content);
      return { text: data?.chat_id ? `[分享群: ${data.chat_id}]` : '[分享群]' };
    }
    default: {
      // 未知类型：返回原始 content 便于排查
      return { text: `[${msgType}] ${content}` };
    }
  }
}
