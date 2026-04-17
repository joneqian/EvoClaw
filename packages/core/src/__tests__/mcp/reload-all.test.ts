/**
 * M6 T2b: McpManager.reloadAll diff 对比测试
 *
 * 覆盖三分支：新增 / 移除 / 更新。
 * 使用 stdio transport 的虚拟 mock（不真正启动子进程），验证 addServer/removeServer 被正确调用。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { McpManager } from '../../mcp/mcp-client.js';

describe('M6 T2b — McpManager.reloadAll', () => {
  let mgr: McpManager;
  // 使用 ReturnType<typeof vi.fn> 以避免 spyOn 的泛型参数推断问题
  let addSpy: any;
  let removeSpy: any;

  beforeEach(() => {
    mgr = new McpManager();
    // mock addServer / removeServer 避免实际启动子进程
    addSpy = vi.spyOn(mgr, 'addServer').mockImplementation((async (cfg: any) => {
      (mgr as any).configs.set(cfg.name, cfg);
    }) as any);
    removeSpy = vi.spyOn(mgr, 'removeServer').mockImplementation((async (name: string) => {
      (mgr as any).configs.delete(name);
    }) as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeStdio(name: string, command: string = '/bin/cat'): any {
    return { name, transport: 'stdio', command, args: [], enabled: true };
  }

  it('全新启动：所有 config 都被视为新增', async () => {
    const diff = await mgr.reloadAll([makeStdio('a'), makeStdio('b')]);
    expect(diff.added.sort()).toEqual(['a', 'b']);
    expect(diff.removed).toEqual([]);
    expect(diff.updated).toEqual([]);
    expect(addSpy).toHaveBeenCalledTimes(2);
  });

  it('移除不在新列表里的 server', async () => {
    await mgr.addServer(makeStdio('a'));
    await mgr.addServer(makeStdio('b'));
    addSpy.mockClear();

    const diff = await mgr.reloadAll([makeStdio('a')]);
    expect(diff.removed).toEqual(['b']);
    expect(diff.added).toEqual([]);
    expect(diff.updated).toEqual([]);
    expect(removeSpy).toHaveBeenCalledWith('b');
  });

  it('已有且 config 未变的 server 不动', async () => {
    await mgr.addServer(makeStdio('a'));
    addSpy.mockClear();
    removeSpy.mockClear();

    const diff = await mgr.reloadAll([makeStdio('a')]);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(diff.updated).toEqual([]);
    expect(addSpy).not.toHaveBeenCalled();
    expect(removeSpy).not.toHaveBeenCalled();
  });

  it('已有但 config 变化的 server 被标记为 updated（remove + add）', async () => {
    await mgr.addServer(makeStdio('a', '/bin/old-cmd'));
    addSpy.mockClear();
    removeSpy.mockClear();

    const diff = await mgr.reloadAll([makeStdio('a', '/bin/new-cmd')]);
    expect(diff.updated).toEqual(['a']);
    expect(diff.added).toEqual([]);
    expect(diff.removed).toEqual([]);
    expect(removeSpy).toHaveBeenCalledWith('a');
    expect(addSpy).toHaveBeenCalled();
  });

  it('三分支共存：新增 + 移除 + 更新', async () => {
    await mgr.addServer(makeStdio('keep'));
    await mgr.addServer(makeStdio('remove-me'));
    await mgr.addServer(makeStdio('update-me', '/bin/old'));
    addSpy.mockClear();
    removeSpy.mockClear();

    const diff = await mgr.reloadAll([
      makeStdio('keep'),
      makeStdio('update-me', '/bin/new'),
      makeStdio('add-me'),
    ]);

    expect(diff.added).toEqual(['add-me']);
    expect(diff.removed).toEqual(['remove-me']);
    expect(diff.updated).toEqual(['update-me']);
  });

  it('addServer 抛错时记入 warnings 不中断其他 server', async () => {
    addSpy.mockRestore();  // 恢复后重新 mock 让第一个抛错
    addSpy = vi.spyOn(mgr, 'addServer').mockImplementation((async (cfg: any) => {
      if (cfg.name === 'bad') throw new Error('启动超时');
      (mgr as any).configs.set(cfg.name, cfg);
    }) as any);

    const diff = await mgr.reloadAll([makeStdio('bad'), makeStdio('good')]);
    expect(diff.warnings.length).toBe(1);
    expect(diff.warnings[0]).toContain('bad');
    expect(diff.added).toEqual(['good']);
  });
});
