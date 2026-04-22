/**
 * 图片分析工具 — 绕过 PI 直接调用 vision API
 * 支持 Anthropic / OpenAI / Google 三家 provider
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ToolDefinition } from '../bridge/tool-injector.js';
import type { ProviderConfig } from './provider-direct.js';
import {
  supportsVision,
  callAnthropic,
  callGoogle,
  callOpenAI,
} from './provider-direct.js';

/** 最大图片大小 10MB */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** fetch 超时 15s */
const FETCH_TIMEOUT_MS = 15_000;

/** MIME 类型映射 */
const EXT_MIME_MAP: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
};

/** 从文件扩展名或 magic bytes 推断 MIME type */
export function detectMimeType(filePath: string, buffer?: Buffer): string {
  // 优先用扩展名
  const ext = path.extname(filePath).toLowerCase();
  if (EXT_MIME_MAP[ext]) return EXT_MIME_MAP[ext]!;

  // 尝试 magic bytes
  if (buffer && buffer.length >= 4) {
    if (buffer[0] === 0x89 && buffer[1] === 0x50) return 'image/png';
    if (buffer[0] === 0xFF && buffer[1] === 0xD8) return 'image/jpeg';
    if (buffer[0] === 0x47 && buffer[1] === 0x49) return 'image/gif';
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return 'image/webp';
  }

  return 'image/png'; // fallback
}

/** 创建 image 工具 */
export function createImageTool(config: ProviderConfig): ToolDefinition {
  return {
    name: 'image',
    description: '分析图片内容。支持本地文件路径或 HTTP/HTTPS URL。可以描述图片内容、分析架构图、识别文字等。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '图片的本地文件路径或 URL' },
        prompt: { type: 'string', description: '分析指令（默认：描述这张图片的内容）' },
      },
      required: ['path'],
    },
    execute: async (args) => {
      const imagePath = args['path'] as string;
      const prompt = (args['prompt'] as string) || '描述这张图片的内容';

      if (!imagePath) return '错误：缺少 path 参数';

      if (!supportsVision(config)) {
        return `错误：当前 provider "${config.provider}" / protocol "${config.apiProtocol ?? '未知'}" 不支持图片分析。请使用 anthropic / openai / google，或走 openai-completions 协议接入支持 vision 的模型（如 qwen3.6-plus）。`;
      }

      try {
        // 读取图片数据
        const { base64, mimeType } = await loadImage(imagePath);

        // 根据 provider 调用对应 API
        return await callVisionAPI(config, base64, mimeType, prompt);
      } catch (err) {
        return `图片分析失败: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

/** 加载图片为 base64 */
async function loadImage(imagePath: string): Promise<{ base64: string; mimeType: string }> {
  let buffer: Buffer;

  if (imagePath.startsWith('http://') || imagePath.startsWith('https://')) {
    // URL 下载
    const response = await fetch(imagePath, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new Error(`下载图片失败: HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    buffer = Buffer.from(arrayBuffer);
  } else {
    // 本地文件
    if (!fs.existsSync(imagePath)) {
      throw new Error(`文件不存在: ${imagePath}`);
    }
    buffer = fs.readFileSync(imagePath);
  }

  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error(`图片过大（${(buffer.length / 1024 / 1024).toFixed(1)}MB），最大 ${MAX_IMAGE_BYTES / 1024 / 1024}MB`);
  }

  const mimeType = detectMimeType(imagePath, buffer);
  const base64 = buffer.toString('base64');

  return { base64, mimeType };
}

/**
 * 根据 provider 调用 vision API
 *
 * anthropic / google 各自专有协议；openai 本家和所有走 openai-completions 协议
 * 的国产 provider（qwen / glm / minimax / doubao）统一走 OpenAI 兼容通道，
 * 共用 `{type: 'image_url', image_url: {url: 'data:...;base64,...'}}` 格式。
 */
async function callVisionAPI(
  config: ProviderConfig,
  base64: string,
  mimeType: string,
  prompt: string,
): Promise<string> {
  if (config.provider === 'anthropic') {
    return callAnthropic(config, [
      { type: 'image', source: { type: 'base64', media_type: mimeType, data: base64 } },
      { type: 'text', text: prompt },
    ]);
  }

  if (config.provider === 'google') {
    return callGoogle(config, [
      { inline_data: { mime_type: mimeType, data: base64 } },
      { text: prompt },
    ]);
  }

  // openai 本家 + 所有 openai-completions 兼容（qwen / glm / minimax / ...）
  return callOpenAI(config, [
    { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}` } },
    { type: 'text', text: prompt },
  ]);
}
