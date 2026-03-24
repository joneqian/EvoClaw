/**
 * 占位工具 -- 暂未实现的工具，提供友好提示
 */

import type { ToolDefinition } from '../bridge/tool-injector.js';

/** 创建占位工具 */
function createPlaceholderTool(name: string, description: string): ToolDefinition {
  return {
    name,
    description: `[暂未实现] ${description}`,
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', description: '操作类型' },
      },
    },
    execute: async () => {
      return `工具 "${name}" 暂未实现，将在后续版本中支持。`;
    },
  };
}

export const placeholderCanvasTool = createPlaceholderTool('canvas', 'UI Canvas 控制');
export const placeholderGatewayTool = createPlaceholderTool('gateway', '网关控制');
export const placeholderNodesTool = createPlaceholderTool('nodes', '设备控制 (iOS/Android)');
