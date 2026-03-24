/**
 * tts 工具 -- 文本转语音
 * 调用 OpenAI TTS API 或兼容接口
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ToolDefinition } from '../bridge/tool-injector.js';

interface TtsConfig {
  apiKey: string;
  baseUrl?: string;
}

export function createTtsTool(config: TtsConfig): ToolDefinition {
  return {
    name: 'tts',
    description: '文本转语音：将文本转换为音频文件。需要 OpenAI 或兼容的 TTS API。',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string', description: '要转换的文本' },
        voice: {
          type: 'string',
          enum: ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'],
          description: '语音角色（默认 alloy）',
        },
        speed: { type: 'number', description: '语速 0.25-4.0（默认 1.0）' },
      },
      required: ['text'],
    },
    execute: async (args) => {
      const text = args['text'] as string;
      const voice = (args['voice'] as string) ?? 'alloy';
      const speed = (args['speed'] as number) ?? 1.0;

      if (!config.apiKey) return '错误：未配置 API Key，无法使用 TTS';

      try {
        const baseUrl = (config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');

        const response = await fetch(`${baseUrl}/audio/speech`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${config.apiKey}`,
          },
          body: JSON.stringify({
            model: 'tts-1',
            input: text,
            voice,
            speed: Math.max(0.25, Math.min(4.0, speed)),
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) {
          return `TTS 失败: HTTP ${response.status}`;
        }

        const outputDir = '/tmp/evoclaw-tts';
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
        const outputPath = path.join(outputDir, `tts-${Date.now()}.mp3`);

        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(outputPath, buffer);

        return `音频已生成: ${outputPath} (${Math.round(buffer.length / 1024)}KB)`;
      } catch (err) {
        return `TTS 失败: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}
