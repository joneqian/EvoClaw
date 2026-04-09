import { describe, it, expect, vi } from 'vitest';
import { createEvoClawTools } from '../tools/evoclaw-tools.js';

/** 创建 mock 依赖 */
function makeDeps() {
  return {
    searcher: {
      hybridSearch: vi.fn().mockResolvedValue([]),
    },
    memoryStore: {
      getById: vi.fn().mockReturnValue(null),
      insert: vi.fn(),
      update: vi.fn(),
      archive: vi.fn(),
      pin: vi.fn(),
      unpin: vi.fn(),
    },
    knowledgeGraph: {
      queryBoth: vi.fn().mockReturnValue([]),
    },
    ftsStore: {
      search: vi.fn().mockReturnValue([]),
    },
    agentId: 'test-agent',
  };
}

describe('createEvoClawTools', () => {
  it('无 braveApiKey 时应返回 9 个工具（含 web_fetch + 5 个新写入工具）', () => {
    const deps = makeDeps();
    const tools = createEvoClawTools(deps as any);
    expect(tools).toHaveLength(9);
    const names = tools.map(t => t.name);
    expect(names).toContain('web_fetch');
    expect(names).toContain('memory_search');
    expect(names).toContain('memory_get');
    expect(names).toContain('knowledge_query');
    expect(names).toContain('memory_write');
    expect(names).toContain('memory_update');
    expect(names).toContain('memory_delete');
    expect(names).toContain('memory_forget_topic');
    expect(names).toContain('memory_pin');
  });

  it('有 braveApiKey 时应返回 10 个工具（含 web_search + web_fetch）', () => {
    const deps = { ...makeDeps(), braveApiKey: 'test-key' };
    const tools = createEvoClawTools(deps as any);
    expect(tools).toHaveLength(10);
    const names = tools.map(t => t.name);
    expect(names).toContain('web_search');
    expect(names).toContain('web_fetch');
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

// ─────────────────────────────────────────────────────────────────
// Sprint 15.12 Phase A — 5 个记忆写入工具
// ─────────────────────────────────────────────────────────────────

describe('memory_write 工具', () => {
  it('缺少 l0 参数应返回错误', async () => {
    const deps = makeDeps();
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_write')!;
    const result = await tool.execute({ l1: '一些内容' });
    expect(result).toContain('错误');
    expect(result).toContain('l0');
  });

  it('缺少 l1 参数应返回错误', async () => {
    const deps = makeDeps();
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_write')!;
    const result = await tool.execute({ l0: '摘要' });
    expect(result).toContain('错误');
    expect(result).toContain('l1');
  });

  it('成功写入应返回 id 并调用 memoryStore.insert', async () => {
    const deps = makeDeps();
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_write')!;
    const result = await tool.execute({
      l0: '用户女儿叫小满',
      l1: '小满 5 月 3 日生日',
      l2: '用户的女儿名叫小满，生日是 5 月 3 日，今年 6 岁',
      category: 'profile',
    });
    expect(result).toContain('已记住');
    expect(result).toMatch(/id=[a-f0-9-]+/);
    expect(deps.memoryStore.insert).toHaveBeenCalledTimes(1);
    const inserted = deps.memoryStore.insert.mock.calls[0][0];
    expect(inserted.l0Index).toBe('用户女儿叫小满');
    expect(inserted.l1Overview).toBe('小满 5 月 3 日生日');
    expect(inserted.l2Content).toBe('用户的女儿名叫小满，生日是 5 月 3 日，今年 6 岁');
    expect(inserted.category).toBe('profile');
    expect(inserted.agentId).toBe('test-agent');
  });

  it('未提供 category 时默认为 preference', async () => {
    const deps = makeDeps();
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_write')!;
    await tool.execute({ l0: '摘要', l1: '内容' });
    const inserted = deps.memoryStore.insert.mock.calls[0][0];
    expect(inserted.category).toBe('preference');
  });

  it('未提供 l2 时使用 l1 作为完整内容', async () => {
    const deps = makeDeps();
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_write')!;
    await tool.execute({ l0: '摘要', l1: '完整内容' });
    const inserted = deps.memoryStore.insert.mock.calls[0][0];
    expect(inserted.l2Content).toBe('完整内容');
  });

  it('独立类别（event/case）默认 mergeType 为 independent', async () => {
    const deps = makeDeps();
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_write')!;
    await tool.execute({ l0: '会议', l1: '周五例会', category: 'event' });
    const inserted = deps.memoryStore.insert.mock.calls[0][0];
    expect(inserted.mergeType).toBe('independent');
    expect(inserted.mergeKey).toBeNull();
  });

  it('合并类别（profile/preference）默认 mergeType 为 merge', async () => {
    const deps = makeDeps();
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_write')!;
    await tool.execute({ l0: '偏好', l1: '简洁回答', category: 'preference' });
    const inserted = deps.memoryStore.insert.mock.calls[0][0];
    expect(inserted.mergeType).toBe('merge');
  });

  it('非法 category 应返回错误', async () => {
    const deps = makeDeps();
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_write')!;
    const result = await tool.execute({ l0: '摘要', l1: '内容', category: 'invalid' });
    expect(result).toContain('错误');
    expect(result).toContain('category');
    expect(deps.memoryStore.insert).not.toHaveBeenCalled();
  });
});

describe('memory_update 工具', () => {
  it('缺少 id 参数应返回错误', async () => {
    const deps = makeDeps();
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_update')!;
    const result = await tool.execute({ l1: '新内容' });
    expect(result).toContain('错误');
    expect(result).toContain('id');
  });

  it('未提供任何更新字段应返回错误', async () => {
    const deps = makeDeps();
    deps.memoryStore.getById.mockReturnValue({ id: 'mem-1', agentId: 'test-agent' });
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_update')!;
    const result = await tool.execute({ id: 'mem-1' });
    expect(result).toContain('错误');
    expect(result).toContain('至少');
  });

  it('id 不存在应返回错误', async () => {
    const deps = makeDeps();
    deps.memoryStore.getById.mockReturnValue(null);
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_update')!;
    const result = await tool.execute({ id: 'nope', l1: '新内容' });
    expect(result).toContain('未找到');
    expect(deps.memoryStore.update).not.toHaveBeenCalled();
  });

  it('跨 Agent 写入应被拒绝', async () => {
    const deps = makeDeps();
    deps.memoryStore.getById.mockReturnValue({ id: 'mem-1', agentId: 'other-agent' });
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_update')!;
    const result = await tool.execute({ id: 'mem-1', l1: '新内容' });
    expect(result).toContain('错误');
    expect(result).toContain('权限');
    expect(deps.memoryStore.update).not.toHaveBeenCalled();
  });

  it('成功更新 L1 应调用 memoryStore.update', async () => {
    const deps = makeDeps();
    deps.memoryStore.getById.mockReturnValue({ id: 'mem-1', agentId: 'test-agent' });
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_update')!;
    const result = await tool.execute({ id: 'mem-1', l1: '修订后的内容' });
    expect(result).toContain('已更新');
    expect(deps.memoryStore.update).toHaveBeenCalledWith('mem-1', { l1Overview: '修订后的内容' });
  });

  it('同时更新 L1 和 L2 应一次性传给 update', async () => {
    const deps = makeDeps();
    deps.memoryStore.getById.mockReturnValue({ id: 'mem-1', agentId: 'test-agent' });
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_update')!;
    await tool.execute({ id: 'mem-1', l1: '新概述', l2: '新详情' });
    expect(deps.memoryStore.update).toHaveBeenCalledWith('mem-1', {
      l1Overview: '新概述',
      l2Content: '新详情',
    });
  });

  it('禁止通过此工具修改 L0（保持检索锚点稳定）', async () => {
    const deps = makeDeps();
    deps.memoryStore.getById.mockReturnValue({ id: 'mem-1', agentId: 'test-agent' });
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_update')!;
    // 即使传 l0，也不应被传给 update
    await tool.execute({ id: 'mem-1', l0: '新摘要', l1: '新概述' });
    expect(deps.memoryStore.update).toHaveBeenCalledWith('mem-1', { l1Overview: '新概述' });
  });
});

describe('memory_delete 工具', () => {
  it('缺少 id 参数应返回错误', async () => {
    const deps = makeDeps();
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_delete')!;
    const result = await tool.execute({});
    expect(result).toContain('错误');
  });

  it('id 不存在应返回错误', async () => {
    const deps = makeDeps();
    deps.memoryStore.getById.mockReturnValue(null);
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_delete')!;
    const result = await tool.execute({ id: 'nope' });
    expect(result).toContain('未找到');
    expect(deps.memoryStore.archive).not.toHaveBeenCalled();
  });

  it('跨 Agent 删除应被拒绝', async () => {
    const deps = makeDeps();
    deps.memoryStore.getById.mockReturnValue({ id: 'mem-1', agentId: 'other-agent' });
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_delete')!;
    const result = await tool.execute({ id: 'mem-1' });
    expect(result).toContain('错误');
    expect(result).toContain('权限');
    expect(deps.memoryStore.archive).not.toHaveBeenCalled();
  });

  it('成功软删除应调用 archive 而非 delete', async () => {
    const deps = makeDeps();
    deps.memoryStore.getById.mockReturnValue({ id: 'mem-1', agentId: 'test-agent', l0Index: '某记忆' });
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_delete')!;
    const result = await tool.execute({ id: 'mem-1' });
    expect(result).toContain('已删除');
    expect(result).toContain('某记忆');
    expect(deps.memoryStore.archive).toHaveBeenCalledWith('mem-1');
  });
});

describe('memory_forget_topic 工具', () => {
  it('缺少 keyword 参数应返回错误', async () => {
    const deps = makeDeps();
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_forget_topic')!;
    const result = await tool.execute({});
    expect(result).toContain('错误');
  });

  it('无匹配记忆应返回 0 条', async () => {
    const deps = makeDeps();
    deps.ftsStore.search.mockReturnValue([]);
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_forget_topic')!;
    const result = await tool.execute({ keyword: '不存在的话题' });
    expect(result).toContain('0');
    expect(deps.memoryStore.archive).not.toHaveBeenCalled();
  });

  it('多条匹配应批量归档并返回数量', async () => {
    const deps = makeDeps();
    deps.ftsStore.search.mockReturnValue([
      { memoryId: 'mem-1', score: 0.9 },
      { memoryId: 'mem-2', score: 0.8 },
      { memoryId: 'mem-3', score: 0.7 },
    ]);
    deps.memoryStore.getById.mockImplementation((id: string) => ({
      id,
      agentId: 'test-agent',
      l0Index: `记忆 ${id}`,
    }));
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_forget_topic')!;
    const result = await tool.execute({ keyword: '客户 X' });
    expect(result).toContain('3');
    expect(deps.memoryStore.archive).toHaveBeenCalledTimes(3);
    expect(deps.memoryStore.archive).toHaveBeenCalledWith('mem-1');
    expect(deps.memoryStore.archive).toHaveBeenCalledWith('mem-2');
    expect(deps.memoryStore.archive).toHaveBeenCalledWith('mem-3');
  });

  it('应只归档同 agentId 的记忆（FTS 跨 agent 共享）', async () => {
    const deps = makeDeps();
    deps.ftsStore.search.mockReturnValue([
      { memoryId: 'mem-1', score: 0.9 },
      { memoryId: 'mem-2', score: 0.8 },
    ]);
    deps.memoryStore.getById.mockImplementation((id: string) => {
      if (id === 'mem-1') return { id, agentId: 'test-agent', l0Index: 'mine' };
      if (id === 'mem-2') return { id, agentId: 'other-agent', l0Index: 'theirs' };
      return null;
    });
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_forget_topic')!;
    const result = await tool.execute({ keyword: '关键词' });
    expect(result).toContain('1');
    expect(deps.memoryStore.archive).toHaveBeenCalledTimes(1);
    expect(deps.memoryStore.archive).toHaveBeenCalledWith('mem-1');
  });
});

describe('memory_pin 工具', () => {
  it('缺少 id 参数应返回错误', async () => {
    const deps = makeDeps();
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_pin')!;
    const result = await tool.execute({});
    expect(result).toContain('错误');
  });

  it('id 不存在应返回错误', async () => {
    const deps = makeDeps();
    deps.memoryStore.getById.mockReturnValue(null);
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_pin')!;
    const result = await tool.execute({ id: 'nope' });
    expect(result).toContain('未找到');
    expect(deps.memoryStore.pin).not.toHaveBeenCalled();
  });

  it('跨 Agent 钉选应被拒绝', async () => {
    const deps = makeDeps();
    deps.memoryStore.getById.mockReturnValue({ id: 'mem-1', agentId: 'other-agent' });
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_pin')!;
    const result = await tool.execute({ id: 'mem-1' });
    expect(result).toContain('错误');
    expect(result).toContain('权限');
  });

  it('默认 pinned=true 应调用 pin', async () => {
    const deps = makeDeps();
    deps.memoryStore.getById.mockReturnValue({ id: 'mem-1', agentId: 'test-agent', l0Index: '重要记忆' });
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_pin')!;
    const result = await tool.execute({ id: 'mem-1' });
    expect(result).toContain('已钉选');
    expect(deps.memoryStore.pin).toHaveBeenCalledWith('mem-1');
    expect(deps.memoryStore.unpin).not.toHaveBeenCalled();
  });

  it('pinned=false 应调用 unpin', async () => {
    const deps = makeDeps();
    deps.memoryStore.getById.mockReturnValue({ id: 'mem-1', agentId: 'test-agent', l0Index: '重要记忆' });
    const tools = createEvoClawTools(deps as any);
    const tool = tools.find(t => t.name === 'memory_pin')!;
    const result = await tool.execute({ id: 'mem-1', pinned: false });
    expect(result).toContain('已取消钉选');
    expect(deps.memoryStore.unpin).toHaveBeenCalledWith('mem-1');
    expect(deps.memoryStore.pin).not.toHaveBeenCalled();
  });
});
