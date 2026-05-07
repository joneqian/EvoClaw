import { useState, useEffect, useCallback } from 'react';
import { get, post, del } from '../lib/api';
import { BRAND_NAME } from '@evoclaw/shared';
import SkillSourceBadge from '../components/SkillSourceBadge';
import SkillEffectivenessPanel from '../components/SkillEffectivenessPanel';
import EvolutionLogPanel from '../components/EvolutionLogPanel';
import { useAppStore } from '../stores/app-store';

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
  source: 'clawhub' | 'github' | 'local' | 'bundled' | 'mcp';
  installPath: string;
  gatesPassed: boolean;
  gateResults?: GateResult[];
  disableModelInvocation: boolean;
  /** G3: 面向非技术用户的"填空式"参数示例 */
  argumentHint?: string;
  /** G3: 命名参数列表 */
  arguments?: string[];
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
  source: 'clawhub' | 'github' | 'local' | 'bundled' | 'mcp';
  securityReport: {
    riskLevel: 'low' | 'medium' | 'high';
    findings: Array<{ type: string; file: string; line: number; snippet: string; severity: string }>;
  };
  gateResults?: Array<{ type: string; name: string; satisfied: boolean; message?: string }>;
  /** M5 T2: 安装策略决策 */
  installPolicy?: {
    policy: 'auto' | 'require-confirm' | 'block';
    reason: string;
  };
}

type TabType = 'brand' | 'store' | 'my' | 'effectiveness' | 'evolution';

/** M7-Tier1 PR2: "已归档" 区域使用的精简数据 */
interface ArchivedSkillEntry {
  name: string;
  source: string;
  pinned: boolean;
}

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
  {
    id: 'marketing',
    name: '营销转化',
    icon: '🚀',
    color: 'from-indigo-500 to-blue-400',
    skills: [
      { name: '健康公众号文案撰写', description: '生成高打开率的公众号图文标题与正文，覆盖涨粉、促活、带货等核心场景' },
      { name: '爆款健康视频脚本撰写', description: '输出抖音、视频号短视频完整脚本，包含钩子、卖点、行动引导全结构' },
      { name: '销冠话术框架', description: '提供经过验证的销售对话结构，适配直播、私域等场景，系统提升成交转化率' },
      { name: '竞品对比话术', description: '构建差异化对比话术体系，帮助销售在客户比价时放大优势、避开价格战' },
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

/** M5 T1: 威胁发现项中文 label 映射 */
const FINDING_TYPE_LABELS: Record<string, string> = {
  eval: 'eval 动态执行',
  function_constructor: 'new Function 动态执行',
  fetch: 'fetch 外部 URL',
  fs_write: '写入文件系统',
  shell_exec: '执行 shell 命令',
  env_access: '读取环境变量',
  keystore: '访问系统凭据存储',
  exfiltration: '疑似隐蔽外传',
  dns_tunnel: '疑似 DNS 隧道',
  persistence: '疑似持久化后门',
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
  /** M5 T2: require-confirm 策略时用户勾选"我理解风险"的状态 */
  const [riskAcknowledged, setRiskAcknowledged] = useState(false);
  /** M5 T1: 威胁扫描 findings 折叠状态 */
  const [findingsExpanded, setFindingsExpanded] = useState(false);

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

  /** M5 T3: Clawhub 来源 skill 的"有新版可用"信息，key = skill name */
  const [updatesMap, setUpdatesMap] = useState<Map<string, { slug: string; latestVersion: string }>>(new Map());

  /** M7-Tier1 PR1: skill 生命周期信息（pinned + state），key = skill name */
  const [lifecycleMap, setLifecycleMap] = useState<Map<string, { pinned: boolean; state: 'active' | 'stale' | 'archived'; source: string }>>(new Map());

  /** 加载已安装列表 */
  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      const data = await get<{ skills: InstalledSkillItem[] }>('/skill/list');
      setSkills(data.skills);
    } catch { setSkills([]); }
    finally { setLoading(false); }
  }, []);

  /** M7-Tier1 PR1: 加载所有 skill 的 lifecycle 状态（含 pinned + state），失败静默 */
  const fetchLifecycle = useCallback(async () => {
    try {
      const data = await get<{ entries: Array<{ name: string; source: string; state: 'active' | 'stale' | 'archived'; pinned: boolean; archivedAt: string | null }> }>('/curator/lifecycle');
      const m = new Map<string, { pinned: boolean; state: 'active' | 'stale' | 'archived'; source: string }>();
      for (const e of data.entries) {
        m.set(e.name, { pinned: e.pinned, state: e.state, source: e.source });
      }
      setLifecycleMap(m);
    } catch {
      setLifecycleMap(new Map());
    }
  }, []);

  /** M7-Tier1 PR1: 切换 pin 状态。仅 agent-created 来源可 pin，由后端再次校验。 */
  const handleTogglePin = useCallback(async (name: string, nextPinned: boolean) => {
    try {
      const url = `/curator/${nextPinned ? 'pin' : 'unpin'}/${encodeURIComponent(name)}`;
      await post(url, {});
      // 乐观更新
      setLifecycleMap((prev) => {
        const next = new Map(prev);
        const cur = next.get(name);
        next.set(name, {
          pinned: nextPinned,
          state: cur?.state ?? 'active',
          source: cur?.source ?? 'agent-created',
        });
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : (nextPinned ? '钉住失败' : '取消钉住失败'));
      // 失败时拉一次最新值兜底
      void fetchLifecycle();
    }
  }, [fetchLifecycle]);

  /** M5 T3: 拉取 ClawHub 版本比对结果，失败静默 */
  const fetchUpdates = useCallback(async () => {
    try {
      const data = await post<{ updates: Array<{ name: string; slug: string; installedVersion?: string; latestVersion: string }> }>(
        '/skill/check-updates',
        {},
      );
      const m = new Map<string, { slug: string; latestVersion: string }>();
      for (const u of data.updates) m.set(u.name, { slug: u.slug, latestVersion: u.latestVersion });
      setUpdatesMap(m);
    } catch {
      setUpdatesMap(new Map());
    }
  }, []);

  useEffect(() => { fetchSkills(); }, [fetchSkills]);
  useEffect(() => { fetchStore(); }, [fetchStore]);
  // 加载我的技能后查一次更新（静默）
  useEffect(() => { if (skills.length > 0) fetchUpdates(); }, [skills, fetchUpdates]);
  // M7-Tier1 PR1: 加载我的技能后顺带拉 lifecycle（pin + state），用于卡片渲染
  useEffect(() => { if (skills.length > 0) fetchLifecycle(); }, [skills, fetchLifecycle]);

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
      setRiskAcknowledged(false);
      setFindingsExpanded(false);
      await fetchSkills();
      // 升级后清理 updatesMap 对应条目（也会被下轮 fetchUpdates 覆盖）
      setUpdatesMap((prev) => {
        const next = new Map(prev);
        next.delete(prepareResult.metadata.name);
        return next;
      });
    } catch (err) { setError(err instanceof Error ? err.message : '安装失败'); }
    finally { setInstalling(false); }
  }, [prepareResult, fetchSkills]);

  const handleUninstall = useCallback(async (name: string) => {
    try { await del(`/skill/${encodeURIComponent(name)}`); await fetchSkills(); }
    catch (err) { setError(err instanceof Error ? err.message : '卸载失败'); }
  }, [fetchSkills]);

  /** M7-Tier1 PR2: 手动归档（柔删，文件移到 .archive/，可 restore）。仅 agent-created 来源可调用。 */
  const handleArchive = useCallback(async (name: string) => {
    if (!window.confirm(`确定归档 "${name}" 吗？\n\n该 skill 将不再注入 <available_skills>，但文件保留在 .archive/，随时可恢复。`)) {
      return;
    }
    try {
      await post(`/curator/archive/${encodeURIComponent(name)}`, {});
      await fetchSkills();
      await fetchLifecycle();
    } catch (err) {
      setError(err instanceof Error ? err.message : '归档失败');
    }
  }, [fetchSkills, fetchLifecycle]);

  /** M7-Tier1 PR2: 从 .archive/ 恢复（不需要二次确认，可逆操作） */
  const handleRestore = useCallback(async (name: string) => {
    try {
      await post(`/curator/restore/${encodeURIComponent(name)}`, {});
      await fetchSkills();
      await fetchLifecycle();
    } catch (err) {
      setError(err instanceof Error ? err.message : '恢复失败');
    }
  }, [fetchSkills, fetchLifecycle]);

  /** M5 T3: 升级 ClawHub skill = 走 prepare/confirm 同一管线 */
  const handleUpgrade = useCallback(async (slug: string, latestVersion: string) => {
    setInstalling(true); setError('');
    try {
      const data = await post<{ result: PrepareResult }>('/skill/prepare', {
        source: 'clawhub',
        identifier: slug,
        version: latestVersion,
      });
      setPrepareResult(data.result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '升级准备失败');
    } finally {
      setInstalling(false);
    }
  }, []);

  const installedNames = new Set(skills.map(s => s.name));
  const totalPages = Math.ceil(total / pageSize);

  // M7-Tier1 PR2: 从 lifecycleMap 派生已归档 skill 列表（按 archivedAt desc 排序）
  const archivedEntries: ArchivedSkillEntry[] = Array.from(lifecycleMap.entries())
    .filter(([, lc]) => lc.state === 'archived')
    .map(([name, lc]) => ({ name, source: lc.source, pinned: lc.pinned }))
    .sort((a, b) => a.name.localeCompare(b.name));

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
          <button onClick={() => setTab('effectiveness')}
            className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${tab === 'effectiveness' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
          >效能</button>
          <button onClick={() => setTab('evolution')}
            className={`px-4 py-1.5 text-sm font-semibold rounded-md transition-colors ${tab === 'evolution' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'}`}
          >进化历史</button>
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
      {prepareResult && (() => {
        const policy = prepareResult.installPolicy?.policy ?? (prepareResult.securityReport.riskLevel === 'high' ? 'block' : 'auto');
        const isBlocked = policy === 'block';
        const requiresAck = policy === 'require-confirm';
        const canConfirm = !installing && !isBlocked && (!requiresAck || riskAcknowledged);
        const findings = prepareResult.securityReport.findings;
        const closeDialog = () => { setPrepareResult(null); setRiskAcknowledged(false); setFindingsExpanded(false); };
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeDialog}>
          <div className="bg-white rounded-xl shadow-xl w-[460px] p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-slate-900 mb-1">
              安装 {prepareResult.metadata.name}
              {prepareResult.metadata.version && <span className="text-xs text-slate-400 ml-1.5">v{prepareResult.metadata.version}</span>}
            </h3>
            <p className="text-xs text-slate-500 mb-3">{prepareResult.metadata.description}</p>

            {/* 风险徽章 + 来源 */}
            <div className="flex items-center gap-2 flex-wrap mb-3">
              <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${RISK_STYLES[prepareResult.securityReport.riskLevel]?.color ?? ''}`}>
                {prepareResult.securityReport.riskLevel === 'low' ? '✓' : '⚠'}
                {RISK_STYLES[prepareResult.securityReport.riskLevel]?.label}
              </div>
              <SkillSourceBadge source={prepareResult.source} />
            </div>

            {/* M5 T1: 威胁扫描 findings 折叠详情 */}
            {findings.length > 0 && (
              <div className="mb-3 border border-slate-200 rounded-lg">
                <button
                  type="button"
                  onClick={() => setFindingsExpanded(!findingsExpanded)}
                  className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  <span>威胁扫描详情（{findings.length} 项）</span>
                  <span className="text-slate-400">{findingsExpanded ? '▾' : '▸'}</span>
                </button>
                {findingsExpanded && (
                  <div className="px-3 pb-2 space-y-1.5 max-h-[180px] overflow-y-auto">
                    {findings.map((f, i) => (
                      <div key={i} className="text-[11px] font-mono text-slate-700">
                        <div className="flex items-start gap-1.5">
                          <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] ${f.severity === 'high' ? 'bg-red-50 text-red-600' : f.severity === 'medium' ? 'bg-yellow-50 text-yellow-700' : 'bg-slate-100 text-slate-600'}`}>
                            {FINDING_TYPE_LABELS[f.type] ?? f.type}
                          </span>
                          <span className="text-slate-400">{f.file}:{f.line}</span>
                        </div>
                        <div className="pl-1 mt-0.5 text-slate-500 break-all">{f.snippet.slice(0, 80)}{f.snippet.length > 80 && '…'}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* M5 T2: 安装策略原因（require-confirm / block 时显式展示） */}
            {prepareResult.installPolicy && policy !== 'auto' && (
              <div className={`mb-3 p-2.5 rounded-lg text-xs ${isBlocked ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-800'}`}>
                {prepareResult.installPolicy.reason}
              </div>
            )}

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

            {/* M5 T2: require-confirm 时的风险确认 checkbox */}
            {requiresAck && (
              <label className="flex items-start gap-2 mb-3 p-2.5 rounded-lg bg-amber-50/70 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={riskAcknowledged}
                  onChange={(e) => setRiskAcknowledged(e.target.checked)}
                  className="mt-0.5 shrink-0"
                />
                <span className="text-xs text-amber-900">我已核实代码无异常，理解该来源的风险，确认安装。</span>
              </label>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button onClick={closeDialog} className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">取消</button>
              <button
                onClick={handleConfirm}
                disabled={!canConfirm}
                title={isBlocked ? (prepareResult.installPolicy?.reason ?? '安装被策略阻止') : undefined}
                className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-brand text-white hover:bg-brand-hover disabled:opacity-40 disabled:cursor-not-allowed"
              >{installing ? '安装中...' : isBlocked ? '已被阻止' : '确认安装'}</button>
            </div>
          </div>
        </div>
        );
      })()}

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
      {tab === 'evolution' ? (
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <EvolutionLogPanel />
        </div>
      ) : tab === 'effectiveness' ? (
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <SkillEffectivenessPanelWrapper />
        </div>
      ) : tab === 'brand' ? (
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {/* 品牌 Banner */}
          <div className="relative rounded-2xl bg-gradient-to-r from-brand to-brand-hover overflow-hidden mb-6 p-6">
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-2">
                <img src="/brand-icon.png" alt={BRAND_NAME} className="w-8 h-8 rounded-lg bg-white/20 p-0.5" />
                <h2 className="text-lg font-bold text-white">{BRAND_NAME} 专属技能</h2>
              </div>
              <p className="text-sm text-white/80 leading-relaxed">专为泛健康领域打造的 AI 技能，覆盖健身运动、心理管理、体重管理、慢病管理、中医养生、功能医学、生活方式医学、养老康复、医美、母婴、养发护发等等领域，打通从健康内容创作到商业转化、服务交付的全链路，让 AI 成为企业腾飞跃迁的新引擎。</p>
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
          ) : skills.length === 0 && archivedEntries.length === 0 ? (
            <div className="text-center py-20">
              <p className="text-3xl mb-3">📦</p>
              <p className="text-sm text-slate-500">暂无已安装技能</p>
              <button onClick={() => setTab('brand')} className="mt-3 text-sm text-brand hover:text-brand-hover">去 {BRAND_NAME} 精选 →</button>
            </div>
          ) : (
            <>
              {skills.length > 0 && (
                <div className="grid grid-cols-3 gap-3">
                  {skills.map((skill) => {
                    const lifecycle = lifecycleMap.get(skill.name);
                    return (
                      <MySkillCard
                        key={skill.name}
                        skill={skill}
                        onUninstall={handleUninstall}
                        updateInfo={updatesMap.get(skill.name)}
                        onUpgrade={handleUpgrade}
                        lifecycle={lifecycle}
                        onTogglePin={handleTogglePin}
                        onArchive={handleArchive}
                      />
                    );
                  })}
                </div>
              )}
              {/* M7-Tier1 PR2: 已归档区（折叠，仅有 archived 时显示） */}
              {archivedEntries.length > 0 && (
                <ArchivedSection entries={archivedEntries} onRestore={handleRestore} />
              )}
            </>
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

interface MySkillCardProps {
  skill: InstalledSkillItem;
  onUninstall: (name: string) => void;
  /** M5 T3: 有新版时的更新信息（仅 ClawHub 来源） */
  updateInfo?: { slug: string; latestVersion: string };
  onUpgrade?: (slug: string, latestVersion: string) => void;
  /** M7-Tier1 PR1: 生命周期信息（pinned + state），undefined 时按默认 active/未 pin 渲染 */
  lifecycle?: { pinned: boolean; state: 'active' | 'stale' | 'archived'; source: string };
  /** M7-Tier1 PR1: 切换 pin 状态回调（仅 agent-created 来源会调用） */
  onTogglePin?: (name: string, nextPinned: boolean) => void;
  /** M7-Tier1 PR2: 手动归档回调（柔删；仅 agent-created 来源会调用） */
  onArchive?: (name: string) => void;
}

function MySkillCard({ skill, onUninstall, updateInfo, onUpgrade, lifecycle, onTogglePin, onArchive }: MySkillCardProps) {
  // M7-Tier1 PR1: pin 仅 agent-created 可用（manifest source 字段判定，与后端 source-gated 一致）
  // 注：InstalledSkillItem.source 来自 discoverer（'local' 含义=用户目录），manifest 的 'agent-created'
  // 走 lifecycle.source 字段保留，所以这里看 lifecycle.source 而不是 skill.source。
  const canPin = lifecycle?.source === 'agent-created' && Boolean(onTogglePin);
  // M7-Tier1 PR2: archive 也仅 agent-created（与后端 /curator/archive 的 source-gated 一致）
  const canArchive = lifecycle?.source === 'agent-created' && Boolean(onArchive);
  const isPinned = lifecycle?.pinned ?? false;
  const state = lifecycle?.state ?? 'active';

  return (
    <div className={`flex items-start gap-3 p-4 rounded-xl border transition-all group ${
      isPinned
        ? 'border-amber-200 bg-amber-50/30 hover:border-amber-300'
        : 'border-slate-100 hover:border-slate-200'
    }`}>
      <div className="w-11 h-11 rounded-xl bg-brand/5 flex items-center justify-center shrink-0">
        <svg className="w-5 h-5 text-brand-active" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-1">
          <p className="text-sm font-semibold text-slate-800 truncate">{skill.name}</p>
          {skill.source === 'mcp' && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-purple-50 text-purple-600 font-medium shrink-0" title="来自已连接的 MCP 服务器">MCP</span>
          )}
          {skill.gatesPassed ? (
            <span className="text-xs px-1.5 py-0.5 rounded bg-green-50 text-green-600 font-medium shrink-0">可用</span>
          ) : (
            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 font-medium shrink-0">需配置</span>
          )}
          {/* M7-Tier1 PR1: 状态徽章（仅非 active 显示，减少视觉噪音） */}
          {state === 'stale' && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-yellow-50 text-yellow-700 font-medium shrink-0" title="超过 30 天未使用，下次 Curator 运行可能归档">陈旧</span>
          )}
          {state === 'archived' && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-medium shrink-0" title="已归档至 .archive/">已归档</span>
          )}
          {/* M7-Tier1 PR1: pin 切换按钮（仅 agent-created；pinned 时强显示，未 pinned 时 hover 显示） */}
          {canPin && (
            <button
              onClick={() => onTogglePin?.(skill.name, !isPinned)}
              className={`ml-auto shrink-0 transition-all ${
                isPinned
                  ? 'text-amber-600 hover:text-amber-800'
                  : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-amber-500'
              }`}
              title={isPinned ? '已钉住：自动进化与归档跳过此 skill。点击取消' : '钉住：保护此 skill 不被自动进化或归档'}
            >
              <svg className="w-3.5 h-3.5" fill={isPinned ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M16 12V4M16 12l4 4-4 4M8 8h8M8 16h8M4 4h.01M4 20h.01" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 17v5M9 11l3-7 3 7H9z" />
              </svg>
            </button>
          )}
          {/* M7-Tier1 PR2: 归档按钮（仅 agent-created；hover 显示。pinned 时禁用：与后端 archiveSkill 的 pinned 拒绝一致） */}
          {canArchive && (
            <button
              onClick={() => !isPinned && onArchive?.(skill.name)}
              disabled={isPinned}
              className={`shrink-0 transition-all ${
                isPinned
                  ? 'text-slate-200 cursor-not-allowed'
                  : 'text-slate-300 opacity-0 group-hover:opacity-100 hover:text-slate-700'
              } ${canPin ? '' : 'ml-auto'}`}
              title={isPinned ? '已钉住的 skill 不可归档（先取消 pin）' : '归档：移到 .archive/，从 <available_skills> 摘除（可恢复）'}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
              </svg>
            </button>
          )}
          <button onClick={() => onUninstall(skill.name)}
            className={`shrink-0 text-slate-300 opacity-0 group-hover:opacity-100 hover:text-red-500 transition-all ${(canPin || canArchive) ? '' : 'ml-auto'}`} title="卸载">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <p className="text-xs text-slate-400 line-clamp-2 leading-relaxed">{skill.description}</p>
        {/* G3: argument-hint 填空式示例 */}
        {skill.argumentHint && (
          <div className="mt-1.5 flex items-start gap-1.5">
            <span className="text-xs text-slate-400 shrink-0">示例：</span>
            <code className="text-xs font-mono bg-slate-50 text-slate-600 px-1.5 py-0.5 rounded line-clamp-1 break-all">
              {skill.argumentHint}
            </code>
          </div>
        )}
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
          <SkillSourceBadge source={skill.source} />
        </div>
        {/* M5 T3: 有新版可用提示 */}
        {updateInfo && onUpgrade && (
          <div className="mt-2 flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-lg bg-violet-50 border border-violet-100">
            <span className="text-xs text-violet-700">
              有新版 <strong className="font-semibold">v{updateInfo.latestVersion}</strong> 可用
            </span>
            <button
              onClick={() => onUpgrade(updateInfo.slug, updateInfo.latestVersion)}
              className="text-xs font-medium text-violet-700 hover:text-violet-900 px-2 py-0.5 rounded border border-violet-200 hover:bg-violet-100"
            >升级</button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── M7-Tier1 PR2: 已归档区 ────────────────────────────────────────────────

interface ArchivedSectionProps {
  entries: ArchivedSkillEntry[];
  onRestore: (name: string) => void;
}

/**
 * 折叠的"已归档"区。skill 文件移到 .archive/，从 <available_skills> 摘除，
 * 但仍可通过 restore 一键恢复。
 */
function ArchivedSection({ entries, onRestore }: ArchivedSectionProps) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="mt-6 border-t border-slate-200 pt-4">
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-800"
      >
        <svg
          className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
        </svg>
        <span>已归档（{entries.length}）</span>
        <span className="text-xs font-normal text-slate-400">— 文件保留在 .archive/，可恢复</span>
      </button>
      {expanded && (
        <ul className="mt-3 space-y-1.5">
          {entries.map((e) => (
            <li
              key={e.name}
              className="flex items-center justify-between px-3 py-2 rounded-lg bg-slate-50 border border-slate-100"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8" />
                </svg>
                <span className="text-sm text-slate-700 truncate">{e.name}</span>
                <span className="text-xs text-slate-400 shrink-0">{e.source}</span>
              </div>
              <button
                onClick={() => onRestore(e.name)}
                className="shrink-0 text-xs px-2 py-1 rounded border border-slate-200 text-slate-600 bg-white hover:bg-slate-100"
                title="恢复：从 .archive/ 移回，重新进入 <available_skills>"
              >
                恢复
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** 效能面板包装：读取 appStore.selectedAgentId，不传则提示 */
function SkillEffectivenessPanelWrapper() {
  const selectedAgentId = useAppStore((s) => s.selectedAgentId);
  if (!selectedAgentId) {
    return <div className="p-8 text-center text-slate-500 text-sm">请先在侧边栏选择一个 Agent</div>;
  }
  return <SkillEffectivenessPanel agentId={selectedAgentId} days={7} />;
}
