import { useState, useEffect, useCallback } from 'react';
import { get, post, del } from '../lib/api';

// ─── 类型 ───

interface InstalledSkillItem {
  name: string;
  description: string;
  version?: string;
  author?: string;
  source: 'clawhub' | 'github' | 'local';
  installPath: string;
  gatesPassed: boolean;
  disableModelInvocation: boolean;
}

interface SearchResultItem {
  name: string;
  slug?: string;
  description: string;
  version?: string;
  author?: string;
  downloads?: number;
  source: 'clawhub' | 'github' | 'local';
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

type TabType = 'store' | 'my';

// ─── 分类 ───

const CATEGORIES = [
  { id: 'all', label: '全部' },
  { id: 'general', label: '通用' },
  { id: 'creative', label: '创意' },
  { id: 'academic', label: '学术' },
  { id: 'development', label: '开发', hot: true },
  { id: 'legal', label: '法律' },
  { id: 'lifestyle', label: '生活' },
  { id: 'marketing', label: '营销' },
  { id: 'finance', label: '金融' },
  { id: 'data', label: '数据' },
];

const RISK_STYLES: Record<string, { label: string; color: string }> = {
  low: { label: '低风险', color: 'text-green-600 bg-green-50' },
  medium: { label: '中风险', color: 'text-yellow-600 bg-yellow-50' },
  high: { label: '高风险', color: 'text-red-600 bg-red-50' },
};

// ─── 主页面 ───

export default function SkillPage() {
  const [tab, setTab] = useState<TabType>('store');
  const [category, setCategory] = useState('all');
  const [skills, setSkills] = useState<InstalledSkillItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResultItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [prepareResult, setPrepareResult] = useState<PrepareResult | null>(null);
  const [installing, setInstalling] = useState(false);
  const [error, setError] = useState('');

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get<{ skills: InstalledSkillItem[] }>('/skill/list');
      setSkills(data.skills);
    } catch { setSkills([]); }
    finally { setLoading(false); }
  }, []);

  /** 加载商店热门技能 */
  const fetchBrowse = useCallback(async () => {
    setSearching(true);
    try {
      const data = await get<{ results: SearchResultItem[] }>('/skill/browse?limit=30&sort=trending');
      setSearchResults(data.results);
    } catch { /* ignore */ }
    finally { setSearching(false); }
  }, []);

  useEffect(() => { fetchSkills(); fetchBrowse(); }, [fetchSkills, fetchBrowse]);

  const handleSearch = useCallback(async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    setError('');
    try {
      const data = await post<{ results: SearchResultItem[] }>('/skill/search', {
        query: searchQuery.trim(), limit: 30,
      });
      setSearchResults(data.results);
    } catch (err) {
      setError(err instanceof Error ? err.message : '搜索失败');
    } finally { setSearching(false); }
  }, [searchQuery]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  const handlePrepare = useCallback(async (slug: string) => {
    setInstalling(true);
    setError('');
    try {
      const data = await post<{ result: PrepareResult }>('/skill/prepare', { source: 'clawhub', identifier: slug });
      setPrepareResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '准备安装失败');
    } finally { setInstalling(false); }
  }, []);

  const handleConfirm = useCallback(async () => {
    if (!prepareResult) return;
    setInstalling(true);
    setError('');
    try {
      await post('/skill/confirm', { prepareId: prepareResult.prepareId });
      setPrepareResult(null);
      await fetchSkills();
    } catch (err) {
      setError(err instanceof Error ? err.message : '安装失败');
    } finally { setInstalling(false); }
  }, [prepareResult, fetchSkills]);

  const handleUninstall = useCallback(async (name: string) => {
    try {
      await del(`/skill/${encodeURIComponent(name)}`);
      await fetchSkills();
    } catch (err) {
      setError(err instanceof Error ? err.message : '卸载失败');
    }
  }, [fetchSkills]);

  const installedNames = new Set(skills.map(s => s.name));

  return (
    <div className="h-full flex flex-col bg-white">
      {/* ─── 顶栏 ─── */}
      <div className="px-6 pt-4 pb-0 flex items-center gap-4">
        {/* 左侧 Tab */}
        <div className="flex bg-slate-100 rounded-lg p-0.5 shrink-0">
          <button
            onClick={() => setTab('store')}
            className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${
              tab === 'store' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >技能商店</button>
          <button
            onClick={() => setTab('my')}
            className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${
              tab === 'my' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >我的技能{skills.length > 0 && ` (${skills.length})`}</button>
        </div>

        {/* 中间留空 */}
        <div className="flex-1" />

        {/* 右侧搜索 */}
        <div className="relative w-[260px] shrink-0">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (!e.target.value.trim()) fetchBrowse(); // 清空时恢复热门列表
            }}
            onKeyDown={handleKeyDown}
            placeholder="搜索技能，回车确认"
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg
              focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand placeholder:text-slate-400"
          />
          {searching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-brand border-t-transparent rounded-full animate-spin" />
          )}
        </div>
      </div>

      {error && <p className="text-xs text-red-500 px-6 mt-2">{error}</p>}

      {/* ─── 安装确认弹窗 ─── */}
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
              <button onClick={() => setPrepareResult(null)}
                className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
              >取消</button>
              <button onClick={handleConfirm}
                disabled={installing || prepareResult.securityReport.riskLevel === 'high'}
                className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-brand text-white hover:bg-brand-hover disabled:opacity-40 transition-colors"
              >{installing ? '安装中...' : '确认安装'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ─── 内容区 ─── */}
      {tab === 'store' ? (
        <>
          {/* 分类标签栏 */}
          <div className="px-6 pt-4 pb-2 flex items-center gap-1 overflow-x-auto">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setCategory(cat.id)}
                className={`relative px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors rounded-md ${
                  category === cat.id
                    ? 'text-slate-900'
                    : 'text-slate-400 hover:text-slate-600'
                }`}
              >
                {cat.label}
                {category === cat.id && (
                  <span className="absolute bottom-0 left-3 right-3 h-0.5 bg-slate-900 rounded-full" />
                )}
                {cat.hot && (
                  <span className="absolute -top-1 -right-1 px-1 py-px text-[9px] font-bold bg-red-500 text-white rounded-sm leading-none">HOT</span>
                )}
              </button>
            ))}
          </div>

          {/* 技能卡片网格 */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {searching ? (
              <div className="text-center py-20 text-slate-400 text-sm">加载中...</div>
            ) : searchResults.length > 0 ? (
              <div className="grid grid-cols-3 gap-3">
                {searchResults.map((r) => (
                  <StoreCard
                    key={`${r.source}-${r.name}`}
                    name={r.name}
                    description={r.description}
                    installed={installedNames.has(r.name)}
                    onInstall={() => handlePrepare(r.slug ?? r.name)}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-20">
                <p className="text-3xl mb-3">⚡</p>
                <p className="text-sm text-slate-500 font-medium">暂无可用技能</p>
                <p className="text-xs text-slate-400 mt-1">尝试搜索关键词发现技能</p>
              </div>
            )}
          </div>
        </>
      ) : (
        /* ─── 我的技能 ─── */
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {loading ? (
            <div className="text-center py-20 text-slate-400 text-sm">加载中...</div>
          ) : skills.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-3xl mb-3">📦</p>
              <p className="text-sm text-slate-500">暂无已安装技能</p>
              <button onClick={() => setTab('store')} className="mt-3 text-sm text-brand hover:text-brand-hover">
                去技能商店 →
              </button>
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

// ─── 商店技能卡片 ───

function StoreCard({ name, description, installed, onInstall }: {
  name: string;
  description: string;
  installed: boolean;
  onInstall: () => void;
}) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl border border-slate-100 hover:border-slate-200 hover:shadow-sm transition-all group">
      {/* 图标 */}
      <div className="w-12 h-12 rounded-xl bg-slate-50 flex items-center justify-center shrink-0">
        <svg className="w-6 h-6 text-brand" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </div>

      {/* 内容 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <p className="text-sm font-semibold text-slate-800 truncate">{name}</p>
          {installed ? (
            <span className="text-[11px] text-brand font-medium shrink-0">Added</span>
          ) : (
            <button
              onClick={onInstall}
              className="shrink-0 text-slate-300 hover:text-brand transition-colors"
              title="安装"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9.75v6.75m0 0l-3-3m3 3l3-3m-8.25 6a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
              </svg>
            </button>
          )}
        </div>
        <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

// ─── 我的技能卡片 ───

function MySkillCard({ skill, onUninstall }: { skill: InstalledSkillItem; onUninstall: (name: string) => void }) {
  return (
    <div className="flex items-start gap-3 p-4 rounded-xl border border-slate-100 hover:border-slate-200 transition-all group">
      {/* 图标 */}
      <div className="w-12 h-12 rounded-xl bg-brand/5 flex items-center justify-center shrink-0">
        <svg className="w-6 h-6 text-brand-active" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </div>

      {/* 内容 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <p className="text-sm font-semibold text-slate-800 truncate">{skill.name}</p>
          {!skill.gatesPassed && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-50 text-red-500 font-medium shrink-0">需配置</span>
          )}
          {/* 卸载按钮 */}
          <button
            onClick={() => onUninstall(skill.name)}
            className="ml-auto shrink-0 text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all"
            title="卸载"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">{skill.description}</p>
        <div className="flex items-center gap-2 mt-1.5">
          {skill.version && <span className="text-[10px] text-slate-400">v{skill.version}</span>}
          <span className="text-[10px] text-slate-300">
            {skill.source === 'clawhub' ? 'ClawHub' : '本地'}
          </span>
        </div>
      </div>
    </div>
  );
}
