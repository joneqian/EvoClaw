import { describe, it, expect, vi } from 'vitest';
import { createEvoClawTools } from '../tools/evoclaw-tools.js';
import type { ToolDefinition } from '../bridge/tool-injector.js';

/** 创建 mock 依赖 */
function makeDeps() {
  return {
    searcher: {
      hybridSearch: vi.fn().mockResolvedValue([]),
    },
    memoryStore: {
      getById: vi.fn().mockReturnValue(null),
    },
    knowledgeGraph: {
      queryBoth: vi.fn().mockReturnValue([]),
    },
    agentId: 'test-agent',
  };
}

describe('createEvoClawTools', () => {
  it('应返回 3 个工具', () => {
    const deps = makeDeps();
    const tools = createEvoClawTools(deps as any);
    expect(tools).toHaveLength(3);
    const names = tools.map(t => t.name);
    expect(names).toContain('memory_search');
    expect(names).toContain('memory_get');
    expect(names).toContain('knowledge_query');
  });

  it('每个工具应有 name, description, parameters, execute', () => {
    const deps = makeDeps();
    const tools = createEvoClawTools(deps as any);
    for (const tool of tools) {
      expect(tool.name).toBeTruthy();
      expect(tool.description).toBeTruthy();
      expect(tool.parameters).toBeDefined();
      expect(typeof tool.execute).toBe('function');
    }
  });
});

describe('memory_search 工具', () => {
  it('缺少 query 参数应返回错误', async () => {
    const deps = makeDeps();
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_search')!;
    const result = await tool.execute({});
    expect(result).toContain('错误');
  });

  it('无结果应返回提示', async () => {
    const deps = makeDeps();
    deps.searcher.hybridSearch.mockResolvedValue([]);
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_search')!;
    const result = await tool.execute({ query: '测试' });
    expect(result).toContain('未找到');
  });

  it('有结果应格式化返回', async () => {
    const deps = makeDeps();
    deps.searcher.hybridSearch.mockResolvedValue([
      { category: 'profile', l0Index: '用户偏好', l1Overview: '喜欢简洁回答' },
      { category: 'event', l0Index: '会议记录', l1Overview: '周五例会' },
    ]);
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_search')!;
    const result = await tool.execute({ query: '偏好', limit: 5 });
    expect(result).toContain('2 条');
    expect(result).toContain('profile');
    expect(result).toContain('用户偏好');
  });

  it('应传递正确的 agentId 和 limit', async () => {
    const deps = makeDeps();
    deps.searcher.hybridSearch.mockResolvedValue([]);
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_search')!;
    await tool.execute({ query: '测试', limit: 10 });
    expect(deps.searcher.hybridSearch).toHaveBeenCalledWith('测试', 'test-agent', { limit: 10 });
  });
});

describe('memory_get 工具', () => {
  it('缺少 id 参数应返回错误', async () => {
    const deps = makeDeps();
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_get')!;
    const result = await tool.execute({});
    expect(result).toContain('错误');
  });

  it('未找到记忆应返回提示', async () => {
    const deps = makeDeps();
    deps.memoryStore.getById.mockReturnValue(null);
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_get')!;
    const result = await tool.execute({ id: 'nonexistent' });
    expect(result).toContain('未找到');
  });

  it('找到记忆应返回 JSON 详情', async () => {
    const deps = makeDeps();
    deps.memoryStore.getById.mockReturnValue({
      id: 'mem-1',
      category: 'profile',
      l0Index: '用户角色',
      l1Overview: '高级工程师',
      l2Content: '用户是一名高级后端工程师，专注于分布式系统。',
      createdAt: '2025-01-01',
      updatedAt: '2025-01-02',
    });
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_get')!;
    const result = await tool.execute({ id: 'mem-1' });
    const parsed = JSON.parse(result);
    expect(parsed.id).toBe('mem-1');
    expect(parsed.l2).toContain('分布式系统');
  });
});

describe('knowledge_query 工具', () => {
  it('缺少 entity 参数应返回错误', async () => {
    const deps = makeDeps();
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'knowledge_query')!;
    const result = await tool.execute({});
    expect(result).toContain('错误');
  });

  it('无关系应返回提示', async () => {
    const deps = makeDeps();
    deps.knowledgeGraph.queryBoth.mockReturnValue([]);
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'knowledge_query')!;
    const result = await tool.execute({ entity: 'unknown' });
    expect(result).toContain('未找到');
  });

  it('有关系应格式化返回', async () => {
    const deps = makeDeps();
    deps.knowledgeGraph.queryBoth.mockReturnValue([
      { subjectId: '张三', relation: '是', objectId: '工程师', confidence: 0.95 },
      { subjectId: '张三', relation: '使用', objectLiteral: 'TypeScript', confidence: 0.88 },
    ]);
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'knowledge_query')!;
    const result = await tool.execute({ entity: '张三' });
    expect(result).toContain('2 条');
    expect(result).toContain('张三');
    expect(result).toContain('工程师');
  });
});
