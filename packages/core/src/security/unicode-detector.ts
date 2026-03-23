/**
 * Unicode 混淆检测器 — 检测同形字、不可见字符、NFKC 规范化差异
 */

export interface UnicodeDetectionResult {
  detected: boolean;
  issues: string[];
  normalized: string;
}

// ────── A. 同形字检测 ──────

/** Cyrillic → Latin 同形字映射 */
const CYRILLIC_CONFUSABLES = new Map<number, number>([
  [0x0430, 0x61], // а → a
  [0x0435, 0x65], // е → e
  [0x043E, 0x6F], // о → o
  [0x0440, 0x70], // р → p
  [0x0441, 0x63], // с → c
  [0x0445, 0x78], // х → x
  [0x0443, 0x79], // у → y (松散)
  [0x041A, 0x4B], // К → K
  [0x041C, 0x4D], // М → M
  [0x0410, 0x41], // А → A
  [0x0412, 0x42], // В → B
  [0x0415, 0x45], // Е → E
  [0x041D, 0x48], // Н → H
  [0x041E, 0x4F], // О → O
  [0x0420, 0x50], // Р → P
  [0x0421, 0x43], // С → C
  [0x0422, 0x54], // Т → T
  [0x0425, 0x58], // Х → X
]);

/** Greek → Latin 同形字映射 */
const GREEK_CONFUSABLES = new Map<number, number>([
  [0x03BF, 0x6F], // ο → o
  [0x03B1, 0x61], // α → a (松散)
  [0x039F, 0x4F], // Ο → O
  [0x0391, 0x41], // Α → A
  [0x0392, 0x42], // Β → B
  [0x0395, 0x45], // Ε → E
  [0x0396, 0x5A], // Ζ → Z
  [0x0397, 0x48], // Η → H
  [0x039A, 0x4B], // Κ → K
  [0x039C, 0x4D], // Μ → M
  [0x039D, 0x4E], // Ν → N
  [0x03A1, 0x50], // Ρ → P
  [0x03A4, 0x54], // Τ → T
  [0x03A7, 0x58], // Χ → X
]);

/** 合并同形字映射 */
const confusableMap = new Map<number, number>([
  ...CYRILLIC_CONFUSABLES,
  ...GREEK_CONFUSABLES,
]);

/** 数学字母范围 U+1D400-U+1D7FF */
function isMathAlphanumeric(code: number): boolean {
  return code >= 0x1D400 && code <= 0x1D7FF;
}

/** 全角 ASCII 范围 U+FF01-U+FF5E → 映射到 U+0021-U+007E */
function isFullwidthASCII(code: number): boolean {
  return code >= 0xFF01 && code <= 0xFF5E;
}

function fullwidthToASCII(code: number): number {
  return code - 0xFF01 + 0x0021;
}

// ────── B. 不可见字符检测 ──────

/** EvoClaw 反馈循环标记序列 */
const EVOCLAW_MARKER_SEQUENCE = '\u200B\u200C\u200B';

/** 不可见/危险 Unicode 码点 */
const INVISIBLE_CHARS = new Set<number>([
  0x200B, // 零宽空格
  0x200C, // 零宽非连接符
  0x200D, // 零宽连接符
  0x200E, // 从左到右标记
  0x200F, // 从右到左标记
  0x202A, // 从左到右嵌入
  0x202B, // 从右到左嵌入
  0x202C, // 弹出方向格式
  0x202D, // 从左到右覆盖
  0x202E, // 从右到左覆盖
  0x2066, // 从左到右隔离
  0x2067, // 从右到左隔离
  0x2068, // 首次强隔离
  0x2069, // 弹出方向隔离
  0x00AD, // 软连字符
  0x180E, // 蒙古文元音分隔符
]);

/** 检测不可见字符（排除 EvoClaw 标记序列） */
function detectInvisibleChars(text: string): string[] {
  const issues: string[] = [];
  // 先排除 EvoClaw 标记序列
  const stripped = text.replaceAll(EVOCLAW_MARKER_SEQUENCE, '');

  for (let i = 0; i < stripped.length; i++) {
    const code = stripped.codePointAt(i)!;
    if (INVISIBLE_CHARS.has(code)) {
      const name = getInvisibleCharName(code);
      const issue = `不可见字符 U+${code.toString(16).toUpperCase().padStart(4, '0')} (${name}) 于位置 ${i}`;
      if (!issues.includes(issue)) {
        issues.push(issue);
      }
    }
    // 处理代理对
    if (code > 0xFFFF) i++;
  }
  return issues;
}

function getInvisibleCharName(code: number): string {
  const names: Record<number, string> = {
    0x200B: '零宽空格',
    0x200C: '零宽非连接符',
    0x200D: '零宽连接符',
    0x200E: 'LTR 标记',
    0x200F: 'RTL 标记',
    0x202A: 'LTR 嵌入',
    0x202B: 'RTL 嵌入',
    0x202C: '弹出方向格式',
    0x202D: 'LTR 覆盖',
    0x202E: 'RTL 覆盖',
    0x2066: 'LTR 隔离',
    0x2067: 'RTL 隔离',
    0x2068: '首次强隔离',
    0x2069: '弹出方向隔离',
    0x00AD: '软连字符',
    0x180E: '蒙古文元音分隔符',
  };
  return names[code] ?? '未知';
}

// ────── C. 同形字扫描 ──────

function detectHomoglyphs(text: string): string[] {
  const issues: string[] = [];
  let hasCyrillic = false;
  let hasGreek = false;
  let hasMathAlpha = false;
  let hasFullwidth = false;

  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i)!;
    if (CYRILLIC_CONFUSABLES.has(code)) hasCyrillic = true;
    if (GREEK_CONFUSABLES.has(code)) hasGreek = true;
    if (isMathAlphanumeric(code)) hasMathAlpha = true;
    if (isFullwidthASCII(code)) hasFullwidth = true;
    if (code > 0xFFFF) i++;
  }

  // 混合脚本检测：文本同时包含 Latin + 可混淆脚本
  const hasLatin = /[a-zA-Z]/.test(text);
  if (hasLatin && hasCyrillic) issues.push('混合 Latin/Cyrillic 脚本');
  if (hasLatin && hasGreek) issues.push('混合 Latin/Greek 脚本');
  if (hasMathAlpha) issues.push('包含数学字母符号 (U+1D400-U+1D7FF)');
  if (hasFullwidth) issues.push('包含全角 ASCII 字符');

  return issues;
}

// ────── 公开 API ──────

/**
 * 将文本中的同形字和全角字符替换为 ASCII 等价物，并执行 NFKC 规范化
 */
export function normalizeUnicode(text: string): string {
  let result = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.codePointAt(i)!;

    // 同形字替换
    const mapped = confusableMap.get(code);
    if (mapped !== undefined) {
      result += String.fromCodePoint(mapped);
    } else if (isFullwidthASCII(code)) {
      result += String.fromCodePoint(fullwidthToASCII(code));
    } else if (INVISIBLE_CHARS.has(code)) {
      // 移除不可见字符（保留 EvoClaw 标记序列——由调用方决定）
      // 跳过
    } else {
      result += String.fromCodePoint(code);
    }

    if (code > 0xFFFF) i++;
  }

  // NFKC 规范化
  return result.normalize('NFKC');
}

/**
 * 检测文本中的 Unicode 混淆
 */
export function detectUnicodeConfusion(text: string): UnicodeDetectionResult {
  if (!text) {
    return { detected: false, issues: [], normalized: text };
  }

  const issues: string[] = [];

  // A. 同形字
  issues.push(...detectHomoglyphs(text));

  // B. 不可见字符
  issues.push(...detectInvisibleChars(text));

  // C. NFKC 差异
  const nfkc = text.normalize('NFKC');
  if (nfkc !== text) {
    issues.push('NFKC 规范化后内容发生变化');
  }

  const normalized = normalizeUnicode(text);

  return {
    detected: issues.length > 0,
    issues,
    normalized,
  };
}
