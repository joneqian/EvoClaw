/** 查询类型 */
export type QueryType = 'factual' | 'preference' | 'temporal' | 'skill' | 'general';

/** 查询分析结果 */
export interface QueryAnalysis {
  /** 提取的关键词列表 */
  keywords: string[];
  /** 时间范围（如有） */
  dateRange: { start?: string; end?: string } | null;
  /** 查询类型 */
  queryType: QueryType;
  /** 是否需要 L2 详细内容 */
  needsDetail: boolean;
}

/**
 * 分析用户查询，提取搜索参数
 */
export function analyzeQuery(query: string): QueryAnalysis {
  const keywords = extractKeywords(query);
  const dateRange = extractDateRange(query);
  const queryType = classifyQuery(query);
  const needsDetail = detectDetailNeed(query);

  return { keywords, dateRange, queryType, needsDetail };
}

/** 中文停用词 */
const CJK_STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  '自己', '这', '他', '她', '它', '什么', '那', '怎么', '吗', '吧', '呢', '啊',
  '还', '能', '让', '把', '被', '从', '给', '向', '对', '跟', '比', '没', '过',
  '记得', '知道', '觉得', '可以', '应该', '可能', '已经', '正在',
]);

/** 英文停用词 */
const EN_STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
  'may', 'might', 'can', 'shall', 'to', 'of', 'in', 'for', 'on', 'with',
  'at', 'by', 'from', 'as', 'into', 'about', 'that', 'this', 'it', 'i',
  'you', 'he', 'she', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their', 'what', 'which', 'who', 'how',
]);

/** CJK 字符正则 */
const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\uF900-\uFAFF]+/g;

/** 提取关键词 — 中文按字/词拆分，英文按空格分割，去停用词 */
function extractKeywords(query: string): string[] {
  const tokens: string[] = [];

  // 1. 提取中文片段，拆分为有意义的词
  const cjkMatches = query.match(CJK_RE) ?? [];
  for (const segment of cjkMatches) {
    // 先去掉多字停用词，再逐字去单字停用词
    let cleaned = segment;
    for (const sw of CJK_STOP_WORDS) {
      if (sw.length >= 2) {
        cleaned = cleaned.replaceAll(sw, '|');  // 用分隔符替代
      }
    }
    // 再按单字停用词切分
    const chars = [...cleaned];
    let current = '';
    for (const ch of chars) {
      if (ch === '|' || CJK_STOP_WORDS.has(ch)) {
        if (current.length >= 1) tokens.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.length >= 1) tokens.push(current);
  }

  // 2. 提取英文/数字片段
  const nonCjk = query.replace(CJK_RE, ' ');
  const parts = nonCjk
    .replace(/[，。！？、；：""''（）【】《》…—\-.,!?;:'"()\[\]{}<>\/\\@#$%^&*+=|~`]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (!EN_STOP_WORDS.has(lower) && lower.length > 1) {
      tokens.push(lower);
    }
  }

  // 3. 去重
  return [...new Set(tokens)];
}

/** 提取时间范围 */
function extractDateRange(query: string): { start?: string; end?: string } | null {
  const now = new Date();

  // 中文时间表达
  if (/上周|上个星期/.test(query)) {
    const start = new Date(now);
    start.setDate(start.getDate() - start.getDay() - 7);
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  if (/昨天/.test(query)) {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    const ds = d.toISOString().slice(0, 10);
    return { start: ds, end: ds };
  }
  if (/今天/.test(query)) {
    const ds = now.toISOString().slice(0, 10);
    return { start: ds, end: ds };
  }
  if (/这周|本周|这个星期/.test(query)) {
    const start = new Date(now);
    start.setDate(start.getDate() - start.getDay());
    return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
  }
  if (/上个月/.test(query)) {
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const end = new Date(now.getFullYear(), now.getMonth(), 0);
    return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
  }
  if (/最近(\d+)天/.test(query)) {
    const match = query.match(/最近(\d+)天/);
    if (match) {
      const days = parseInt(match[1], 10);
      const start = new Date(now);
      start.setDate(start.getDate() - days);
      return { start: start.toISOString().slice(0, 10), end: now.toISOString().slice(0, 10) };
    }
  }

  return null;
}

/** 分类查询类型 */
function classifyQuery(query: string): QueryType {
  // 偏好类信号
  if (/喜欢|偏好|习惯|倾向|prefer|like|habit|style|风格/.test(query)) return 'preference';
  // 时间类信号
  if (/什么时候|上次|昨天|上周|最近|以前|之前|when|last|recent|ago/.test(query)) return 'temporal';
  // 技能/方法类信号
  if (/怎么|如何|方法|步骤|教程|how to|how do|tutorial|guide/.test(query)) return 'skill';
  // 事实类信号
  if (/是什么|叫什么|哪个|多少|谁|定义|what is|who is|which|define/.test(query)) return 'factual';

  return 'general';
}

/** 检测是否需要详细内容（L2） */
function detectDetailNeed(query: string): boolean {
  return /详细|具体|详情|展开|全部|完整|detail|full|complete|elaborate|explain/.test(query);
}
