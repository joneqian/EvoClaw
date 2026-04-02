import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ToolUseSummaryGenerator } from '../cost/tool-use-summary.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asMock = (fn: any) => fn as ReturnType<typeof vi.fn>;

describe('ToolUseSummaryGenerator', () => {
  const mockLlm = vi.fn() as unknown as (s: string, u: string) => Promise<string>;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('生成 LLM 摘要', async () => {
    asMock(mockLlm).mockResolvedValueOnce('搜索 auth/ 目录下的文件');
    const generator = new ToolUseSummaryGenerator(mockLlm);

    const result = await generator.generateSummary([
      { toolName: 'grep', toolInput: { pattern: 'auth', path: 'src/' } },
    ]);

    expect(result).toBe('搜索 auth/ 目录下的文件');
    expect(asMock(mockLlm)).toHaveBeenCalledOnce();
  });

  it('截断过长摘要', async () => {
    const longSummary = '这'.repeat(70); // 70 个中文字符，超过 60 字符限制
    asMock(mockLlm).mockResolvedValueOnce(longSummary);
    const generator = new ToolUseSummaryGenerator(mockLlm);

    const result = await generator.generateSummary([
      { toolName: 'read', toolInput: { path: '/test.ts' } },
    ]);

    expect(result.length).toBeLessThanOrEqual(60);
    expect(result).toContain('...');
  });

  it('LLM 失败时回退到工具名', async () => {
    asMock(mockLlm).mockRejectedValueOnce(new Error('API 超时'));
    const generator = new ToolUseSummaryGenerator(mockLlm);

    const result = await generator.generateSummary([
      { toolName: 'grep', toolInput: { pattern: 'test' } },
      { toolName: 'read', toolInput: { path: '/a.ts' } },
    ]);

    expect(result).toBe('grep, read');
  });

  it('空工具列表返回空字符串', async () => {
    const generator = new ToolUseSummaryGenerator(mockLlm);
    const result = await generator.generateSummary([]);
    expect(result).toBe('');
    expect(asMock(mockLlm)).not.toHaveBeenCalled();
  });

  it('异步模式不抛错', async () => {
    asMock(mockLlm).mockRejectedValueOnce(new Error('失败'));
    const generator = new ToolUseSummaryGenerator(mockLlm);

    const result = await generator.generateAsync([
      { toolName: 'test', toolInput: {} },
    ]);

    expect(result).toBe('test');
  });

  it('多行 LLM 输出只取第一行', async () => {
    asMock(mockLlm).mockResolvedValueOnce('搜索文件\n这是解释');
    const generator = new ToolUseSummaryGenerator(mockLlm);

    const result = await generator.generateSummary([
      { toolName: 'grep', toolInput: { pattern: 'test' } },
    ]);

    expect(result).toBe('搜索文件');
  });
});
