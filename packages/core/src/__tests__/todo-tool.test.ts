import { describe, it, expect, vi } from 'vitest';
import { createTodoWriteTool, loadTodoState, formatTodoForPrompt, type TodoTask } from '../tools/todo-tool.js';

describe('TodoWrite 工具', () => {
  function createMockOpts() {
    let stored: string | undefined;
    return {
      readFile: vi.fn(() => stored),
      writeFile: vi.fn((content: string) => { stored = content; }),
    };
  }

  describe('createTodoWriteTool', () => {
    it('应返回正确的工具定义', () => {
      const tool = createTodoWriteTool(createMockOpts());
      expect(tool.name).toBe('todo_write');
      expect(tool.parameters).toHaveProperty('properties');
      expect(tool.parameters).toHaveProperty('required');
    });

    it('应正常创建任务列表', async () => {
      const opts = createMockOpts();
      const tool = createTodoWriteTool(opts);
      const result = await tool.execute({
        tasks: [
          { id: '1', description: '实现功能 A', status: 'in_progress' },
          { id: '2', description: '测试功能 B', status: 'todo' },
        ],
      });
      expect(result).toContain('2 项');
      expect(result).toContain('进行中 1');
      expect(opts.writeFile).toHaveBeenCalledOnce();
      const written = JSON.parse(opts.writeFile.mock.calls[0][0]);
      expect(written).toHaveLength(2);
    });

    it('应拒绝超过 20 项的任务', async () => {
      const tool = createTodoWriteTool(createMockOpts());
      const tasks = Array.from({ length: 21 }, (_, i) => ({
        id: String(i), description: `任务 ${i}`, status: 'todo',
      }));
      const result = await tool.execute({ tasks });
      expect(result).toContain('错误');
      expect(result).toContain('超出上限');
    });

    it('应拒绝多个 in_progress 任务', async () => {
      const tool = createTodoWriteTool(createMockOpts());
      const result = await tool.execute({
        tasks: [
          { id: '1', description: 'A', status: 'in_progress' },
          { id: '2', description: 'B', status: 'in_progress' },
        ],
      });
      expect(result).toContain('错误');
      expect(result).toContain('仅允许 1 个');
    });

    it('应拒绝重复的 id', async () => {
      const tool = createTodoWriteTool(createMockOpts());
      const result = await tool.execute({
        tasks: [
          { id: '1', description: 'A', status: 'todo' },
          { id: '1', description: 'B', status: 'done' },
        ],
      });
      expect(result).toContain('错误');
      expect(result).toContain('重复');
    });

    it('应拒绝无效的 status', async () => {
      const tool = createTodoWriteTool(createMockOpts());
      const result = await tool.execute({
        tasks: [{ id: '1', description: 'A', status: 'invalid' }],
      });
      expect(result).toContain('错误');
      expect(result).toContain('无效');
    });

    it('应拒绝非数组的 tasks', async () => {
      const tool = createTodoWriteTool(createMockOpts());
      const result = await tool.execute({ tasks: 'not an array' });
      expect(result).toContain('错误');
      expect(result).toContain('数组');
    });

    it('应允许 0 项任务（清空列表）', async () => {
      const opts = createMockOpts();
      const tool = createTodoWriteTool(opts);
      const result = await tool.execute({ tasks: [] });
      expect(result).toContain('0 项');
      expect(opts.writeFile).toHaveBeenCalled();
    });

    it('应允许恰好 20 项任务', async () => {
      const tool = createTodoWriteTool(createMockOpts());
      const tasks = Array.from({ length: 20 }, (_, i) => ({
        id: String(i), description: `任务 ${i}`, status: 'todo',
      }));
      const result = await tool.execute({ tasks });
      expect(result).toContain('20 项');
      expect(result).not.toContain('错误');
    });
  });

  describe('loadTodoState', () => {
    it('应解析有效的 JSON', () => {
      const tasks: TodoTask[] = [{ id: '1', description: 'test', status: 'todo' }];
      const result = loadTodoState(() => JSON.stringify(tasks));
      expect(result).toEqual(tasks);
    });

    it('应处理空文件', () => {
      expect(loadTodoState(() => undefined)).toEqual([]);
    });

    it('应处理无效 JSON', () => {
      expect(loadTodoState(() => 'not json')).toEqual([]);
    });

    it('应处理非数组 JSON', () => {
      expect(loadTodoState(() => '{"key": "value"}')).toEqual([]);
    });
  });

  describe('formatTodoForPrompt', () => {
    it('应格式化非空任务列表', () => {
      const tasks: TodoTask[] = [
        { id: '1', description: '实现 A', status: 'in_progress' },
        { id: '2', description: '测试 B', status: 'todo' },
        { id: '3', description: '完成 C', status: 'done' },
      ];
      const result = formatTodoForPrompt(tasks);
      expect(result).toContain('<current_tasks>');
      expect(result).toContain('[1] 实现 A');
      expect(result).toContain('[2] 测试 B');
      expect(result).toContain('1 项');
    });

    it('空任务列表应返回空字符串', () => {
      expect(formatTodoForPrompt([])).toBe('');
    });
  });
});
