/**
 * Markdown → 纯文本转换
 *
 * 微信不支持 Markdown 渲染，需要将 AI 模型输出的 Markdown 格式
 * 转为可读的纯文本。保留内容结构，去除格式标记。
 * 参考: @tencent-weixin/openclaw-weixin src/messaging/send.ts markdownToPlainText
 */

/**
 * 将 Markdown 格式文本转为纯文本
 *
 * 处理规则:
 * - 代码块: 去掉围栏标记，保留代码内容
 * - 图片: 完全移除
 * - 链接: 保留显示文本，移除 URL
 * - 粗体/斜体: 移除标记符号
 * - 标题: 移除 # 标记
 * - 表格: 移除分隔行，扁平化单元格
 * - 空行: 折叠连续空行
 */
export function markdownToPlainText(md: string): string {
  let result = md;

  // 代码块: 去掉围栏 (```lang\n...\n```)，保留代码内容
  result = result.replace(/```[^\n]*\n?([\s\S]*?)```/g, (_match, code: string) => code.trim());

  // 行内代码: 保留内容
  result = result.replace(/`([^`]+)`/g, '$1');

  // 图片: 完全移除 ![alt](url)
  result = result.replace(/!\[[^\]]*\]\([^)]*\)/g, '');

  // 链接: 保留显示文本 [text](url) → text
  result = result.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');

  // 表格分隔行: 移除 |---|---|
  result = result.replace(/^\|[\s:|-]+\|$/gm, '');

  // 表格内容行: |cell1|cell2| → cell1  cell2
  result = result.replace(/^\|(.+)\|$/gm, (_match, inner: string) =>
    inner
      .split('|')
      .map((cell) => cell.trim())
      .join('  '),
  );

  // 标题: 移除 # 标记
  result = result.replace(/^#{1,6}\s+/gm, '');

  // 粗体: **text** 或 __text__ → text
  result = result.replace(/\*\*(.+?)\*\*/g, '$1');
  result = result.replace(/__(.+?)__/g, '$1');

  // 斜体: *text* 或 _text_ → text (注意避免匹配已处理的内容)
  result = result.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '$1');
  result = result.replace(/(?<!\w)_([^_]+)_(?!\w)/g, '$1');

  // 删除线: ~~text~~ → text
  result = result.replace(/~~(.+?)~~/g, '$1');

  // 水平线: ---, ***, ___ → 空行
  result = result.replace(/^[-*_]{3,}$/gm, '');

  // 无序列表标记: - item 或 * item → item (保留缩进)
  result = result.replace(/^(\s*)[-*+]\s+/gm, '$1');

  // 有序列表标记: 1. item → item (保留缩进)
  result = result.replace(/^(\s*)\d+\.\s+/gm, '$1');

  // 引用块: > text → text
  result = result.replace(/^>\s?/gm, '');

  // 折叠连续空行为单个空行
  result = result.replace(/\n{3,}/g, '\n\n');

  // 去除首尾空白
  result = result.trim();

  return result;
}
