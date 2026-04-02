/**
 * Agent 独立记忆 — 按类型持久化
 *
 * 参考 Claude Code:
 *   ~/.claude/agent-memory/<agentType>/MEMORY.md
 *
 * EvoClaw:
 *   ~/.evoclaw/agent-memory/<agentType>/MEMORY.md
 *
 * 每种预定义子 Agent 类型有独立的持久记忆目录。
 * 子 Agent 启动时加载该类型的记忆，完成后可写回。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DEFAULT_DATA_DIR } from '@evoclaw/shared';

const AGENT_MEMORY_DIR = path.join(os.homedir(), DEFAULT_DATA_DIR, 'agent-memory');

/**
 * 获取指定 Agent 类型的记忆目录路径
 */
export function getAgentMemoryDir(agentType: string): string {
  return path.join(AGENT_MEMORY_DIR, agentType);
}

/**
 * 读取指定 Agent 类型的持久记忆
 * @returns MEMORY.md 内容，不存在则返回 null
 */
export function readAgentMemory(agentType: string): string | null {
  const memoryPath = path.join(getAgentMemoryDir(agentType), 'MEMORY.md');
  try {
    return fs.readFileSync(memoryPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * 写入指定 Agent 类型的持久记忆
 */
export function writeAgentMemory(agentType: string, content: string): void {
  const dir = getAgentMemoryDir(agentType);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'MEMORY.md'), content, 'utf-8');
}

/**
 * 追加到指定 Agent 类型的持久记忆
 */
export function appendAgentMemory(agentType: string, content: string): void {
  const existing = readAgentMemory(agentType) ?? '';
  writeAgentMemory(agentType, existing + '\n' + content);
}
