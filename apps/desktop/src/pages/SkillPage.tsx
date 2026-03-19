import { useState, useEffect, useCallback } from 'react';
import { get, post, del } from '../lib/api';
import { BRAND_NAME } from '@evoclaw/shared';

// ─── 类型 ───

interface GateResult {
  type: string;
  name: string;
  satisfied: boolean;
  message?: string;
}

interface InstalledSkillItem {
  name: string;
  description: string;
  version?: string;
  author?: string;
  source: 'clawhub' | 'github' | 'local';
  installPath: string;
  gatesPassed: boolean;
  gateResults?: GateResult[];
  disableModelInvocation: boolean;
}

interface SkillItem {
  name: string;
  slug?: string;
  description: string;
  descriptionZh?: string;
  version?: string;
  author?: string;
  downloads?: number;
  installs?: number;
  stars?: number;
  score?: number;
  category?: string;
  source: string;
}

interface PrepareResult {
  prepareId: string;
  metadata: { name: string; description: string; version?: string };
  securityReport: {
    riskLevel: 'low' | 'medium' | 'high';
    findings: Array<{ type: string; file: string; line: number; snippet: string; severity: string }>;
  };
  gateResults?: Array<{ type: string; name: string; satisfied: boolean; message?: string }>;
}

type TabType = 'brand' | 'store' | 'my';

// ─── 品牌自有技能数据 ───

interface BrandSkill {
  name: string;
  description: string;
}

interface BrandCategory {
  id: string;
  name: string;
  icon: string;
  color: string;
  skills: BrandSkill[];
}

const BRAND_CATEGORIES: BrandCategory[] = [
  {
    id: 'health-guard',
    name: '健康守护',
    icon: '🛡️',
    color: 'from-blue-500 to-cyan-400',
    skills: [
      { name: '用药智能提醒', description: '根据处方和用药计划，智能推送服药提醒，避免漏服误服' },
      { name: '血压 / 血糖数据管理', description: '记录并可视化血压、血糖等健康指标，趋势分析与异常预警' },
      { name: '慢病风险预警', description: '基于健康数据和生活习惯，评估慢性病风险并给出干预建议' },
      { name: '家庭健康档案', description: '为家庭成员建立健康档案，统一管理体检报告与健康记录' },
    ],
  },
  {
    id: 'nutrition',
    name: '营养膳食',
    icon: '🥗',
    color: 'from-green-500 to-emerald-400',
    skills: [
      { name: '食物热量与 GI 查询', description: '快速查询食物热量、升糖指数等营养信息，辅助饮食决策' },
      { name: '场景化食谱推荐', description: '根据健康目标、口味偏好和食材，推荐个性化食谱方案' },
      { name: '饮水计划与提醒', description: '制定科学饮水计划，定时提醒补水，记录每日饮水量' },
      { name: '减脂 / 控糖饮食方案', description: '针对减脂或控糖需求，定制饮食方案和每日营养摄入建议' },
    ],
  },
  {
    id: 'exercise',
    name: '运动指导',
    icon: '💪',
    color: 'from-orange-500 to-amber-400',
    skills: [
      { name: '居家私教口令', description: '语音引导居家运动，提供专业动作指导和实时节奏控制' },
      { name: 'HIIT / 间歇训练计时器', description: '可自定义间歇训练方案，自动计时并语音提示切换动作' },
      { name: '运动恢复指导', description: '运动后提供拉伸放松方案，预防运动损伤和肌肉酸痛' },
      { name: '体能目标追踪', description: '设定运动目标并追踪进度，记录训练数据和体能变化' },
    ],
  },
  {
    id: 'medication',
    name: '用药提醒',
    icon: '💊',
    color: 'from-purple-500 to-violet-400',
    skills: [
      { name: '慢病药物定时提醒', description: '支持多种药物和复杂用药时间表，确保按时服药' },
      { name: '漏服 / 重复服药智能判断', description: '智能识别漏服和重复服药情况，给出补服或跳过建议' },
      { name: '服药依从度周报', description: '生成每周服药依从度报告，帮助了解用药习惯和改进空间' },
      { name: '药品库存与续药提醒', description: '追踪药品库存，在药量不足时提前提醒续药或购药' },
    ],
  },
  {
    id: 'cardiovascular',
    name: '心血管守护',
    icon: '❤️',
    color: 'from-red-500 to-rose-400',
    skills: [
      { name: '高血压生活方式干预建议', description: '基于血压数据，提供饮食、运动、情绪等全方位生活方式干预' },
      { name: '冠心病日常行为禁忌提示', description: '针对冠心病患者，提醒日常需注意的行为禁忌和安全事项' },
      { name: '脑卒中高危因素自查', description: '通过问卷和数据分析，评估脑卒中风险等级并给出预防方案' },
      { name: '晨起 / 夜间风险时段关怀', description: '在心血管事件高发时段主动关怀，提醒注意事项和应急措施' },
    ],
  },
];
type SortBy = 'score' | 'downloads' | 'installs';

// ─── 分类 ───

const CATEGORIES = [
  { id: '', label: '全部' },
  { id: 'ai-intelligence', label: 'AI 智能' },
  { id: 'developer-tools', label: '开发工具' },
  { id: 'productivity', label: '效率提升' },
  { id: 'data-analysis', label: '数据分析' },
  { id: 'content-creation', label: '内容创作' },
  { id: 'security-compliance', label: '安全合规' },
  { id: 'communication-collaboration', label: '通讯协作' },
];

const SORT_OPTIONS: Array<{ id: SortBy; label: string }> = [
  { id: 'score', label: '热度' },
  { id: 'downloads', label: '下载量' },
  { id: 'installs', label: '安装量' },
];

function formatCount(n?: number): string {
  if (!n) return '0';
  if (n >= 10000) return `${(n / 10000).toFixed(n >= 100000 ? 0 : 1)}万`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

const RISK_STYLES: Record<string, { label: string; color: string }> = {
  low: { label: '低风险', color: 'text-green-600 bg-green-50' },
  medium: { label: '中风险', color: 'text-yellow-600 bg-yellow-50' },
  high: { label: '高风险', color: 'text-red-600 bg-red-50' },
};

// ─── 主页面 ───

export default function SkillPage() {
  const [tab, setTab] = useState<TabType>('brand');
  const [category, setCategory] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('score');
  const [keyword, setKeyword] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 24;

  const [storeSkills, setStoreSkills] = useState<SkillItem[]>([]);
  const [storeLoading, setStoreLoading] = useState(false);

  const [skills, setSkills] = useState<InstalledSkillItem[]>([]);
  const [loading, setLoading] = useState(false);

  const [detailSkill, setDetailSkill] = useState<SkillItem | null>(null);
  const [prepareResult, setPrepareResult] = useState<PrepareResult | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');

  /** 加载商店列表 */
  const fetchStore = useCallback(async () => {
    setStoreLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page), pageSize: String(pageSize), sortBy,
      });
      if (category) params.set('category', category);
      if (keyword.trim()) params.set('keyword', keyword.trim());

      const data = await get<{ results: SkillItem[]; total: number }>(`/skill/browse?${params.toString()}`);
      setStoreSkills(data.results);
      setTotal(data.total);
    } catch { setStoreSkills([]); setTotal(0); }
    finally { setStoreLoading(false); }
  }, [page, pageSize, sortBy, category, keyword]);

  /** 加载已安装列表 */
  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get<{ skills: InstalledSkillItem[] }>('/skill/list');
      setSkills(data.skills);
    } catch { setSkills([]); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);
  useEffect(() => { fetchStore(); }, [fetchStore]);

  // 切换分类/排序时重置页码
  useEffect(() => { setPage(1); }, [category, sortBy, keyword]);

  const handleSearch = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') fetchStore();
  };

  const handlePrepare = useCallback(async (slug: string) => {
    setInstalling(true); setError('');
    try {
      const data = await post<{ result: PrepareResult }>('/skill/prepare', { source: 'clawhub', identifier: slug });
      setPrepareResult(data.result);
    } catch (err) { setError(err instanceof Error ? err.message : '准备安装失败'); }
    finally { setInstalling(false); }
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!prepareResult) return;
    setInstalling(true); setError('');
    try {
      await post('/skill/confirm', { prepareId: prepareResult.prepareId });
      setPrepareResult(null);
      await fetchSkills();
    } catch (err) { setError(err instanceof Error ? err.message : '安装失败'); }
    finally { setInstalling(false); }
  }, [prepareResult, fetchSkills]);

  const handleUninstall = useCallback(async (name: string) => {
    try { await del(`/skill/${encodeURIComponent(name)}`); await fetchSkills(); }
    catch (err) { setError(err instanceof Error ? err.message : '卸载失败'); }
  }, [fetchSkills]);

  const installedNames = new Set(skills.map(s => s.name));
  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="h-full flex flex-col bg-white">
      {/* ─── 顶栏 ─── */}
      <div className="px-6 pt-4 pb-0 flex items-center gap-4">
        {/* Tab */}
        <div className="flex bg-slate-100 rounded-lg p-0.5 shrink-0">
          <button onClick={() => setTab('brand')}
            className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${tab === 'brand' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
          >{BRAND_NAME} 精选</button>
          <button onClick={() => setTab('my')}
            className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${tab === 'my' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
          >我的技能{skills.length > 0 && ` (${skills.length})`}</button>
        </div>
        <div className="flex-1" />

        {/* 搜索 */}
        <div className="relative w-[240px] shrink-0">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input type="text" value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={handleSearch}
            placeholder="搜索技能，回车确认"
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand placeholder:text-slate-400"
          />
        </div>
      </div>

      {error && <p className="text-xs text-red-500 px-6 mt-2">{error}</p>}

      {/* 安装确认弹窗 */}
      {prepareResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setPrepareResult(null)}>
          <div className="bg-white rounded-xl shadow-xl w-[420px] p-5" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-slate-900 mb-1">
              安装 {prepareResult.metadata.name}
              {prepareResult.metadata.version && <span className="text-xs text-slate-400 ml-1.5">v{prepareResult.metadata.version}</span>}
            </h3>
            <p className="text-xs text-slate-500 mb-3">{prepareResult.metadata.description}</p>
            <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium mb-3 ${RISK_STYLES[prepareResult.securityReport.riskLevel]?.color ?? ''}`}>
              {prepareResult.securityReport.riskLevel === 'low' ? '✓' : '⚠'}
              {RISK_STYLES[prepareResult.securityReport.riskLevel]?.label}
            </div>
            {prepareResult.gateResults && prepareResult.gateResults.length > 0 && (
              <div className="mb-3 space-y-1">
                <p className="text-xs font-medium text-slate-600">环境要求：</p>
                {prepareResult.gateResults.map((g, i) => (
                  <div key={i} className={`text-xs ${g.satisfied ? 'text-green-600' : 'text-red-500'}`}>
                    {g.satisfied ? '✓' : '✗'} {g.name}
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2 mt-4">
              <button onClick={() => setPrepareResult(null)} className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">取消</button>
              <button onClick={handleConfirm} disabled={installing || prepareResult.securityReport.riskLevel === 'high'}
                className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-brand text-white hover:bg-brand-hover disabled:opacity-40"
              >{installing ? '安装中...' : '确认安装'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 技能详情弹窗 ─── */}
      {detailSkill && !prepareResult && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDetailSkill(null)}>
          <div className="bg-white rounded-xl shadow-xl w-[520px] max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            {/* 头部 */}
            <div className="p-5 border-b border-slate-100">
              <div className="flex items-start gap-4">
                <div className="w-14 h-14 rounded-xl bg-slate-50 flex items-center justify-center shrink-0">
                  <svg className="w-7 h-7 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-base font-bold text-slate-900">{detailSkill.name}</h3>
                  {detailSkill.author && <p className="text-xs text-slate-400 mt-0.5">by {detailSkill.author}</p>}
                  <div className="flex items-center gap-3 mt-2">
                    {detailSkill.version && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-500">v{detailSkill.version}</span>
                    )}
                    {detailSkill.category && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-brand/10 text-brand-active">
                        {CATEGORIES.find(c => c.id === detailSkill.category)?.label ?? detailSkill.category}
                      </span>
                    )}
                  </div>
                </div>
                <button onClick={() => setDetailSkill(null)} className="text-slate-400 hover:text-slate-600 transition-colors shrink-0 mt-1">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>

            {/* 统计数据 */}
            <div className="px-5 py-3 flex items-center gap-6 border-b border-slate-100">
              <Stat label="下载" value={formatCount(detailSkill.downloads)} />
              <Stat label="安装" value={formatCount(detailSkill.installs)} />
              <Stat label="收藏" value={formatCount(detailSkill.stars)} />
              {detailSkill.score !== undefined && <Stat label="热度" value={Math.round(detailSkill.score).toLocaleString()} />}
            </div>

            {/* 描述 */}
            <div className="px-5 py-4">
              <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">介绍</h4>
              {detailSkill.descriptionZh && (
                <p className="text-sm text-slate-700 leading-relaxed mb-3">{detailSkill.descriptionZh}</p>
              )}
              <p className={`text-sm leading-relaxed ${detailSkill.descriptionZh ? 'text-slate-400' : 'text-slate-700'}`}>
                {detailSkill.description}
              </p>
            </div>

            {/* 操作 */}
            <div className="px-5 pb-5 flex items-center gap-3">
              {installedNames.has(detailSkill.name) ? (
                <span className="px-4 py-2 text-sm font-medium text-brand bg-brand/10 rounded-lg">已安装</span>
              ) : (
                <button
                  onClick={() => { setDetailSkill(null); handlePrepare(detailSkill.slug ?? detailSkill.name); }}
                  className="px-4 py-2 text-sm font-medium text-white bg-brand rounded-lg hover:bg-brand-hover transition-colors"
                >安装技能</button>
              )}
              {detailSkill.slug && (
                <a
                  href={`https://clawhub.ai/${detailSkill.author ?? ''}/${detailSkill.slug}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 text-sm font-medium text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >在 ClawHub 查看</a>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── 内容 ─── */}
      {tab === 'brand' ? (
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* 品牌 Banner */}
          <div className="relative rounded-2xl bg-gradient-to-r from-brand to-brand-hover overflow-hidden mb-6 p-6">
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-2">
                <img src="/brand-icon.png" alt={BRAND_NAME} className="w-8 h-8 rounded-lg bg-white/20 p-0.5" />
                <h2 className="text-lg font-bold text-white">{BRAND_NAME} 专属技能</h2>
              </div>
              <p className="text-sm text-white/80 max-w-md">专为健康管理场景打造的 AI 技能，覆盖慢病管理、营养膳食、运动指导等领域，让 AI 成为您的私人健康助手。</p>
            </div>
            {/* 装饰圆 */}
            <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-white/10" />
            <div className="absolute -right-4 -bottom-10 w-28 h-28 rounded-full bg-white/5" />
          </div>

          {/* 分类技能列表 */}
          <div className="space-y-6">
            {BRAND_CATEGORIES.map((cat) => (
              <div key={cat.id}>
                {/* 分类标题 */}
                <div className="flex items-center gap-2.5 mb-3">
                  <span className="text-xl">{cat.icon}</span>
                  <h3 className="text-sm font-bold text-slate-800">{cat.name}</h3>
                  <span className="text-xs text-slate-400">{cat.skills.length} 个技能</span>
                </div>

                {/* 技能卡片 */}
                <div className="grid grid-cols-2 gap-3">
                  {cat.skills.map((skill) => (
                    <div key={skill.name}
                      className="group relative flex items-start gap-3 p-4 rounded-xl border border-slate-100 hover:border-brand/30 hover:shadow-md hover:shadow-brand/5 transition-all cursor-pointer"
                    >
                      {/* 渐变指示条 */}
                      <div className={`absolute left-0 top-3 bottom-3 w-0.5 rounded-full bg-gradient-to-b ${cat.color} opacity-0 group-hover:opacity-100 transition-opacity`} />
                      <div className="flex-1 min-w-0 pl-1">
                        <p className="text-sm font-semibold text-slate-800 mb-1 group-hover:text-brand transition-colors">{skill.name}</p>
                        <p className="text-xs text-slate-400 leading-relaxed line-clamp-2">{skill.description}</p>
                      </div>
                      <button className="shrink-0 mt-0.5 px-2.5 py-1 text-xs font-medium rounded-lg border border-slate-200 text-slate-500 opacity-0 group-hover:opacity-100 hover:bg-brand hover:text-white hover:border-brand transition-all">
                        添加
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* 技能广场入口 */}
          <div className="mt-8 mb-2 flex items-center justify-center">
            <button onClick={() => setTab('store')}
              className="flex items-center gap-1.5 text-xs text-slate-400 hover:text-slate-600 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 21v-7.5a.75.75 0 01.75-.75h3a.75.75 0 01.75.75V21m-4.5 0H2.36m11.14 0H18m0 0h3.64m-1.39 0V9.349m-16.5 11.65V9.35m0 0a3.001 3.001 0 003.75-.615A2.993 2.993 0 009.75 9.75c.896 0 1.7-.393 2.25-1.016a2.993 2.993 0 002.25 1.016c.896 0 1.7-.393 2.25-1.016A3.001 3.001 0 0021 9.349m-18 0a2.994 2.994 0 00.407-1.476L3.75 4.5h16.5l.342 3.373A2.994 2.994 0 0021 9.349" />
              </svg>
              探索技能广场
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
            </button>
          </div>
        </div>
      ) : tab === 'store' ? (
        <>
          {/* 返回 + 标题 */}
          <div className="px-6 pt-3 pb-1 flex items-center gap-2">
            <button onClick={() => setTab('brand')}
              className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
              </svg>
              返回精选
            </button>
            <span className="text-xs text-slate-300 mx-1">|</span>
            <span className="text-sm font-semibold text-slate-700">技能广场</span>
          </div>

          {/* 分类 + 排序 */}
          <div className="px-6 pt-2 pb-2 flex items-center gap-4">
            {/* 分类标签 */}
            <div className="flex items-center gap-1 flex-1 overflow-x-auto">
              {CATEGORIES.map((cat) => (
                <button key={cat.id} onClick={() => setCategory(cat.id)}
                  className={`relative px-3 py-1.5 text-sm font-medium whitespace-nowrap rounded-md transition-colors ${
                    category === cat.id ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >
                  {cat.label}
                  {category === cat.id && <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-slate-900 rounded-full" />}
                </button>
              ))}
            </div>

            {/* 排序 */}
            <div className="flex items-center gap-1 shrink-0 border-l border-slate-200 pl-3">
              {SORT_OPTIONS.map((opt) => (
                <button key={opt.id} onClick={() => setSortBy(opt.id)}
                  className={`px-2 py-1 text-xs rounded transition-colors ${
                    sortBy === opt.id ? 'bg-brand/10 text-brand-active font-medium' : 'text-slate-400 hover:text-slate-600'
                  }`}
                >{opt.label}</button>
              ))}
            </div>
          </div>

          {/* 技能卡片网格 */}
          <div className="flex-1 overflow-y-auto px-6 py-3">
            {storeLoading ? (
              <div className="text-center py-20 text-slate-400 text-sm">加载中...</div>
            ) : storeSkills.length > 0 ? (
              <>
                <div className="grid grid-cols-3 gap-3">
                  {storeSkills.map((r) => (
                    <StoreCard key={r.slug ?? r.name} skill={r} installed={installedNames.has(r.name)}
                      onInstall={() => handlePrepare(r.slug ?? r.name)}
                      onDetail={() => setDetailSkill(r)} />
                  ))}
                </div>

                {/* 分页 */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-center gap-2 mt-6 mb-2">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}
                      className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                    >上一页</button>
                    <span className="text-xs text-slate-400">{page} / {totalPages}</span>
                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}
                      className="px-3 py-1.5 text-xs border border-slate-200 rounded-lg text-slate-500 hover:bg-slate-50 disabled:opacity-30"
                    >下一页</button>
                    <span className="text-xs text-slate-400 ml-2">共 {formatCount(total)} 个技能</span>
                  </div>
                )}
              </>
            ) : (
              <div className="text-center py-20">
                <p className="text-3xl mb-3">🔍</p>
                <p className="text-sm text-slate-400">未找到技能</p>
              </div>
            )}
          </div>
        </>
      ) : (
        /* 我的技能 */
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="text-center py-20 text-slate-400 text-sm">加载中...</div>
          ) : skills.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-3xl mb-3">📦</p>
              <p className="text-sm text-slate-500">暂无已安装技能</p>
              <button onClick={() => setTab('brand')} className="mt-3 text-sm text-brand hover:text-brand-hover">去 {BRAND_NAME} 精选 →</button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-3">
              {skills.map((skill) => (
                <MySkillCard key={skill.name} skill={skill} onUninstall={handleUninstall} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 统计项 ───

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <p className="text-sm font-semibold text-slate-800">{value}</p>
      <p className="text-xs text-slate-400">{label}</p>
    </div>
  );
}

// ─── 商店卡片 ───

function StoreCard({ skill, installed, onInstall, onDetail }: { skill: SkillItem; installed: boolean; onInstall: () => void; onDetail: () => void }) {
  const desc = skill.descriptionZh || skill.description;

  return (
    <div onClick={onDetail} className="flex items-start gap-3 p-4 rounded-xl border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all group cursor-pointer">
      <div className="w-11 h-11 rounded-xl bg-slate-50 flex items-center justify-center shrink-0">
        <svg className="w-5 h-5 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <p className="text-sm font-semibold text-slate-800 truncate flex-1">{skill.name}</p>
          {installed ? (
            <span className="text-xs text-brand font-medium shrink-0">Added</span>
          ) : (
            <button onClick={(e) => { e.stopPropagation(); onInstall(); }} className="shrink-0 text-slate-300 hover:text-brand transition-colors" title="安装">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75v6.75m0 0l-3-3m3 3l3-3m-8.25 6a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
              </svg>
            </button>
          )}
        </div>
        <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed mb-1.5">{desc}</p>
        <div className="flex items-center gap-3 text-xs text-slate-400">
          {skill.downloads !== undefined && <span>↓ {formatCount(skill.downloads)}</span>}
          {skill.stars !== undefined && <span>★ {formatCount(skill.stars)}</span>}
          {skill.author && <span className="truncate">{skill.author}</span>}
        </div>
      </div>
    </div>
  );
}

// ─── 我的技能卡片 ───

function MySkillCard({ skill, onUninstall }: { skill: InstalledSkillItem; onUninstall: (name: string) => void }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl border border-slate-100 hover:border-slate-200 transition-all group">
      <div className="w-11 h-11 rounded-xl bg-brand/5 flex items-center justify-center shrink-0">
        <svg className="w-5 h-5 text-brand-active" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <p className="text-sm font-semibold text-slate-800 truncate">{skill.name}</p>
          {skill.gatesPassed ? (
            <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-600 font-medium shrink-0">可用</span>
          ) : (
            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 font-medium shrink-0">需配置</span>
          )}
          <button onClick={() => onUninstall(skill.name)}
            className="ml-auto shrink-0 text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all" title="卸载">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">{skill.description}</p>
        {/* 门控缺失项 */}
        {!skill.gatesPassed && skill.gateResults && skill.gateResults.length > 0 && (
          <div className="mt-1.5 space-y-0.5">
            {skill.gateResults.filter(g => !g.satisfied).map((g, i) => (
              <p key={i} className="text-xs text-amber-600">
                {g.type === 'bin' ? '缺少命令' : g.type === 'env' ? '缺少环境变量' : '系统不支持'}: <code className="font-mono bg-amber-50 px-1 rounded">{g.name}</code>
              </p>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 mt-1.5 text-xs text-slate-400">
          {skill.version && <span>v{skill.version}</span>}
          <span>{skill.source === 'clawhub' ? 'ClawHub' : '本地'}</span>
        </div>
      </div>
    </div>
  );
}
