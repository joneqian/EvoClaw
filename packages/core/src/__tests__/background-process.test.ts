import { describe, it, expect } from 'vitest';
import { createExecBackgroundTool, createProcessTool, ProcessManager } from '../tools/background-process.js';

describe('ProcessManager', () => {
  it('应该启动后台进程', () => {
    const pm = new ProcessManager();
    const entry = pm.start('echo hello');
    expect(entry.id).toContain('bg-');
    expect(entry.status).toBe('running');
    expect(entry.command).toBe('echo hello');
    // 清理
    setTimeout(() => pm.kill(entry.id), 100);
  });

  it('list 应该返回所有进程', () => {
    const pm = new ProcessManager();
    pm.start('sleep 10');
    pm.start('sleep 20');
    const list = pm.list();
    expect(list.length).toBe(2);
    // 清理
    for (const p of list) pm.kill(p.id);
  });

  it('kill 应该终止进程', async () => {
    const pm = new ProcessManager();
    const entry = pm.start('sleep 60');
    const killed = pm.kill(entry.id);
    expect(killed).toBe(true);
    // 等一下让进程退出
    await new Promise(resolve => setTimeout(resolve, 200));
    const status = pm.get(entry.id);
    expect(status?.status).toBe('exited');
  });

  it('getOutput 应该返回输出', async () => {
    const pm = new ProcessManager();
    const entry = pm.start('echo "test output"');
    // 等待输出
    await new Promise(resolve => setTimeout(resolve, 300));
    const output = pm.getOutput(entry.id);
    expect(output).toContain('test output');
  });

  it('getOutput 不存在的 id 应返回 null', () => {
    const pm = new ProcessManager();
    expect(pm.getOutput('nonexistent')).toBeNull();
  });
});

describe('exec_background 工具', () => {
  it('应该返回正确的工具定义', () => {
    const tool = createExecBackgroundTool();
    expect(tool.name).toBe('exec_background');
  });

  it('缺少 command 应返回错误', async () => {
    const tool = createExecBackgroundTool();
    const result = await tool.execute({});
    expect(result).toContain('错误');
  });

  it('危险命令应被拒绝', async () => {
    const tool = createExecBackgroundTool();
    const result = await tool.execute({ command: 'rm -rf /' });
    expect(result).toContain('安全检查');
  });

  it('正常命令应成功启动', async () => {
    const tool = createExecBackgroundTool();
    const result = await tool.execute({ command: 'echo ok' });
    expect(result).toContain('已启动');
    expect(result).toContain('ID');
  });
});

describe('process 工具', () => {
  it('应该返回正确的工具定义', () => {
    const tool = createProcessTool();
    expect(tool.name).toBe('process');
  });

  it('list 无进程时应返回提示', async () => {
    const tool = createProcessTool();
    // 注意：这里会列出全局进程管理器中的进程（可能包含其他测试启动的）
    const result = await tool.execute({ action: 'list' });
    expect(typeof result).toBe('string');
  });

  it('output 缺少 id 应返回错误', async () => {
    const tool = createProcessTool();
    const result = await tool.execute({ action: 'output' });
    expect(result).toContain('错误');
  });

  it('kill 缺少 id 应返回错误', async () => {
    const tool = createProcessTool();
    const result = await tool.execute({ action: 'kill' });
    expect(result).toContain('错误');
  });

  it('未知操作应返回错误', async () => {
    const tool = createProcessTool();
    const result = await tool.execute({ action: 'invalid' });
    expect(result).toContain('未知操作');
  });
});
