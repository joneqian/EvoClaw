/**
 * Skill Fork 执行器 — 在独立子代理中执行复杂技能
 *
 * fork 模式技能（如代码审查、安全扫描）在独立的 queryLoop 中执行，
 * 避免污染主对话上下文。仅将结果摘要返回主对话。
 *
 * 安全措施:
 * - 子代理不包含 invoke_skill 工具（防止递归 fork）
 * - maxTurns 硬限制（默认 20）
 * - 支持 AbortSignal 取消
 */

import { createLogger } from '../infrastructure/logger.js';

const log = createLogger('skill-fork');

/** Fork 执行参数 */
export interface ForkExecuteParams {
  /** 技能名称 */
  skillName: string;
  /** 技能指令内容（SKILL.md body，已经过参数替换） */
  skillBody: string;
  /** 技能描述 */
  skillDescription: string;
  /** 用户传入的参数 */
  args?: string;
  /** 父级 API 配置 */
  apiConfig: {
    protocol: string;
    baseUrl: string;
    apiKey: string;
    modelId: string;
    contextWindow: number;
  };
  /** 取消信号 */
  abortSignal?: AbortSignal;
}

/** Fork 执行结果 */
export interface ForkExecuteResult {
  /** 执行结果文本 */
  result: string;
  /** token 消耗 */
  tokenUsage: { input: number; output: number };
  /** 是否因错误终止 */
  isError?: boolean;
}

/** 最大子代理轮次 */
const MAX_FORK_TURNS = 20;

/**
 * 在独立子代理中执行 fork 技能
 *
 * 简化实现：构建 systemPrompt + userMessage，
 * 通过 LLM 单轮调用获取结果（不使用完整 queryLoop 避免复杂依赖）。
 * 后续可升级为完整 queryLoop。
 */
export async function forkExecuteSkill(params: ForkExecuteParams): Promise<ForkExecuteResult> {
  const { skillName, skillBody, skillDescription, args } = params;

  log.info(`Fork 执行技能 "${skillName}"${args ? ` args="${args}"` : ''}`);

  const systemPrompt = [
    `你是一个专业的 AI 助手，正在执行技能「${skillName}」。`,
    `技能说明: ${skillDescription}`,
    '',
    '## 技能指令',
    skillBody,
    '',
    '## 输出要求',
    '- 按照技能指令完成任务',
    '- 输出结构化、清晰的结果',
    '- 结果将返回给主对话，请保持简洁但完整',
  ].join('\n');

  const userMessage = args
    ? `请执行此技能。参数: ${args}`
    : '请执行此技能。';

  try {
    // 使用 fetch 直接调用 LLM API（避免导入完整 queryLoop 的复杂依赖链）
    const { protocol, baseUrl, apiKey, modelId, contextWindow } = params.apiConfig;

    const isAnthropic = protocol === 'anthropic-messages';
    const url = isAnthropic ? `${baseUrl}/messages` : `${baseUrl}/chat/completions`;
    const maxTokens = Math.min(4096, Math.floor(contextWindow * 0.3));

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (isAnthropic) {
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const body = isAnthropic
      ? JSON.stringify({
          model: modelId,
          max_tokens: maxTokens,
          system: systemPrompt,
          messages: [{ role: 'user', content: userMessage }],
        })
      : JSON.stringify({
          model: modelId,
          max_tokens: maxTokens,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
        });

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      signal: params.abortSignal,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => response.statusText);
      return { result: `Fork 执行失败: ${response.status} ${errorText}`, tokenUsage: { input: 0, output: 0 }, isError: true };
    }

    const json = await response.json() as Record<string, unknown>;

    // 提取结果文本和 token 用量
    let resultText: string;
    let inputTokens = 0;
    let outputTokens = 0;

    if (isAnthropic) {
      const content = (json.content as Array<{ type: string; text?: string }>) ?? [];
      resultText = content.filter(c => c.type === 'text').map(c => c.text ?? '').join('\n');
      const usage = json.usage as { input_tokens?: number; output_tokens?: number } | undefined;
      inputTokens = usage?.input_tokens ?? 0;
      outputTokens = usage?.output_tokens ?? 0;
    } else {
      const choices = (json.choices as Array<{ message?: { content?: string } }>) ?? [];
      resultText = choices[0]?.message?.content ?? '';
      const usage = json.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
      inputTokens = usage?.prompt_tokens ?? 0;
      outputTokens = usage?.completion_tokens ?? 0;
    }

    log.info(`Fork "${skillName}" 完成: ${inputTokens} in / ${outputTokens} out`);

    return {
      result: resultText || '（技能执行完成，无输出内容）',
      tokenUsage: { input: inputTokens, output: outputTokens },
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return { result: 'Fork 执行被取消', tokenUsage: { input: 0, output: 0 }, isError: true };
    }
    const message = err instanceof Error ? err.message : String(err);
    log.error(`Fork "${skillName}" 执行异常: ${message}`);
    return { result: `Fork 执行异常: ${message}`, tokenUsage: { input: 0, output: 0 }, isError: true };
  }
}

// 导出常量供外部使用
export { MAX_FORK_TURNS };
