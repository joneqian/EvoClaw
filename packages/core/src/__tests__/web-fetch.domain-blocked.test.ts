/**
 * M8 web_fetch 域名黑名单集成测试
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createWebFetchTool } from '../tools/web-fetch.js';
import { urlCache } from '../tools/web-cache.js';

describe('web_fetch — 域名黑名单', () => {
  beforeEach(() => {
    urlCache.clear();
  });

  it('命中 *. 通配符模式 → 拒绝（不发起网络请求）', async () => {
    const tool = createWebFetchTool({
      domainDenylist: ['*.internal.company.com'],
    });
    const result = (await tool.execute({ url: 'https://a.internal.company.com/data' }, {} as any)) as string;
    expect(result).toMatch(/域名策略拒绝访问/);
    expect(result).toContain('*.internal.company.com');
  });

  it('命中精确匹配 → 拒绝', async () => {
    const tool = createWebFetchTool({
      domainDenylist: ['malicious.example.com'],
    });
    const result = (await tool.execute({ url: 'https://malicious.example.com/x' }, {} as any)) as string;
    expect(result).toMatch(/域名策略拒绝访问/);
  });

  it('denylist getter 函数形式（热重载场景）', async () => {
    let denylist: string[] = [];
    const tool = createWebFetchTool({ domainDenylist: () => denylist });

    // 初始无规则：不因 denylist 拒绝（但可能因其它原因失败）
    const r1 = (await tool.execute({ url: 'https://nonexistent.example.invalid/' }, {} as any)) as string;
    expect(r1).not.toMatch(/域名策略拒绝访问/);

    // 添加规则后命中
    denylist = ['nonexistent.example.invalid'];
    const r2 = (await tool.execute({ url: 'https://nonexistent.example.invalid/' }, {} as any)) as string;
    expect(r2).toMatch(/域名策略拒绝访问/);
  });

  it('denylist 为空时不影响（回归）', async () => {
    const tool = createWebFetchTool({ domainDenylist: [] });
    const r = (await tool.execute({ url: 'https://nonexistent.example.invalid/' }, {} as any)) as string;
    expect(r).not.toMatch(/域名策略拒绝访问/);
  });
});
