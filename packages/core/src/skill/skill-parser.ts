/**
 * SKILL.md 解析器 — 从 SKILL.md 文件解析 YAML frontmatter + Markdown body
 *
 * SKILL.md body 本身就是指令内容（没有独立 prompt.md）。
 */

import type { SkillMetadata } from '@evoclaw/shared';
import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('skill-parser');

/** SKILL.md 解析结果 */
export interface ParsedSkill {
  metadata: SkillMetadata;
  /** Markdown body（即指令内容） */
  body: string;
}

/** 解析 SKILL.md 内容 */
export function parseSkillMd(content: string): ParsedSkill | null {
  const trimmed = content.trim();
  if (!trimmed) return null;

  // 尝试解析 YAML frontmatter（--- 分隔）
  const fmMatch = trimmed.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);

  if (!fmMatch) {
    // 没有 frontmatter，不是有效的 SKILL.md
    return null;
  }

  const yamlRaw = fmMatch[1];
  const body = fmMatch[2].trim();

  const metadata = parseYamlFrontmatter(yamlRaw);
  if (!metadata) return null;

  // name 和 description 必需
  if (!metadata.name || !metadata.description) return null;

  // G2 认知对齐：inline 模式下 allowedTools 不会被运行时消费，打 warn 提醒用户
  // executionMode 缺省为 inline
  const isInline = !metadata.executionMode || metadata.executionMode === 'inline';
  if (isInline && metadata.allowedTools && metadata.allowedTools.length > 0) {
    log.warn(
      `技能 "${metadata.name}" 声明了 allowed-tools 但执行模式为 inline — ` +
      `该字段当前仅在 fork 模式下生效，inline 模式不会注入自动放行规则。` +
      `如需生效请设置 execution-mode: fork，或等待 inline contextModifier 运行时注入（P1 增强）。`,
    );
  }

  return { metadata, body };
}

/** 简单 YAML frontmatter 解析（不引入 YAML 库） */
function parseYamlFrontmatter(yaml: string): SkillMetadata | null {
  try {
    const result: Record<string, unknown> = {};
    const lines = yaml.split('\n');
    let currentKey = '';
    let currentList: string[] | null = null;
    /** YAML 折叠块(>) 或字面量块(|) 的累积行 */
    let blockLines: string[] | null = null;
    let blockStyle: '>' | '|' | null = null;

    const flushBlock = () => {
      if (blockLines && currentKey) {
        result[currentKey] = blockStyle === '>'
          ? blockLines.join(' ').trim()   // 折叠块：行合并为一行
          : blockLines.join('\n').trim(); // 字面量块：保留换行
      }
      blockLines = null;
      blockStyle = null;
    };

    const flushList = () => {
      if (currentList) {
        result[currentKey] = currentList;
        currentList = null;
      }
    };

    for (const line of lines) {
      // 跳过空行和注释（但折叠块内的空行需保留）
      if (!line.trim() || line.trim().startsWith('#')) {
        if (blockLines !== null) blockLines.push('');
        continue;
      }

      // 折叠/字面量块的续行（缩进行）
      if (blockLines !== null) {
        if (/^\s+/.test(line)) {
          blockLines.push(line.trim());
          continue;
        }
        // 非缩进行 → 块结束
        flushBlock();
      }

      // 列表项
      const listMatch = line.match(/^\s+-\s+(.+)$/);
      if (listMatch && currentList) {
        currentList.push(listMatch[1].trim());
        continue;
      }

      // 保存前一个列表
      flushList();

      // 键值对
      const kvMatch = line.match(/^(\S+)\s*:\s*(.*)$/);
      if (kvMatch) {
        currentKey = kvMatch[1];
        const value = kvMatch[2].trim();

        if (!value) {
          // 可能是列表的开始
          currentList = [];
        } else if (value === '>' || value === '|') {
          // YAML 折叠块(>) 或字面量块(|)
          blockStyle = value as '>' | '|';
          blockLines = [];
        } else if (value === 'true') {
          result[currentKey] = true;
        } else if (value === 'false') {
          result[currentKey] = false;
        } else {
          // 去掉引号
          result[currentKey] = value.replace(/^["']|["']$/g, '');
        }
      }
    }

    // 保存最后的块或列表
    flushBlock();
    flushList();

    // 映射到 SkillMetadata
    const metadata: SkillMetadata = {
      name: String(result['name'] ?? ''),
      description: String(result['description'] ?? ''),
    };

    if (result['version']) metadata.version = String(result['version']);
    if (result['author']) metadata.author = String(result['author']);
    if (result['compatibility']) {
      const compat = String(result['compatibility']);
      metadata.compatibility = compat.slice(0, 500); // 最多 500 字符
    }
    if (Array.isArray(result['allowed-tools'])) {
      metadata.allowedTools = result['allowed-tools'] as string[];
    }
    if (result['disable-model-invocation'] === true) {
      metadata.disableModelInvocation = true;
    }
    if (result['execution-mode'] === 'fork' || result['execution-mode'] === 'inline') {
      metadata.executionMode = result['execution-mode'];
    }
    if (result['whenToUse'] || result['when-to-use']) {
      metadata.whenToUse = String(result['whenToUse'] ?? result['when-to-use']);
    }
    if (result['model']) {
      metadata.model = String(result['model']);
    }
    // G3: argument-hint 字段（填空式示例，面向非技术用户）
    if (result['argument-hint'] || result['argumentHint']) {
      metadata.argumentHint = String(result['argument-hint'] ?? result['argumentHint']);
    }
    // G3: arguments 字段（命名参数列表）
    if (Array.isArray(result['arguments'])) {
      metadata.arguments = result['arguments'] as string[];
    }

    // EvoClaw 扩展字段：requires
    if (result['requires'] || result['requires.bins'] || result['requires.env'] || result['requires.os']) {
      metadata.requires = {};
      // 支持 requires.bins / requires.env / requires.os 格式（平铺式）
      if (Array.isArray(result['requires.bins'])) metadata.requires.bins = result['requires.bins'] as string[];
      if (Array.isArray(result['requires.env'])) metadata.requires.env = result['requires.env'] as string[];
      if (Array.isArray(result['requires.os'])) metadata.requires.os = result['requires.os'] as string[];
    }

    return metadata;
  } catch {
    return null;
  }
}

/** 检测文件是否为 SKILL.md（根目录 .md 文件或子目录中的 SKILL.md） */
export function isSkillFile(filePath: string): boolean {
  const name = filePath.split('/').pop() ?? '';
  return name === 'SKILL.md' || (name.endsWith('.md') && !name.startsWith('.'));
}
