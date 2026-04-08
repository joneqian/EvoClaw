/**
 * SOP 标签 Zod Schema
 *
 * 客户服务旅程标签体系 — 最多两级父子结构。
 * 父标签仅有名称 + 子标签列表；子标签才承载完整字段（含义/需要做/不能做）。
 */

import { z } from 'zod';

/** 子标签（叶子节点） */
export const SopChildTag = z
  .object({
    name: z.string().min(1, '标签名称不能为空'),
    meaning: z.string().min(1, '标签含义不能为空'),
    mustDo: z.string().min(1, '需要做不能为空'),
    mustNotDo: z.string().min(1, '不能做不能为空'),
  })
  .strict(); // 拒绝 children 等额外字段，强制两级结构

export type SopChildTagT = z.infer<typeof SopChildTag>;

/** 父标签（仅名称 + children，不得承载子标签字段） */
export const SopParentTag = z
  .object({
    name: z.string().min(1, '父标签名称不能为空'),
    children: z.array(SopChildTag).min(1, '父标签至少需要一个子标签'),
  })
  .strict(); // 拒绝 meaning/mustDo/mustNotDo 等字段出现在父级

export type SopParentTagT = z.infer<typeof SopParentTag>;

/** 标签文件结构 */
export const SopTagsFile = z
  .object({
    version: z.literal(1),
    updatedAt: z.string().min(1),
    tags: z.array(SopParentTag),
  })
  .strict();

export type SopTagsFileT = z.infer<typeof SopTagsFile>;

/** 验证纯 tags 载荷（前端/工具输入） */
export function validateTagsPayload(
  input: unknown,
): { success: true; data: SopParentTagT[] } | { success: false; error: string } {
  if (!Array.isArray(input)) {
    return { success: false, error: 'tags 必须是数组' };
  }
  const result = z.array(SopParentTag).safeParse(input);
  if (!result.success) {
    return { success: false, error: formatZodError(result.error) };
  }
  return { success: true, data: result.data };
}

/** 格式化 Zod 错误为人类可读字符串 */
export function formatZodError(err: z.ZodError): string {
  return err.issues
    .map((issue) => {
      const path = issue.path.join('.');
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join('; ');
}

/** 创建默认空标签文件 */
export function emptyTagsFile(): SopTagsFileT {
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    tags: [],
  };
}
