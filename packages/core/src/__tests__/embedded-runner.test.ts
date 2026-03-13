import { describe, it, expect } from 'vitest';
import { buildSystemPrompt } from '../agent/embedded-runner.js';
import { runEmbeddedAgent } from '../agent/embedded-runner.js';
import { formatSSE, createSSEStream } from '../bridge/event-forwarder.js';
import { getInjectedTools, permissionInterceptor } from '../bridge/tool-injector.js';
import type { AgentRunConfig, RuntimeEvent } from '../agent/types.js';

/** 创建测试用 AgentRunConfig */
function makeConfig(overrides: Partial<AgentRunConfig> = {}): AgentRunConfig {
  return {
    agent: {
      id: 'test-agent',
      name: '测试助手',
      emoji: '🧪',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    systemPrompt: '',
    workspaceFiles: {},
    modelId: 'gpt-4o-mini',
    provider: 'openai',
    apiKey: '',
    baseUrl: '',
    ...overrides,
  };
}

describe('buildSystemPrompt', () => {
  it('空工作区和空 systemPrompt 应返回空字符串', () => {
    const config = makeConfig();
    const result = buildSystemPrompt(config);
    expect(result).toBe('');
  });

  it('仅有 systemPrompt 时应返回 systemPrompt', () => {
    const config = makeConfig({ systemPrompt: '你是一个助手' });
    const result = buildSystemPrompt(config);
    expect(result).toBe('你是一个助手');
  });

  it('工作区文件应按 SOUL → IDENTITY → AGENTS → systemPrompt 顺序拼接', () => {
    const config = makeConfig({
      systemPrompt: '额外指令',
      workspaceFiles: {
        'SOUL.md': '# 灵魂',
        'IDENTITY.md': '# 身份',
        'AGENTS.md': '# 规程',
      },
    });
    const result = buildSystemPrompt(config);

    // 验证顺序
    const soulIdx = result.indexOf('# 灵魂');
    const identityIdx = result.indexOf('# 身份');
    const agentsIdx = result.indexOf('# 规程');
    const extraIdx = result.indexOf('额外指令');

    expect(soulIdx).toBeLessThan(identityIdx);
    expect(identityIdx).toBeLessThan(agentsIdx);
    expect(agentsIdx).toBeLessThan(extraIdx);
  });

  it('工作区文件之间应使用分隔符', () => {
    const config = makeConfig({
      workspaceFiles: {
        'SOUL.md': '灵魂内容',
        'IDENTITY.md': '身份内容',
      },
    });
    const result = buildSystemPrompt(config);
    expect(result).toContain('---');
  });

  it('只包含存在的工作区文件', () => {
    const config = makeConfig({
      workspaceFiles: {
        'SOUL.md': '灵魂内容',
        // 没有 IDENTITY.md 和 AGENTS.md
      },
    });
    const result = buildSystemPrompt(config);
    expect(result).toBe('灵魂内容');
    expect(result).not.toContain('---');
  });
});

describe('formatSSE', () => {
  it('应返回 SSE 格式字符串', () => {
    const event: RuntimeEvent = {
      type: 'text_delta',
      timestamp: 1000,
      delta: '你好',
    };
    const result = formatSSE(event);
    expect(result).toBe(`data: ${JSON.stringify(event)}\n\n`);
  });

  it('应正确序列化包含特殊字符的事件', () => {
    const event: RuntimeEvent = {
      type: 'error',
      timestamp: 2000,
      error: '包含 "引号" 和 换行\n 的消息',
    };
    const result = formatSSE(event);
    expect(result.startsWith('data: ')).toBe(true);
    expect(result.endsWith('\n\n')).toBe(true);
    // 确保可以反序列化
    const parsed = JSON.parse(result.slice(6).trim());
    expect(parsed.error).toBe(event.error);
  });
});

describe('createSSEStream', () => {
  it('应创建可读流并推送事件', async () => {
    const { readable, push, close } = createSSEStream();
    const reader = readable.getReader();
    const decoder = new TextDecoder();

    const event: RuntimeEvent = { type: 'agent_start', timestamp: 1000 };
    push(event);
    close();

    const { value, done } = await reader.read();
    expect(done).toBe(false);
    const text = decoder.decode(value);
    expect(text).toBe(formatSSE(event));

    // 关闭后应结束
    const result = await reader.read();
    expect(result.done).toBe(true);
  });
});

describe('tool-injector', () => {
  it('getInjectedTools 应返回空数组（Sprint 2 桩实现）', () => {
    const tools = getInjectedTools();
    expect(tools).toEqual([]);
  });

  it('permissionInterceptor 无拦截器配置时默认允许', () => {
    const r1 = permissionInterceptor('read', {});
    expect(r1).toEqual({ allowed: true });
    const r2 = permissionInterceptor('write', { path: '/tmp/test' });
    expect(r2).toEqual({ allowed: true });
  });
});

describe('runEmbeddedAgent', () => {
  it('应发出 agent_start 和 agent_done 事件（无 API key 快速失败）', async () => {
    const events: RuntimeEvent[] = [];
    const config = makeConfig({
      apiKey: '',  // 无 API key，PI 路径会因校验失败而跳过
      baseUrl: 'http://127.0.0.1:1', // fallback fetch 也会快速失败
    });

    await runEmbeddedAgent(config, '你好', (event) => {
      events.push(event);
    });

    const types = events.map(e => e.type);
    expect(types[0]).toBe('agent_start');
    expect(types[types.length - 1]).toBe('agent_done');
  }, 10_000);

  it('无 API key 时 PI 路径被跳过，fallback 失败应产生 error 事件', async () => {
    const events: RuntimeEvent[] = [];
    const config = makeConfig({
      baseUrl: 'http://127.0.0.1:1', // 不可达地址
      apiKey: '',  // 无 key，PI 快速跳过
    });

    await runEmbeddedAgent(config, '你好', (event) => {
      events.push(event);
    });

    const types = events.map(e => e.type);
    expect(types).toContain('agent_start');
    expect(types).toContain('agent_done');
    // PI 因无 key 跳过，fetch 因不可达失败 → error 事件
    expect(types).toContain('error');
  }, 10_000);
});
