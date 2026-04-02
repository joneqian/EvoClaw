import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionSummarizer } from '../memory/session-summarizer.js';
import { createSessionSummaryPlugin } from '../context/plugins/session-summary.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { TurnContext } from '../context/plugin.interface.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asMock = (fn: any) => fn as ReturnType<typeof vi.fn>;

function createMockDb(): SqliteStore {
  return {
    all: vi.fn().mockReturnValue([]),
    get: vi.fn().mockReturnValue(null),
    run: vi.fn(),
    transaction: vi.fn((fn: () => void) => fn()),
  } as unknown as SqliteStore;
}

function createMockContext(tokenEstimate = 500, overrides: Partial<TurnContext> = {}): TurnContext {
  // 生成 content 长度约等于 tokenEstimate * 4
  const content = '测'.repeat(tokenEstimate);
  return {
    agentId: 'agent-1',
    sessionKey: 'agent:agent-1:default:dm:user-1',
    messages: [
      { role: 'user', content },
      { role: 'assistant', content: '回复内容' },
    ],
    systemPrompt: '',
    injectedContext: [],
    estimatedTokens: tokenEstimate,
    tokenLimit: 100000,
    warnings: [],
    ...overrides,
  } as TurnContext;
}

describe('SessionSummarizer', () => {
  let db: SqliteStore;
  const mockLlm = vi.fn().mockResolvedValue('## 摘要\n这是一段摘要') as unknown as (s: string, u: string) => Promise<string>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    asMock(mockLlm).mockResolvedValue('## 摘要\n这是一段摘要');
  });

  it('生成全量摘要', async () => {
    const summarizer = new SessionSummarizer(db, mockLlm);
    const result = await summarizer.summarize('agent-1', 'session-1', [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好！' },
    ] as TurnContext['messages']);

    expect(result).toContain('摘要');
    expect(asMock(mockLlm)).toHaveBeenCalledOnce();
  });

  it('增量更新摘要', async () => {
    const summarizer = new SessionSummarizer(db, mockLlm);
    const result = await summarizer.summarize('agent-1', 'session-1', [
      { role: 'user', content: '新内容' },
    ] as TurnContext['messages'], '旧摘要');

    expect(result).toContain('摘要');
    // LLM 调用时 user prompt 应包含旧摘要
    const userPrompt = asMock(mockLlm).mock.calls[0][1] as string;
    expect(userPrompt).toContain('旧摘要');
  });

  it('LLM 失败时返回已有摘要', async () => {
    asMock(mockLlm).mockRejectedValueOnce(new Error('API 错误'));
    const summarizer = new SessionSummarizer(db, mockLlm);
    const result = await summarizer.summarize('agent-1', 'session-1', [], '旧摘要');
    expect(result).toBe('旧摘要');
  });

  it('读取已有摘要', () => {
    (db.get as ReturnType<typeof vi.fn>).mockReturnValue({ summary_markdown: '已保存的摘要' });
    const summarizer = new SessionSummarizer(db, mockLlm);
    const result = summarizer.getExisting('agent-1', 'session-1');
    expect(result).toBe('已保存的摘要');
  });

  it('无已有摘要返回 null', () => {
    const summarizer = new SessionSummarizer(db, mockLlm);
    const result = summarizer.getExisting('agent-1', 'session-1');
    expect(result).toBeNull();
  });
});

describe('SessionSummaryPlugin', () => {
  let db: SqliteStore;
  const mockLlm = vi.fn().mockResolvedValue('摘要') as unknown as (s: string, u: string) => Promise<string>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = createMockDb();
    asMock(mockLlm).mockResolvedValue('摘要');
  });

  it('首轮注入已有摘要', async () => {
    (db.get as ReturnType<typeof vi.fn>).mockReturnValue({ summary_markdown: '上次的摘要' });
    const summarizer = new SessionSummarizer(db, mockLlm);
    const plugin = createSessionSummaryPlugin(summarizer);
    const ctx = createMockContext();

    await plugin.beforeTurn!(ctx);
    expect(ctx.injectedContext).toHaveLength(1);
    expect(ctx.injectedContext[0]).toContain('上次的摘要');
  });

  it('首轮无已有摘要不注入', async () => {
    const summarizer = new SessionSummarizer(db, mockLlm);
    const plugin = createSessionSummaryPlugin(summarizer);
    const ctx = createMockContext();

    await plugin.beforeTurn!(ctx);
    expect(ctx.injectedContext).toHaveLength(0);
  });

  it('达到初始阈值时触发摘要', async () => {
    const summarizer = new SessionSummarizer(db, mockLlm);
    const plugin = createSessionSummaryPlugin(summarizer);

    // 插件内 token 估算 = content.length / 4
    // 需要累计 10K tokens → content.length 需约 40K 字符
    // 第一轮：20K chars ≈ 5000 tokens，不触发
    await plugin.afterTurn!(createMockContext(20000));
    expect(asMock(mockLlm)).not.toHaveBeenCalled();

    // 第二轮：再加 24K chars ≈ 6000 tokens = 累计 11000 > 10000，触发
    await plugin.afterTurn!(createMockContext(24000));
    await new Promise(r => setTimeout(r, 10));
    expect(asMock(mockLlm)).toHaveBeenCalled();
  });

  it('未达到阈值不触发', async () => {
    const summarizer = new SessionSummarizer(db, mockLlm);
    const plugin = createSessionSummaryPlugin(summarizer);

    // 8K chars ≈ 2000 tokens, 累计 4000 < 10000
    await plugin.afterTurn!(createMockContext(8000));
    await plugin.afterTurn!(createMockContext(8000));
    await new Promise(r => setTimeout(r, 10));
    expect(asMock(mockLlm)).not.toHaveBeenCalled();
  });
});
