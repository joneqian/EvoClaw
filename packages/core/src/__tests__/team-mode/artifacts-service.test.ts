/**
 * ArtifactService 单元测试（M13 PR3）
 *
 * 覆盖：
 *   - attachArtifact 基础流（含校验：title/summary/kind 与 content/uri 组合）
 *   - inline 阈值（text 4KB / markdown 64KB / 其他必须 uri）
 *   - 同 task+title 自动 supersedes 旧版
 *   - listByTask / listByPlan / listLatestByTask
 *   - fetchArtifact summary（默认）/ full（inline）/ full（外部 URI 走 registry）
 *   - getById 找不到 → null
 *   - URI registry 分发（mock resolver）
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { MigrationRunner } from '../../infrastructure/db/migration-runner.js';
import { AgentManager } from '../../agent/agent-manager.js';
import { TaskPlanService } from '../../agent/team-mode/task-plan/service.js';
import { ArtifactService } from '../../agent/team-mode/artifacts/service.js';
import {
  ArtifactURIRegistry,
  type ArtifactURIResolver,
} from '../../agent/team-mode/artifacts/uri-resolver.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

async function setup(): Promise<{
  store: SqliteStore;
  agentManager: AgentManager;
  planService: TaskPlanService;
  artifactService: ArtifactService;
  uriRegistry: ArtifactURIRegistry;
  tmpDir: string;
  agents: { A: string; B: string; C: string };
  planId: string;
  taskIds: { t1: string; t2: string };
}> {
  const store = new SqliteStore(':memory:');
  const mig = new MigrationRunner(store);
  await mig.run();
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm13-art-'));
  const agentManager = new AgentManager(store, tmpDir);
  const A = (await agentManager.createAgent({ name: 'PM' })).id;
  const B = (await agentManager.createAgent({ name: 'BE' })).id;
  const C = (await agentManager.createAgent({ name: 'DE' })).id;
  for (const id of [A, B, C]) store.run(`UPDATE agents SET status='active' WHERE id = ?`, id);

  const planService = new TaskPlanService({ store, agentManager });
  const uriRegistry = new ArtifactURIRegistry();
  const artifactService = new ArtifactService({ store, uriRegistry });

  const planSnap = await planService.createPlan(
    {
      goal: 'demo',
      tasks: [
        { localId: 't1', title: '任务1', assigneeAgentId: B },
        { localId: 't2', title: '任务2', assigneeAgentId: C, dependsOn: ['t1'] },
      ],
    },
    { groupSessionKey: 'feishu:chat:oc_x', createdByAgentId: A, initiatorUserId: 'user-1' },
  );

  const t1 = store.get<{ id: string }>(
    'SELECT id FROM tasks WHERE plan_id = ? AND local_id = ?',
    planSnap.id, 't1',
  )!.id;
  const t2 = store.get<{ id: string }>(
    'SELECT id FROM tasks WHERE plan_id = ? AND local_id = ?',
    planSnap.id, 't2',
  )!.id;

  return {
    store,
    agentManager,
    planService,
    artifactService,
    uriRegistry,
    tmpDir,
    agents: { A, B, C },
    planId: planSnap.id,
    taskIds: { t1, t2 },
  };
}

describe('ArtifactService', () => {
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeEach(async () => {
    ctx = await setup();
  });

  afterEach(() => {
    if (ctx.tmpDir && fs.existsSync(ctx.tmpDir)) {
      fs.rmSync(ctx.tmpDir, { recursive: true, force: true });
    }
  });

  it('attach text inline ok', async () => {
    const a = await ctx.artifactService.attachArtifact(
      {
        taskId: ctx.taskIds.t1,
        kind: 'text',
        title: '简短结论',
        summary: '一句话',
        content: '内容很短',
      },
      ctx.agents.B,
    );
    expect(a.kind).toBe('text');
    expect(a.inlineContent).toBe('内容很短');
    expect(a.uri).toContain('evoclaw-artifact://');
  });

  it('attach markdown inline 超 64KB 拒绝', async () => {
    const big = 'x'.repeat(70 * 1024);
    await expect(
      ctx.artifactService.attachArtifact(
        { taskId: ctx.taskIds.t1, kind: 'markdown', title: '长文', summary: '...', content: big },
        ctx.agents.B,
      ),
    ).rejects.toThrow(/超长/);
  });

  it('attach image 必须 uri', async () => {
    await expect(
      ctx.artifactService.attachArtifact(
        { taskId: ctx.taskIds.t1, kind: 'image', title: '图', summary: '...' },
        ctx.agents.B,
      ),
    ).rejects.toThrow(/必须提供 uri/);
  });

  it('attach image 不允许 inline content', async () => {
    await expect(
      ctx.artifactService.attachArtifact(
        {
          taskId: ctx.taskIds.t1,
          kind: 'image',
          title: '图',
          summary: '...',
          content: '不该内联',
          uri: 'feishu-image://k1',
        },
        ctx.agents.B,
      ),
    ).rejects.toThrow(/不允许同时提供 content/);
  });

  it('attach 缺 title / summary 失败', async () => {
    await expect(
      ctx.artifactService.attachArtifact(
        { taskId: ctx.taskIds.t1, kind: 'text', title: '', summary: 's', content: 'x' },
        ctx.agents.B,
      ),
    ).rejects.toThrow(/title/);
    await expect(
      ctx.artifactService.attachArtifact(
        { taskId: ctx.taskIds.t1, kind: 'text', title: 't', summary: '', content: 'x' },
        ctx.agents.B,
      ),
    ).rejects.toThrow(/summary/);
  });

  it('attach taskId 不存在 → throw', async () => {
    await expect(
      ctx.artifactService.attachArtifact(
        { taskId: 'ghost', kind: 'text', title: 't', summary: 's', content: 'c' },
        ctx.agents.B,
      ),
    ).rejects.toThrow(/不存在/);
  });

  it('同 task+title 自动 supersedes', async () => {
    const a1 = await ctx.artifactService.attachArtifact(
      { taskId: ctx.taskIds.t1, kind: 'text', title: 'v', summary: 'A', content: '1' },
      ctx.agents.B,
    );
    const a2 = await ctx.artifactService.attachArtifact(
      { taskId: ctx.taskIds.t1, kind: 'text', title: 'v', summary: 'B', content: '2' },
      ctx.agents.B,
    );
    expect(a2.supersedesId).toBe(a1.id);
    expect(a1.supersedesId).toBeUndefined();

    const latest = ctx.artifactService.listLatestByTask(ctx.taskIds.t1);
    expect(latest.map((a) => a.id)).toEqual([a2.id]);
    const all = ctx.artifactService.listByTask(ctx.taskIds.t1);
    expect(all.length).toBe(2);
  });

  it('listByPlan 跨任务汇总', async () => {
    await ctx.artifactService.attachArtifact(
      { taskId: ctx.taskIds.t1, kind: 'text', title: 'a', summary: 's', content: 'x' },
      ctx.agents.B,
    );
    await ctx.artifactService.attachArtifact(
      { taskId: ctx.taskIds.t2, kind: 'doc', title: 'b', summary: 's', uri: 'feishu-doc://abc' },
      ctx.agents.C,
    );
    const all = ctx.artifactService.listByPlan(ctx.planId);
    expect(all.length).toBe(2);
  });

  it('fetch summary 模式（默认）只返摘要', async () => {
    const a = await ctx.artifactService.attachArtifact(
      { taskId: ctx.taskIds.t1, kind: 'text', title: 't', summary: '一行', content: '全文' },
      ctx.agents.B,
    );
    const result = await ctx.artifactService.fetchArtifact({ artifactId: a.id });
    expect(result?.fullLoaded).toBe(false);
    expect(result?.content).toBe('一行');
  });

  it('fetch full inline → 直接返回', async () => {
    const a = await ctx.artifactService.attachArtifact(
      { taskId: ctx.taskIds.t1, kind: 'markdown', title: 'doc', summary: '...', content: '## 全文内容' },
      ctx.agents.B,
    );
    const result = await ctx.artifactService.fetchArtifact({ artifactId: a.id, mode: 'full' });
    expect(result?.fullLoaded).toBe(true);
    expect(result?.content).toBe('## 全文内容');
  });

  it('fetch full URI 走 uri-resolver registry', async () => {
    const mockResolver: ArtifactURIResolver = {
      schemes: ['feishu-doc'],
      async fetchUri() {
        return { content: '云文档全文', fullLoaded: true };
      },
    };
    ctx.uriRegistry.register(mockResolver);

    const a = await ctx.artifactService.attachArtifact(
      { taskId: ctx.taskIds.t1, kind: 'doc', title: 'D', summary: 's', uri: 'feishu-doc://abc' },
      ctx.agents.B,
    );
    const result = await ctx.artifactService.fetchArtifact({ artifactId: a.id, mode: 'full' });
    expect(result?.fullLoaded).toBe(true);
    expect(result?.content).toBe('云文档全文');
  });

  it('fetch full URI 无 resolver → fallback', async () => {
    const a = await ctx.artifactService.attachArtifact(
      { taskId: ctx.taskIds.t1, kind: 'doc', title: 'D', summary: 's', uri: 'feishu-doc://abc' },
      ctx.agents.B,
    );
    const result = await ctx.artifactService.fetchArtifact({ artifactId: a.id, mode: 'full' });
    expect(result?.fullLoaded).toBe(false);
    expect(result?.fallbackReason).toBe('no-resolver');
  });

  it('fetch http URL 不下载，只返回 URL', async () => {
    const a = await ctx.artifactService.attachArtifact(
      { taskId: ctx.taskIds.t1, kind: 'link', title: 'L', summary: 's', uri: 'https://example.com/x' },
      ctx.agents.B,
    );
    const result = await ctx.artifactService.fetchArtifact({ artifactId: a.id, mode: 'full' });
    expect(result?.fullLoaded).toBe(false);
    expect(result?.content).toContain('https://example.com/x');
  });

  it('fetchArtifact 找不到 → null', async () => {
    const result = await ctx.artifactService.fetchArtifact({ artifactId: 'ghost' });
    expect(result).toBeNull();
  });

  it('fetch full file:// 文本文件', async () => {
    const tmpFile = path.join(ctx.tmpDir, 'sample.md');
    fs.writeFileSync(tmpFile, '# Hello');
    const a = await ctx.artifactService.attachArtifact(
      {
        taskId: ctx.taskIds.t1,
        kind: 'file',
        title: 'F',
        summary: 's',
        uri: `file://${tmpFile}`,
        mimeType: 'text/markdown',
      },
      ctx.agents.B,
    );
    const result = await ctx.artifactService.fetchArtifact({ artifactId: a.id, mode: 'full' });
    expect(result?.fullLoaded).toBe(true);
    expect(result?.content).toBe('# Hello');
  });
});
