/**
 * embedded-runner-prompt NO_REPLY 段单测（M13 修复 — 修改组 2）
 *
 * 覆盖：
 *   - inboundFromPeer=false（user @）→ Exception 段是"必回"（强制）
 *   - inboundFromPeer=true（peer @）→ Exception 段是"NO_REPLY allowed"（弹性）
 *   - mode='autonomous' → 不注入 silent_reply 段
 */

import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../../agent/embedded-runner-prompt.js';
import type { AgentRunConfig } from '../../agent/types.js';
import type { AgentConfig } from '@evoclaw/shared';

function makeConfig(overrides: Partial<AgentRunConfig> = {}): AgentRunConfig {
  const agent: AgentConfig = {
    id: 'test-agent',
    name: 'Tester',
    emoji: '🤖',
    status: 'active',
    role: 'general',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
  };
  return {
    agent,
    systemPrompt: '',
    workspaceFiles: {},
    workspacePath: '/tmp',
    modelId: 'm',
    provider: 'p',
    apiKey: 'k',
    baseUrl: 'http://localhost',
    apiProtocol: 'openai-completions',
    language: 'en',
    ...overrides,
  };
}

describe('embedded-runner-prompt — NO_REPLY 段拆分', () => {
  it('inboundFromPeer 未设/false → user @ 严格规则（必回）', () => {
    const prompt = buildSystemPrompt(makeConfig({}));
    expect(prompt).toContain('<silent_reply>');
    expect(prompt).toContain('Exception (user @)');
    expect(prompt).toMatch(/HUMAN user.*do NOT use NO_REPLY/s);
    expect(prompt).not.toContain('Exception (peer @)');
  });

  it('inboundFromPeer=true → peer @ 弹性规则（允许 NO_REPLY）', () => {
    const prompt = buildSystemPrompt(makeConfig({ inboundFromPeer: true }));
    expect(prompt).toContain('<silent_reply>');
    expect(prompt).toContain('Exception (peer @)');
    expect(prompt).toMatch(/peer @-mention.*NO_REPLY is allowed/s);
    expect(prompt).not.toContain('Exception (user @)');
  });

  it('mode=autonomous → 不注入 silent_reply 段（自主 Agent 不需要）', () => {
    const prompt = buildSystemPrompt(makeConfig({ inboundFromPeer: true }), 'autonomous');
    expect(prompt).not.toContain('<silent_reply>');
  });
});
