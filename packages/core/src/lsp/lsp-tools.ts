/**
 * LSP 工具 -- 将 LSP 能力包装为 Agent 工具
 */

import type { ToolDefinition } from '../bridge/tool-injector.js';
import type { LspClient } from './lsp-client.js';

export function createLspTools(client: LspClient, serverName: string): ToolDefinition[] {
  const tools: ToolDefinition[] = [];

  if (client.capabilities.hoverProvider) {
    tools.push({
      name: `lsp_hover_${serverName}`,
      description: `查看代码符号的类型和文档 (${serverName} LSP)`,
      parameters: {
        type: 'object',
        properties: {
          uri: { type: 'string', description: '文件 URI (file:///path/to/file)' },
          line: { type: 'number', description: '行号 (0-based)' },
          character: { type: 'number', description: '列号 (0-based)' },
        },
        required: ['uri', 'line', 'character'],
      },
      execute: async (args) => {
        const result = await client.hover(
          args['uri'] as string,
          args['line'] as number,
          args['character'] as number,
        );
        return result ?? '无 hover 信息';
      },
    });
  }

  if (client.capabilities.definitionProvider) {
    tools.push({
      name: `lsp_definition_${serverName}`,
      description: `跳转到符号定义 (${serverName} LSP)`,
      parameters: {
        type: 'object',
        properties: {
          uri: { type: 'string', description: '文件 URI' },
          line: { type: 'number', description: '行号 (0-based)' },
          character: { type: 'number', description: '列号 (0-based)' },
        },
        required: ['uri', 'line', 'character'],
      },
      execute: async (args) => {
        const result = await client.definition(
          args['uri'] as string,
          args['line'] as number,
          args['character'] as number,
        );
        return result ? JSON.stringify(result, null, 2) : '未找到定义';
      },
    });
  }

  if (client.capabilities.referencesProvider) {
    tools.push({
      name: `lsp_references_${serverName}`,
      description: `查找符号的所有引用 (${serverName} LSP)`,
      parameters: {
        type: 'object',
        properties: {
          uri: { type: 'string', description: '文件 URI' },
          line: { type: 'number', description: '行号 (0-based)' },
          character: { type: 'number', description: '列号 (0-based)' },
        },
        required: ['uri', 'line', 'character'],
      },
      execute: async (args) => {
        const result = await client.references(
          args['uri'] as string,
          args['line'] as number,
          args['character'] as number,
        );
        return result?.length ? JSON.stringify(result, null, 2) : '未找到引用';
      },
    });
  }

  return tools;
}
