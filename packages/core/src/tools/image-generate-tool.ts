/**
 * image_generate 工具 — AI 图片生成
 * 调用 OpenAI DALL-E 或兼容 API 生成图片
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ToolDefinition } from '../bridge/tool-injector.js';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('image-generate');

/** 图片生成工具配置 */
export interface ImageGenerateConfig {
  apiKey: string;
  baseUrl?: string;
  provider?: string;
}

/** API 响应体结构 */
interface ImageGenerationResponse {
  data: Array<{ b64_json: string; revised_prompt?: string }>;
}

/** 生成超时 60s */
const GENERATE_TIMEOUT_MS = 60_000;

/** 创建 image_generate 工具 */
export function createImageGenerateTool(config: ImageGenerateConfig): ToolDefinition {
  return {
    name: 'image_generate',
    description: '使用 AI 生成图片。支持 DALL-E 和兼容 API。返回生成的图片文件路径。',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '图片描述（英文效果更好）' },
        size: {
          type: 'string',
          enum: ['256x256', '512x512', '1024x1024', '1024x1792', '1792x1024'],
          description: '图片尺寸（默认 1024x1024）',
        },
        quality: {
          type: 'string',
          enum: ['standard', 'hd'],
          description: '图片质量（默认 standard）',
        },
        style: {
          type: 'string',
          enum: ['vivid', 'natural'],
          description: '风格（默认 vivid）',
        },
      },
      required: ['prompt'],
    },
    execute: async (args) => {
      const prompt = args['prompt'] as string;
      const size = (args['size'] as string) ?? '1024x1024';
      const quality = (args['quality'] as string) ?? 'standard';
      const style = (args['style'] as string) ?? 'vivid';

      if (!prompt) return '错误：缺少 prompt 参数';
      if (!config.apiKey) return '错误：未配置 API Key，无法生成图片';

      try {
        const baseUrl = (config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');

        const response = await fetch(`${baseUrl}/images/generations`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: 'dall-e-3',
            prompt,
            n: 1,
            size,
            quality,
            style,
            response_format: 'b64_json',
          }),
          signal: AbortSignal.timeout(GENERATE_TIMEOUT_MS),
        });

        if (!response.ok) {
          const errBody = await response.text().catch(() => '');
          return `图片生成失败: HTTP ${response.status} ${errBody.slice(0, 200)}`;
        }

        const data = (await response.json()) as ImageGenerationResponse;
        const imageData = data.data?.[0];
        if (!imageData?.b64_json) return '图片生成失败: 无返回数据';

        // 保存到临时文件
        const outputDir = '/tmp/evoclaw-images';
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, `gen-${Date.now()}.png`);
        fs.writeFileSync(outputPath, Buffer.from(imageData.b64_json, 'base64'));

        log.info(`图片已生成: ${outputPath}`);

        const result = [`图片已生成: ${outputPath}`];
        if (imageData.revised_prompt) {
          result.push(`优化后的描述: ${imageData.revised_prompt}`);
        }
        return result.join('\n');
      } catch (err) {
        if (err instanceof Error && err.name === 'TimeoutError') {
          return `图片生成超时（${GENERATE_TIMEOUT_MS / 1000} 秒），请稍后重试。`;
        }
        return `图片生成失败: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
