import { describe, it, expect } from 'vitest';
import {
  PORT_RANGE,
  TOKEN_BYTES,
  DEFAULT_DATA_DIR,
  DB_FILENAME,
  AGENTS_DIR,
  FALLBACK_MODEL,
  MEMORY_L0_MAX_TOKENS,
  MEMORY_L1_MAX_TOKENS,
  MEMORY_L2_BUDGET_TOKENS,
  HOTNESS_HALF_LIFE_DAYS,
  LANE_CONCURRENCY,
  AGENT_WORKSPACE_FILES,
} from '../constants.js';
import type {
  AgentStatus,
  AgentConfig,
  AgentFile,
  Binding,
} from '../types/agent.js';
import type {
  MemoryCategory,
  MergeType,
  MemoryVisibility,
  MemoryUnit,
  KnowledgeGraphEntry,
} from '../types/memory.js';
import type {
  MessageRole,
  ChatMessage,
  ToolCall,
  AgentEvent,
  AgentEventType,
  SessionKey,
} from '../types/message.js';
import type {
  PermissionCategory,
  PermissionScope,
  PermissionGrant,
} from '../types/permission.js';
import type {
  ChannelType,
  ChannelMessage,
} from '../types/channel.js';
import type {
  ProviderConfig,
  ModelConfig,
  ResolvedModel,
} from '../types/provider.js';

describe('常量值验证', () => {
  it('PORT_RANGE 应包含有效的端口范围', () => {
    expect(PORT_RANGE.min).toBe(49152);
    expect(PORT_RANGE.max).toBe(65535);
    expect(PORT_RANGE.min).toBeLessThan(PORT_RANGE.max);
  });

  it('TOKEN_BYTES 应为 32（256-bit）', () => {
    expect(TOKEN_BYTES).toBe(32);
  });

  it('默认数据目录和数据库文件名', () => {
    expect(DEFAULT_DATA_DIR).toBe('.evoclaw');
    expect(DB_FILENAME).toBe('evoclaw.db');
    expect(AGENTS_DIR).toBe('agents');
  });

  it('FALLBACK_MODEL 应为 openai/gpt-4o-mini', () => {
    expect(FALLBACK_MODEL.provider).toBe('openai');
    expect(FALLBACK_MODEL.modelId).toBe('gpt-4o-mini');
  });

  it('记忆 token 限制应为正数', () => {
    expect(MEMORY_L0_MAX_TOKENS).toBe(100);
    expect(MEMORY_L1_MAX_TOKENS).toBe(2000);
    expect(MEMORY_L2_BUDGET_TOKENS).toBe(8000);
    expect(MEMORY_L0_MAX_TOKENS).toBeLessThan(MEMORY_L1_MAX_TOKENS);
    expect(MEMORY_L1_MAX_TOKENS).toBeLessThan(MEMORY_L2_BUDGET_TOKENS);
  });

  it('HOTNESS_HALF_LIFE_DAYS 应为 7', () => {
    expect(HOTNESS_HALF_LIFE_DAYS).toBe(7);
  });

  it('LANE_CONCURRENCY 各通道并发数', () => {
    expect(LANE_CONCURRENCY.main).toBe(4);
    expect(LANE_CONCURRENCY.subagent).toBe(8);
    expect(LANE_CONCURRENCY.cron).toBe(2);
  });

  it('AGENT_WORKSPACE_FILES 应包含 8 个文件', () => {
    expect(AGENT_WORKSPACE_FILES).toHaveLength(8);
    expect(AGENT_WORKSPACE_FILES).toContain('SOUL.md');
    expect(AGENT_WORKSPACE_FILES).toContain('IDENTITY.md');
    expect(AGENT_WORKSPACE_FILES).toContain('AGENTS.md');
    expect(AGENT_WORKSPACE_FILES).toContain('TOOLS.md');
    expect(AGENT_WORKSPACE_FILES).toContain('HEARTBEAT.md');
    expect(AGENT_WORKSPACE_FILES).toContain('USER.md');
    expect(AGENT_WORKSPACE_FILES).toContain('MEMORY.md');
    expect(AGENT_WORKSPACE_FILES).toContain('BOOTSTRAP.md');
  });
});

describe('类型编译验证', () => {
  it('AgentConfig 应可正确构造', () => {
    const agent: AgentConfig = {
      id: 'agent-001',
      name: '测试助手',
      emoji: '🤖',
      status: 'active',
      modelId: 'gpt-4o-mini',
      provider: 'openai',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(agent.id).toBe('agent-001');
    expect(agent.status).toBe('active');
  });

  it('AgentConfig 支持绑定', () => {
    const binding: Binding = {
      channel: 'feishu',
      chatType: 'group',
      accountId: 'acc-123',
      peerId: 'peer-456',
    };
    const agent: AgentConfig = {
      id: 'agent-002',
      name: '飞书助手',
      emoji: '📨',
      status: 'draft',
      bindings: [binding],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    expect(agent.bindings).toHaveLength(1);
    expect(agent.bindings![0].channel).toBe('feishu');
  });

  it('AgentStatus 类型约束', () => {
    const statuses: AgentStatus[] = ['draft', 'active', 'paused', 'archived'];
    expect(statuses).toHaveLength(4);
  });

  it('AgentFile 类型约束', () => {
    const file: AgentFile = 'SOUL.md';
    expect(file).toBe('SOUL.md');
  });

  it('MemoryUnit 应可正确构造', () => {
    const memory: MemoryUnit = {
      id: 'mem-001',
      agentId: 'agent-001',
      category: 'profile',
      mergeType: 'merge',
      mergeKey: 'user-name',
      l0Index: '用户名为张三',
      l1Overview: '用户基本信息概览',
      l2Content: '完整的用户档案内容',
      confidence: 0.95,
      activation: 1.0,
      accessCount: 5,
      visibility: 'private',
      sourceConversationId: 'conv-001',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archivedAt: null,
    };
    expect(memory.category).toBe('profile');
    expect(memory.confidence).toBeGreaterThan(0);
    expect(memory.confidence).toBeLessThanOrEqual(1);
  });

  it('MemoryCategory 应包含 9 种类别', () => {
    const categories: MemoryCategory[] = [
      'profile', 'preference', 'entity', 'event', 'case',
      'pattern', 'tool', 'skill', 'correction',
    ];
    expect(categories).toHaveLength(9);
  });

  it('ChatMessage 应可正确构造', () => {
    const message: ChatMessage = {
      id: 'msg-001',
      conversationId: 'conv-001',
      role: 'assistant',
      content: '你好，有什么可以帮你的？',
      createdAt: new Date().toISOString(),
    };
    expect(message.role).toBe('assistant');
  });

  it('ChatMessage 支持工具调用', () => {
    const toolCall: ToolCall = {
      id: 'tc-001',
      name: 'search',
      arguments: { query: '天气' },
      result: '今天晴天',
    };
    const message: ChatMessage = {
      id: 'msg-002',
      conversationId: 'conv-001',
      role: 'assistant',
      content: '',
      toolCalls: [toolCall],
      createdAt: new Date().toISOString(),
    };
    expect(message.toolCalls).toHaveLength(1);
    expect(message.toolCalls![0].name).toBe('search');
  });

  it('AgentEvent 应可正确构造', () => {
    const event: AgentEvent = {
      type: 'text_delta',
      timestamp: Date.now(),
      delta: '你好',
    };
    expect(event.type).toBe('text_delta');
    expect(event.delta).toBe('你好');
  });

  it('AgentEventType 应包含 7 种事件', () => {
    const types: AgentEventType[] = [
      'agent_start', 'text_delta', 'text_done',
      'tool_start', 'tool_result', 'agent_done', 'error',
    ];
    expect(types).toHaveLength(7);
  });

  it('SessionKey 模板字面量类型', () => {
    const key: SessionKey = 'agent:001:local:private:user-123';
    expect(key).toContain('agent:');
  });

  it('PermissionGrant 应可正确构造', () => {
    const grant: PermissionGrant = {
      id: 'perm-001',
      agentId: 'agent-001',
      category: 'file_read',
      scope: 'session',
      resource: '/tmp/data.txt',
      grantedAt: new Date().toISOString(),
      expiresAt: null,
      grantedBy: 'user',
    };
    expect(grant.category).toBe('file_read');
    expect(grant.scope).toBe('session');
  });

  it('PermissionCategory 应包含 7 类', () => {
    const categories: PermissionCategory[] = [
      'file_read', 'file_write', 'network', 'shell',
      'browser', 'mcp', 'skill',
    ];
    expect(categories).toHaveLength(7);
  });

  it('ChannelMessage 应可正确构造', () => {
    const msg: ChannelMessage = {
      channel: 'feishu',
      chatType: 'group',
      accountId: 'acc-001',
      peerId: 'group-001',
      senderId: 'user-001',
      senderName: '张三',
      content: '你好',
      messageId: 'fmsg-001',
      timestamp: Date.now(),
    };
    expect(msg.channel).toBe('feishu');
    expect(msg.chatType).toBe('group');
  });

  it('ChannelType 应包含 5 种通道', () => {
    const channels: ChannelType[] = ['local', 'feishu', 'wecom', 'dingtalk', 'qq'];
    expect(channels).toHaveLength(5);
  });

  it('ProviderConfig 应可正确构造', () => {
    const config: ProviderConfig = {
      id: 'openai',
      name: 'OpenAI',
      baseUrl: 'https://api.openai.com/v1',
      apiKeyRef: 'evoclaw.openai.api-key',
      models: [],
    };
    expect(config.id).toBe('openai');
  });

  it('ModelConfig 应可正确构造', () => {
    const model: ModelConfig = {
      id: 'gpt-4o-mini',
      name: 'GPT-4o Mini',
      provider: 'openai',
      maxContextLength: 128000,
      maxOutputTokens: 16384,
      supportsVision: true,
      supportsToolUse: true,
      isDefault: true,
    };
    expect(model.supportsVision).toBe(true);
    expect(model.maxContextLength).toBeGreaterThan(0);
  });

  it('ResolvedModel 应可正确构造', () => {
    const resolved: ResolvedModel = {
      provider: 'openai',
      modelId: 'gpt-4o-mini',
      apiKeyRef: 'evoclaw.openai.api-key',
      baseUrl: 'https://api.openai.com/v1',
    };
    expect(resolved.provider).toBe('openai');
    expect(resolved.modelId).toBe('gpt-4o-mini');
  });
});
