/**
 * /remember <text> — 用户兜底命令：把一条记忆即时写入 DB
 *
 * 走和 LLM 工具 memory_write 相同的底层逻辑（INSERT INTO memory_units），
 * 但绕过 LLM，让用户在 Agent 没主动调用 memory_write 时也能强制记一笔。
 */

import crypto from 'node:crypto';
import type { ChannelCommand } from '../types.js';

const USAGE = '用法：/remember <要记住的内容>\n例：/remember 我女儿叫小满，5月3日生日';

export const rememberCommand: ChannelCommand = {
  name: 'remember',
  aliases: ['记住', 'remember'],
  description: '把一条新记忆即时写入 Agent 记忆库',
  async execute(args, ctx) {
    const text = args.trim();
    if (!text) {
      return { handled: true, response: USAGE };
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    // l0 取前 80 字作为检索锚点；l1/l2 用全文
    const l0Index = text.length > 80 ? text.slice(0, 80) + '…' : text;
    const l1Overview = text;
    const l2Content = text;

    // 默认 preference 类别（merge 语义），与 memory_write 工具一致
    const category = 'preference';
    const mergeType = 'merge';
    const mergeKey = `${category}:${l0Index.slice(0, 32)}`;

    ctx.store.run(
      `INSERT INTO memory_units (
        id, agent_id, category, merge_type, merge_key,
        l0_index, l1_overview, l2_content,
        confidence, activation, access_count,
        visibility, source_session_key,
        created_at, updated_at, archived_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      ctx.agentId,
      category,
      mergeType,
      mergeKey,
      l0Index,
      l1Overview,
      l2Content,
      0.95, // 用户显式命令，最高置信度
      1.0,
      0,
      'private',
      null,
      now,
      now,
      null,
    );

    return {
      handled: true,
      response: `已记住（id=${id}）：${l0Index}`,
    };
  },
};
