/**
 * Phase C5: 飞书文档协作系统提示注入单测
 *
 * 验证 buildSystemPromptBlocks 仅在装载了 feishu_read_doc 工具时引入
 * <feishu_doc_collab> 提示片段（避免非飞书 agent 看到无关指令）。
 */

import { describe, it, expect } from 'vitest';

import { buildSystemPromptBlocks } from '../../agent/embedded-runner-prompt.js';
import {
  FEISHU_DOC_COLLAB_PROMPT,
  hasFeishuDocTools,
} from '../../agent/prompts/feishu-doc-collab.js';
import type { AgentRunConfig } from '../../agent/types.js';
import type { ToolDefinition } from '../../bridge/tool-injector.js';

function makeConfig(tools: ToolDefinition[] = []): AgentRunConfig {
  return {
    agent: { id: 'a1', name: 'Test', mode: 'main' } as never,
    systemPrompt: '',
    workspaceFiles: {},
    modelId: 'claude-sonnet-4-6',
    provider: 'anthropic',
    apiKey: 'sk_test',
    baseUrl: 'https://api.anthropic.com',
    tools,
  };
}

function fakeTool(name: string): ToolDefinition {
  return {
    name,
    description: '',
    parameters: { type: 'object', properties: {} },
    execute: async () => '',
  };
}

describe('hasFeishuDocTools', () => {
  it('feishu_read_doc 存在 → true', () => {
    expect(hasFeishuDocTools(['feishu_send', 'feishu_read_doc'])).toBe(true);
  });

  it('仅其它飞书工具（无 read_doc）→ false', () => {
    expect(hasFeishuDocTools(['feishu_send', 'feishu_card', 'feishu_reply_comment'])).toBe(false);
  });

  it('完全没有飞书工具 → false', () => {
    expect(hasFeishuDocTools(['memory_search', 'todo_write'])).toBe(false);
  });
});

describe('buildSystemPromptBlocks — feishu_doc_collab 片段条件注入', () => {
  it('未装 feishu_read_doc 时不引入', () => {
    const blocks = buildSystemPromptBlocks(makeConfig([fakeTool('memory_search')]));
    expect(blocks.find((b) => b.label === 'feishu_doc_collab')).toBeUndefined();
    expect(blocks.some((b) => b.text.includes('Feishu 文档协作工作流'))).toBe(false);
  });

  it('装载 feishu_read_doc 时引入完整片段', () => {
    const blocks = buildSystemPromptBlocks(
      makeConfig([fakeTool('feishu_read_doc'), fakeTool('feishu_replace_block_text')]),
    );
    const block = blocks.find((b) => b.label === 'feishu_doc_collab');
    expect(block).toBeDefined();
    expect(block!.text).toBe(FEISHU_DOC_COLLAB_PROMPT);
    expect(block!.cacheControl).toEqual({ type: 'ephemeral', scope: 'global' });
  });

  it('片段内容覆盖关键工作流（先读后改 / 评论 vs 修改 / 230108 不重试 / 回评礼仪）', () => {
    expect(FEISHU_DOC_COLLAB_PROMPT).toContain('先读后改');
    expect(FEISHU_DOC_COLLAB_PROMPT).toContain('feishu_read_doc');
    expect(FEISHU_DOC_COLLAB_PROMPT).toContain('feishu_reply_comment');
    expect(FEISHU_DOC_COLLAB_PROMPT).toContain('feishu_replace_block_text');
    expect(FEISHU_DOC_COLLAB_PROMPT).toContain('230108');
    expect(FEISHU_DOC_COLLAB_PROMPT).toContain('documentRevisionId');
  });

  it('autonomous 模式（Cron/Heartbeat）也引入（agent 在自主回访 doc 时仍需要工作流指导）', () => {
    const blocks = buildSystemPromptBlocks(
      makeConfig([fakeTool('feishu_read_doc')]),
      'autonomous',
    );
    expect(blocks.find((b) => b.label === 'feishu_doc_collab')).toBeDefined();
  });

  it('fork 模式跳过（极简提示，子代理无需 channel 工作流）', () => {
    const blocks = buildSystemPromptBlocks(
      makeConfig([fakeTool('feishu_read_doc')]),
      'fork',
    );
    expect(blocks.find((b) => b.label === 'feishu_doc_collab')).toBeUndefined();
  });
});
