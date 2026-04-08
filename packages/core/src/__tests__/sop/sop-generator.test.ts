import { describe, it, expect, vi } from 'vitest';
import { generateSopDraft, type GenerateOptions } from '../../sop/sop-generator.js';
import type { SopParentTagT } from '../../sop/sop-schema.js';

const validJson = `[
  {
    "name": "咨询阶段",
    "children": [
      {
        "name": "首次咨询",
        "meaning": "客户首次接触，尚未建立信任",
        "mustDo": "主动问候，快速回应，收集基础信息",
        "mustNotDo": "直接推销产品，使用专业术语"
      }
    ]
  }
]`;

const validTags: SopParentTagT[] = [
  {
    name: '咨询阶段',
    children: [
      {
        name: '首次咨询',
        meaning: '客户首次接触，尚未建立信任',
        mustDo: '主动问候，快速回应，收集基础信息',
        mustNotDo: '直接推销产品，使用专业术语',
      },
    ],
  },
];

function makeOpts(llmCall: GenerateOptions['llmCall'], extra?: Partial<GenerateOptions>): GenerateOptions {
  return {
    llmCall,
    docs: [{ name: 'test.md', text: '# SOP\n\n咨询阶段：客户首次接触' }],
    ...extra,
  };
}

describe('generateSopDraft', () => {
  it('成功路径：LLM 返回纯 JSON 数组', async () => {
    const llmCall = vi.fn().mockResolvedValue(validJson);
    const result = await generateSopDraft(makeOpts(llmCall));
    expect(result.tags).toEqual(validTags);
    expect(llmCall).toHaveBeenCalledTimes(1);
  });

  it('剥离 markdown code fence: ```json ... ```', async () => {
    const wrapped = '```json\n' + validJson + '\n```';
    const llmCall = vi.fn().mockResolvedValue(wrapped);
    const result = await generateSopDraft(makeOpts(llmCall));
    expect(result.tags).toEqual(validTags);
  });

  it('剥离裸 ``` ... ``` (无语言标签)', async () => {
    const wrapped = '```\n' + validJson + '\n```';
    const llmCall = vi.fn().mockResolvedValue(wrapped);
    const result = await generateSopDraft(makeOpts(llmCall));
    expect(result.tags).toEqual(validTags);
  });

  it('剥离前后多余文字（容错）', async () => {
    const noisy = `好的，这是设计好的标签草稿：\n\n${validJson}\n\n请审核。`;
    const llmCall = vi.fn().mockResolvedValue(noisy);
    const result = await generateSopDraft(makeOpts(llmCall));
    expect(result.tags).toEqual(validTags);
  });

  it('JSON 非法 → 重试一次（带错误信息）→ 第二次成功', async () => {
    const llmCall = vi
      .fn()
      .mockResolvedValueOnce('not json at all')
      .mockResolvedValueOnce(validJson);
    const result = await generateSopDraft(makeOpts(llmCall));
    expect(result.tags).toEqual(validTags);
    expect(llmCall).toHaveBeenCalledTimes(2);
    // 第二次调用应该带错误信息
    const secondCall = llmCall.mock.calls[1]!;
    expect(secondCall[1]).toContain('上一次');
  });

  it('JSON 合法但 schema 失败 → 重试 → 第二次成功', async () => {
    const invalidSchema = JSON.stringify([{ name: '父', children: [] }]); // 空 children
    const llmCall = vi
      .fn()
      .mockResolvedValueOnce(invalidSchema)
      .mockResolvedValueOnce(validJson);
    const result = await generateSopDraft(makeOpts(llmCall));
    expect(result.tags).toEqual(validTags);
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('两次都失败 → 抛错', async () => {
    const llmCall = vi.fn().mockResolvedValue('garbage');
    await expect(generateSopDraft(makeOpts(llmCall))).rejects.toThrow();
    expect(llmCall).toHaveBeenCalledTimes(2);
  });

  it('空 docs 数组抛错', async () => {
    const llmCall = vi.fn();
    await expect(
      generateSopDraft(makeOpts(llmCall, { docs: [] })),
    ).rejects.toThrow(/没有可用的 SOP 文档/);
    expect(llmCall).not.toHaveBeenCalled();
  });

  it('user prompt 包含所有文档名称和内容', async () => {
    const llmCall = vi.fn().mockResolvedValue(validJson);
    await generateSopDraft(
      makeOpts(llmCall, {
        docs: [
          { name: 'doc1.md', text: '内容 A' },
          { name: 'doc2.md', text: '内容 B' },
        ],
      }),
    );
    const userPrompt = llmCall.mock.calls[0]![1] as string;
    expect(userPrompt).toContain('doc1.md');
    expect(userPrompt).toContain('内容 A');
    expect(userPrompt).toContain('doc2.md');
    expect(userPrompt).toContain('内容 B');
  });

  it('instruction 注入到 user prompt', async () => {
    const llmCall = vi.fn().mockResolvedValue(validJson);
    await generateSopDraft(
      makeOpts(llmCall, { instruction: '请加上售前阶段' }),
    );
    const userPrompt = llmCall.mock.calls[0]![1] as string;
    expect(userPrompt).toContain('请加上售前阶段');
  });

  it('existingDraft 注入到 user prompt（refinement 场景）', async () => {
    const llmCall = vi.fn().mockResolvedValue(validJson);
    const existing: SopParentTagT[] = [
      {
        name: '老阶段',
        children: [{ name: '老子', meaning: 'a', mustDo: 'b', mustNotDo: 'c' }],
      },
    ];
    await generateSopDraft(makeOpts(llmCall, { existingDraft: existing }));
    const userPrompt = llmCall.mock.calls[0]![1] as string;
    expect(userPrompt).toContain('老阶段');
  });

  it('system prompt 包含 schema 和约束', async () => {
    const llmCall = vi.fn().mockResolvedValue(validJson);
    await generateSopDraft(makeOpts(llmCall));
    const systemPrompt = llmCall.mock.calls[0]![0] as string;
    expect(systemPrompt).toContain('mustDo');
    expect(systemPrompt).toContain('mustNotDo');
    expect(systemPrompt).toContain('JSON');
    expect(systemPrompt).toMatch(/两级|2.{0,2}level/i);
  });
});
