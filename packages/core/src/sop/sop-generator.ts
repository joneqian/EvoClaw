/**
 * SOP 标签草稿生成器
 *
 * 一次性 LLM 调用：把上传的 SOP 文档拼成 prompt → 让模型直接产出 JSON 标签树 →
 * 解析 + zod 校验 → 持久化到 draft.json。
 *
 * 不走 agent loop / 工具调用 / 流式（避免 60s auto-background 和 idleTimeout 的坑），
 * 一次 callLLM 调用，最多重试 1 次（带错误信息让模型修正格式）。
 */

import { validateTagsPayload, formatZodError } from './sop-schema.js';
import type { SopParentTagT } from './sop-schema.js';

/** LLM 调用函数签名 — 与 llm-client.ts 的 LLMCallFn 兼容 */
export type LLMCallFn = (system: string, user: string) => Promise<string>;

export interface SopDocInput {
  name: string;
  text: string;
}

export interface GenerateOptions {
  llmCall: LLMCallFn;
  docs: SopDocInput[];
  /** 用户补充指令（如"加上售前阶段"） */
  instruction?: string;
  /** 已有草稿（refinement 场景） */
  existingDraft?: SopParentTagT[];
  /** 已确认标签（避免重复设计） */
  existingTags?: SopParentTagT[];
}

export interface GenerateResult {
  tags: SopParentTagT[];
  /** 原始 LLM 响应（调试用） */
  rawResponse: string;
  /** 重试次数（0 = 一次成功） */
  retryCount: number;
}

const SYSTEM_PROMPT = `你是 SOP 客户旅程标签设计师。任务：阅读用户上传的客户服务标准操作流程（SOP）文档，产出一份**客户旅程标签树** JSON。

# 标签结构（最多两级）

- **父标签**：客户旅程阶段（按时间顺序），只有 \`name\` 和 \`children\` 两个字段
- **子标签**：阶段下的细分场景，有 4 个非空字符串字段：
  - \`name\`：标签名称（4-10 个汉字）
  - \`meaning\`：什么样的客户属于此标签（1-2 句话）
  - \`mustDo\`：在此标签下必须做/说什么（具体可执行的动作）
  - \`mustNotDo\`：在此标签下禁止做/说什么（具体可避免的动作）

# 强制约束

- 最多两级。子标签**不能**再嵌套 children。
- 父标签**不能**有 meaning/mustDo/mustNotDo。
- 每个父标签至少 1 个子标签。
- 父标签 3-7 个最佳，每个父级 2-5 个子标签为宜。
- 所有字段必须是非空字符串，使用中文。
- mustDo / mustNotDo 必须是**可观察的具体动作**，不能是"积极沟通""认真服务"这种空话。

# 输出格式（极其重要）

**只输出原始 JSON 数组，不要任何其他文字**。不要 markdown 代码围栏，不要解释，不要 "好的"，不要 "以下是"。直接以 \`[\` 开头，以 \`]\` 结尾。

JSON Schema:

\`\`\`
[
  {
    "name": "string",
    "children": [
      {
        "name": "string",
        "meaning": "string",
        "mustDo": "string",
        "mustNotDo": "string"
      }
    ]
  }
]
\`\`\`

# 示例输出（仅展示格式，不要照抄内容）

[{"name":"咨询阶段","children":[{"name":"首次咨询","meaning":"客户首次接触，尚未建立信任","mustDo":"主动问候，快速回应，收集基础信息","mustNotDo":"直接推销产品，使用专业术语"}]}]
`;

/** 主入口：生成 SOP 标签草稿 */
export async function generateSopDraft(
  opts: GenerateOptions,
): Promise<GenerateResult> {
  if (opts.docs.length === 0) {
    throw new Error('没有可用的 SOP 文档，请先上传至少一份');
  }

  const userPrompt = buildUserPrompt(opts);
  let lastError = '';
  let lastRaw = '';

  // 最多 2 次（首次 + 重试 1 次）
  for (let attempt = 0; attempt < 2; attempt++) {
    const promptForThisAttempt = attempt === 0
      ? userPrompt
      : `${userPrompt}\n\n## ⚠️ 上一次输出格式错误\n\n错误信息: ${lastError}\n\n上一次返回的原始内容（前 500 字符）：\n${lastRaw.slice(0, 500)}\n\n请严格按照 system 中要求的 JSON 格式重新输出，不要任何 markdown 围栏或解释文字。`;

    const raw = await opts.llmCall(SYSTEM_PROMPT, promptForThisAttempt);
    lastRaw = raw;

    const parsed = parseAndValidate(raw);
    if (parsed.success) {
      return {
        tags: parsed.tags,
        rawResponse: raw,
        retryCount: attempt,
      };
    }
    lastError = parsed.error;
  }

  throw new Error(
    `LLM 输出无法解析为合法的 SOP 标签 JSON（已重试 1 次）。最后错误: ${lastError}。最后响应前 200 字符: ${lastRaw.slice(0, 200)}`,
  );
}

// ─── 内部辅助 ───

/** 构建用户消息 */
function buildUserPrompt(opts: GenerateOptions): string {
  const parts: string[] = [];

  parts.push('# SOP 文档清单');
  for (const doc of opts.docs) {
    parts.push(`\n========== ${doc.name} ==========\n${doc.text}`);
  }

  if (opts.existingDraft && opts.existingDraft.length > 0) {
    parts.push('\n# 当前草稿（请在此基础上完善）');
    parts.push(JSON.stringify(opts.existingDraft, null, 2));
  }

  if (opts.existingTags && opts.existingTags.length > 0) {
    parts.push('\n# 已确认的标签（避免重复，可参考但不要照抄）');
    parts.push(JSON.stringify(opts.existingTags, null, 2));
  }

  if (opts.instruction && opts.instruction.trim()) {
    parts.push(`\n# 用户补充要求\n${opts.instruction.trim()}`);
  }

  parts.push('\n# 任务\n基于以上文档设计客户旅程标签 JSON。直接输出 JSON 数组，不要任何其他文字。');

  return parts.join('\n');
}

/** 解析 + 校验 LLM 响应 */
function parseAndValidate(
  raw: string,
):
  | { success: true; tags: SopParentTagT[] }
  | { success: false; error: string } {
  // 1. 剥离 markdown 代码围栏
  const stripped = stripMarkdownFence(raw);

  // 2. 找出第一个 JSON 数组
  const jsonText = extractFirstJsonArray(stripped);
  if (!jsonText) {
    return { success: false, error: '响应中没有找到 JSON 数组' };
  }

  // 3. parse
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return {
      success: false,
      error: `JSON 解析失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 4. zod 校验
  const validation = validateTagsPayload(parsed);
  if (!validation.success) {
    return {
      success: false,
      error: `Schema 校验失败: ${validation.error}`,
    };
  }

  return { success: true, tags: validation.data };
}

/** 剥离 ```json ... ``` 或 ``` ... ``` 围栏 */
function stripMarkdownFence(text: string): string {
  const trimmed = text.trim();
  // 匹配 ```lang\n...\n``` 或 ```\n...\n```
  const fenceMatch = /^```(?:[a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  if (fenceMatch && fenceMatch[1]) {
    return fenceMatch[1].trim();
  }
  return trimmed;
}

/** 从文本中提取第一个完整的 JSON 数组（容错前后多余文字） */
function extractFirstJsonArray(text: string): string | null {
  const start = text.indexOf('[');
  if (start === -1) return null;

  // 简单括号匹配（考虑字符串内的 [ ] 不算）
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (escape) {
      escape = false;
      continue;
    }
    if (c === '\\') {
      escape = true;
      continue;
    }
    if (c === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (c === '[') depth++;
    else if (c === ']') {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }
  return null;
}

// 内部辅助导出，便于测试
export const _internal = {
  parseAndValidate,
  stripMarkdownFence,
  extractFirstJsonArray,
  buildUserPrompt,
  formatZodError,
};
