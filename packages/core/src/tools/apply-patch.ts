/**
 * apply_patch 工具 — 多文件统一 diff 格式
 * 格式参考 OpenClaw 的 *** Begin Patch / *** End Patch
 */

import fs from 'node:fs';
import path from 'node:path';
import type { ToolDefinition } from '../bridge/tool-injector.js';

/** 补丁条目 */
export interface PatchEntry {
  action: 'update' | 'add' | 'delete';
  filePath: string;
  /** update 操作的内容行（+/-/空格前缀） */
  lines: string[];
}

/** 应用结果 */
export interface PatchResult {
  applied: string[];
  failed: Array<{ file: string; error: string }>;
}

/** 禁止的路径模式 */
const FORBIDDEN_PATTERNS = [
  /\.\.\//,           // 路径穿越
  /node_modules\//,   // node_modules
  /\.env$/,           // 环境变量文件
];

/** 创建 apply_patch 工具 */
export function createApplyPatchTool(): ToolDefinition {
  return {
    name: 'apply_patch',
    description: `应用多文件统一补丁。支持文件的新增、修改和删除操作。格式示例：

*** Begin Patch
*** Update File: src/foo.ts
 context line
-old line
+new line

*** Add File: src/new.ts
+line 1
+line 2

*** Delete File: src/old.ts
*** End Patch`,
    parameters: {
      type: 'object',
      properties: {
        patch: { type: 'string', description: '补丁内容（*** Begin Patch ... *** End Patch 格式）' },
      },
      required: ['patch'],
    },
    execute: async (args) => {
      const patchText = args['patch'] as string;
      if (!patchText) return '错误：缺少 patch 参数';

      try {
        const entries = parsePatch(patchText);
        if (entries.length === 0) {
          return '错误：未解析到任何补丁条目。请检查格式是否正确。';
        }

        const result = applyPatch(entries);
        return formatResult(result);
      } catch (err) {
        return `补丁应用失败: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  };
}

/**
 * 解析补丁文本为条目列表
 */
export function parsePatch(text: string): PatchEntry[] {
  const entries: PatchEntry[] = [];
  const lines = text.split('\n');

  let current: PatchEntry | null = null;

  for (const line of lines) {
    // 跳过 Begin/End 标记
    if (/^\*\*\*\s*Begin\s*Patch/i.test(line)) continue;
    if (/^\*\*\*\s*End\s*Patch/i.test(line)) continue;

    // 检测文件操作指令
    const updateMatch = line.match(/^\*\*\*\s*Update\s+File:\s*(.+)/i);
    const addMatch = line.match(/^\*\*\*\s*Add\s+File:\s*(.+)/i);
    const deleteMatch = line.match(/^\*\*\*\s*Delete\s+File:\s*(.+)/i);

    if (updateMatch) {
      if (current) entries.push(current);
      current = { action: 'update', filePath: updateMatch[1]!.trim(), lines: [] };
    } else if (addMatch) {
      if (current) entries.push(current);
      current = { action: 'add', filePath: addMatch[1]!.trim(), lines: [] };
    } else if (deleteMatch) {
      if (current) entries.push(current);
      entries.push({ action: 'delete', filePath: deleteMatch[1]!.trim(), lines: [] });
      current = null;
    } else if (current) {
      current.lines.push(line);
    }
  }

  if (current) entries.push(current);
  return entries;
}

/**
 * 应用补丁条目列表
 */
export function applyPatch(entries: PatchEntry[]): PatchResult {
  const result: PatchResult = { applied: [], failed: [] };

  for (const entry of entries) {
    // 安全检查
    const forbidden = FORBIDDEN_PATTERNS.find(p => p.test(entry.filePath));
    if (forbidden) {
      result.failed.push({ file: entry.filePath, error: `禁止操作的路径: ${entry.filePath}` });
      continue;
    }

    try {
      switch (entry.action) {
        case 'add':
          applyAdd(entry);
          result.applied.push(`✅ 新增: ${entry.filePath}`);
          break;
        case 'delete':
          applyDelete(entry);
          result.applied.push(`✅ 删除: ${entry.filePath}`);
          break;
        case 'update':
          applyUpdate(entry);
          result.applied.push(`✅ 修改: ${entry.filePath}`);
          break;
      }
    } catch (err) {
      result.failed.push({
        file: entry.filePath,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}

/** 新增文件 */
function applyAdd(entry: PatchEntry): void {
  const content = entry.lines
    .map(line => line.startsWith('+') ? line.slice(1) : line)
    .join('\n');

  const dir = path.dirname(entry.filePath);
  if (dir && !fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(entry.filePath, content, 'utf-8');
}

/** 删除文件 */
function applyDelete(entry: PatchEntry): void {
  if (!fs.existsSync(entry.filePath)) {
    throw new Error(`文件不存在: ${entry.filePath}`);
  }
  fs.unlinkSync(entry.filePath);
}

/** 修改文件（context 匹配定位） */
function applyUpdate(entry: PatchEntry): void {
  if (!fs.existsSync(entry.filePath)) {
    throw new Error(`文件不存在: ${entry.filePath}`);
  }

  const originalContent = fs.readFileSync(entry.filePath, 'utf-8');
  const originalLines = originalContent.split('\n');

  // 解析 hunks
  const hunks = parseHunks(entry.lines);
  if (hunks.length === 0) {
    throw new Error('未找到有效的修改内容');
  }

  // 从后往前应用 hunks（避免行号偏移）
  let resultLines = [...originalLines];
  const sortedHunks = [...hunks].reverse();

  for (const hunk of sortedHunks) {
    const matchIdx = findHunkPosition(resultLines, hunk.context, hunk.removes);
    if (matchIdx === -1) {
      throw new Error(`无法定位修改位置。上下文不匹配:\n  ${hunk.context.join('\n  ')}`);
    }

    // 构建替换内容
    const oldLength = hunk.context.length + hunk.removes.length;
    const newLines = [...hunk.context, ...hunk.adds, ...hunk.contextAfter];
    resultLines.splice(matchIdx, oldLength + hunk.contextAfter.length, ...newLines);
  }

  fs.writeFileSync(entry.filePath, resultLines.join('\n'), 'utf-8');
}

/** Hunk 结构 */
interface Hunk {
  context: string[];      // 上文匹配行
  removes: string[];      // 要删除的行
  adds: string[];         // 要添加的行
  contextAfter: string[]; // 下文匹配行
}

/** 从 diff 行解析 hunks */
export function parseHunks(lines: string[]): Hunk[] {
  const hunks: Hunk[] = [];
  let current: Hunk | null = null;
  let phase: 'context' | 'changes' | 'after' = 'context';

  for (const line of lines) {
    if (line === '') continue; // 跳过空行

    if (line.startsWith('-')) {
      if (!current) current = { context: [], removes: [], adds: [], contextAfter: [] };
      phase = 'changes';
      current.removes.push(line.slice(1));
    } else if (line.startsWith('+')) {
      if (!current) current = { context: [], removes: [], adds: [], contextAfter: [] };
      phase = 'changes';
      current.adds.push(line.slice(1));
    } else if (line.startsWith(' ') || line === '') {
      const content = line.startsWith(' ') ? line.slice(1) : line;
      if (!current) {
        current = { context: [], removes: [], adds: [], contextAfter: [] };
        phase = 'context';
      }

      if (phase === 'context') {
        current.context.push(content);
      } else {
        // changes 后面的上下文行 → 属于当前 hunk 的 after context
        current.contextAfter.push(content);
        // 如果 after 累计了 3 行，结束当前 hunk
        if (current.contextAfter.length >= 3) {
          hunks.push(current);
          current = { context: [...current.contextAfter], removes: [], adds: [], contextAfter: [] };
          phase = 'context';
          current.context = [];
        }
      }
    }
  }

  if (current && (current.removes.length > 0 || current.adds.length > 0)) {
    hunks.push(current);
  }

  return hunks;
}

/** 在文件行中查找 hunk 位置 */
function findHunkPosition(fileLines: string[], context: string[], removes: string[]): number {
  const matchLines = [...context, ...removes];
  if (matchLines.length === 0) return -1;

  outer:
  for (let i = 0; i <= fileLines.length - matchLines.length; i++) {
    for (let j = 0; j < matchLines.length; j++) {
      if (fileLines[i + j]?.trim() !== matchLines[j]?.trim()) {
        continue outer;
      }
    }
    return i;
  }

  return -1;
}

/** 格式化应用结果 */
function formatResult(result: PatchResult): string {
  const parts: string[] = [];

  if (result.applied.length > 0) {
    parts.push(`成功应用 ${result.applied.length} 个操作：\n${result.applied.join('\n')}`);
  }

  if (result.failed.length > 0) {
    const failures = result.failed.map(f => `❌ ${f.file}: ${f.error}`).join('\n');
    parts.push(`${result.failed.length} 个操作失败：\n${failures}`);
  }

  return parts.join('\n\n') || '无操作可执行。';
}
