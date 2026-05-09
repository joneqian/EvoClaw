import { useState, useEffect, useCallback } from 'react';
import { BRAND_NAME } from '@evoclaw/shared';
import { get, post, put } from '../lib/api';
import Select from '../components/Select';
import MCPServersPanel from '../components/MCPServersPanel';
import ApiDocsPanel from '../components/ApiDocsPanel';
import ProfileManager from '../components/ProfileManager';

// ─── Tab 定义 ───

type SettingsTab = 'general' | 'env' | 'mcp' | 'skill-evolver' | 'security-policy' | 'api-docs' | 'about';

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'general', label: '通用' },
  { key: 'env', label: '环境变量' },
  { key: 'mcp', label: 'MCP 服务器' },
  { key: 'skill-evolver', label: 'Skill 自进化' },
  { key: 'security-policy', label: '安全策略' },
  { key: 'api-docs', label: 'API 文档' },
  { key: 'about', label: '关于' },
];

// ─── 通用设置 Tab ───

/** 检查字段是否被企业管理员锁定 */
function isEnforced(enforcedPaths: string[], field: string): boolean {
  return enforcedPaths.some(p => p === field || field.startsWith(p + '.'));
}

/** 锁定标记组件 */
function EnforcedBadge() {
  return (
    <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700" title="此设置由企业管理员控制">
      <svg className="w-3 h-3 mr-0.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
      企业管控
    </span>
  );
}

function GeneralTab() {
  const [language, setLanguage] = useState<'zh' | 'en'>('zh');
  const [enforced, setEnforced] = useState<string[]>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  // 加载当前配置
  // 注：thinkingMode 不再暴露给普通用户（默认值由 catalog 的 defaultThinkLevel 决定）；
  // 企业管理员仍可通过 managed.json 的 thinking 字段全局强制 'auto'/'on'/'off'。
  useEffect(() => {
    (async () => {
      try {
        const data = await get<{ config: { language?: 'zh' | 'en' }; enforced?: string[] }>('/config');
        if (data.config?.language) setLanguage(data.config.language);
        if (data.enforced) setEnforced(data.enforced);
      } catch { /* sidecar 可能未就绪 */ }
    })();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const saveConfig = useCallback(async (patch: Record<string, unknown>) => {
    try {
      await put('/config', patch);
      setToast({ message: '已保存', type: 'success' });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : '保存失败', type: 'error' });
    }
  }, []);

  return (
    <>
      {/* M6 T2: Profile 管理（置顶，影响面最大） */}
      <ProfileManager showToast={(message, type = 'success') => setToast({ message, type })} />

      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
        {/* 语言设置 */}
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-slate-700">响应语言{isEnforced(enforced, 'language') && <EnforcedBadge />}</div>
            <div className="text-xs text-slate-400 mt-0.5">Agent 回复时使用的语言</div>
          </div>
          <Select
            value={language}
            onChange={(val) => { setLanguage(val as 'zh' | 'en'); saveConfig({ language: val }); }}
            options={[
              { value: 'zh', label: '中文' },
              { value: 'en', label: 'English' },
            ]}
            className="w-[140px]"
          />
        </div>

      </div>

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium shadow-lg z-50 ${
          toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.message}
        </div>
      )}
    </>
  );
}

// ─── 环境变量预设 ───

/** 预设分组 */
interface PresetGroup {
  icon: string;
  label: string;
  items: { key: string; label: string; hint: string }[];
}

const ENV_PRESET_GROUPS: PresetGroup[] = [
  {
    icon: '🔍',
    label: '搜索与网络',
    items: [
      { key: 'BRAVE_API_KEY', label: 'Brave Search', hint: '网络搜索' },
      { key: 'BAIDU_API_KEY', label: '百度搜索', hint: '国内搜索引擎' },
      { key: 'TAVILY_API_KEY', label: 'Tavily Search', hint: '替代搜索引擎' },
      { key: 'EXA_API_KEY', label: 'Exa Search', hint: 'AI 语义搜索' },
      { key: 'FIRECRAWL_API_KEY', label: 'Firecrawl', hint: '网页抓取' },
    ],
  },
  {
    icon: '🔊',
    label: '语音与媒体',
    items: [
      { key: 'ELEVENLABS_API_KEY', label: 'ElevenLabs', hint: '语音合成 TTS' },
      { key: 'DEEPGRAM_API_KEY', label: 'Deepgram', hint: '语音转文字' },
    ],
  },
];

interface EnvVarItem {
  key: string;
  maskedValue: string;
  configured: boolean;
}

// ─── 环境变量 Tab ───

function EnvVarsTab() {
  const [envVars, setEnvVars] = useState<EnvVarItem[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [addingNew, setAddingNew] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
  }, []);

  const fetchEnvVars = useCallback(async () => {
    try {
      const data = await get<{ envVars: EnvVarItem[] }>('/config/env-vars');
      setEnvVars(data.envVars ?? []);
    } catch { /* Sidecar 可能未就绪 */ }
  }, []);

  useEffect(() => { fetchEnvVars(); }, [fetchEnvVars]);

  // 启动期间累积的凭证清理警告（一次性消费）— 让用户知道全角/非 ASCII 凭证已自动清理
  useEffect(() => {
    (async () => {
      try {
        const data = await get<{ warnings: string[] }>('/config/warnings');
        const warnings = data.warnings ?? [];
        if (warnings.length > 0) {
          const paths = warnings.join('、');
          showToast(`已自动清理 ${warnings.length} 个凭证的非 ASCII 字符：${paths}`, 'success');
        }
      } catch { /* ignore */ }
    })();
  }, [showToast]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const saveVars = useCallback(async (vars: Record<string, string>) => {
    try {
      await put('/config/env-vars', { envVars: vars });
      showToast('已保存');
      fetchEnvVars();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存失败', 'error');
    }
  }, [fetchEnvVars, showToast]);

  /** 从 envVars 列表重建完整 map（用于增量更新） */
  const rebuildVarsMap = useCallback(async (): Promise<Record<string, string>> => {
    // 从后端获取完整未脱敏数据
    try {
      const config = await get<{ config: { envVars?: Record<string, string> } }>('/config');
      return config.config?.envVars ?? {};
    } catch {
      return {};
    }
  }, []);

  /** 进入编辑模式时获取明文值 */
  const startEdit = useCallback(async (key: string) => {
    setEditingKey(key);
    try {
      const data = await get<{ value: string }>(`/config/env-vars/${encodeURIComponent(key)}`);
      setEditValue(data.value ?? '');
    } catch {
      setEditValue('');
    }
  }, []);

  const handleSaveEdit = useCallback(async () => {
    if (!editingKey) return;
    const trimmed = editValue.trim();
    const vars = await rebuildVarsMap();
    if (trimmed) {
      vars[editingKey] = trimmed;
    } else {
      delete vars[editingKey];
    }
    await saveVars(vars);
    setEditingKey(null);
    setEditValue('');
  }, [editingKey, editValue, rebuildVarsMap, saveVars]);

  const handleDelete = useCallback(async (key: string) => {
    const vars = await rebuildVarsMap();
    delete vars[key];
    await saveVars(vars);
  }, [rebuildVarsMap, saveVars]);

  const handleAddNew = useCallback(async () => {
    const k = newKey.trim().toUpperCase();
    const v = newValue.trim();
    if (!k || !v) return;
    if (envVars.some(e => e.key === k)) {
      showToast(`${k} 已存在，请直接编辑`, 'error');
      return;
    }
    const vars = await rebuildVarsMap();
    vars[k] = v;
    await saveVars(vars);
    setAddingNew(false);
    setNewKey('');
    setNewValue('');
  }, [newKey, newValue, envVars, rebuildVarsMap, saveVars, showToast]);

  const handleAddPreset = (presetKey: string) => {
    if (envVars.some(e => e.key === presetKey)) {
      startEdit(presetKey);
      return;
    }
    setAddingNew(true);
    setNewKey(presetKey);
    setNewValue('');
  };

  // 计算每组预设的配置状态
  const existingKeys = new Set(envVars.map(e => e.key));
  const configuredKeys = new Set(envVars.filter(e => e.configured).map(e => e.key));

  /** 预设分组及配置进度 */
  const presetGroupsWithStatus = ENV_PRESET_GROUPS.map(g => {
    const configuredCount = g.items.filter(p => configuredKeys.has(p.key)).length;
    const unconfiguredItems = g.items.filter(p => !existingKeys.has(p.key));
    return { ...g, configuredCount, unconfiguredItems };
  });

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
          <p className="text-xs text-slate-400">Skill 和工具通过 process.env 读取这些变量</p>
          <button
            onClick={() => { setAddingNew(true); setNewKey(''); setNewValue(''); }}
            className="text-xs px-2.5 py-1 font-medium text-brand border border-brand/30 rounded-lg
              hover:bg-brand/5 transition-colors"
          >
            + 添加
          </button>
        </div>

        <div className="divide-y divide-slate-100">
          {envVars.length === 0 && !addingNew && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-slate-400">暂无环境变量</p>
              <p className="text-xs text-slate-300 mt-1">点击"添加"或选择下方常用变量快速配置</p>
            </div>
          )}

          {envVars.map((item) => (
            <div key={item.key} className="px-4 py-2 flex items-center gap-2 group">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.configured ? 'bg-emerald-400' : 'bg-slate-200'}`} />
              <code className="text-xs font-mono font-semibold text-slate-700 bg-slate-50 px-2 py-0.5 rounded min-w-[140px] shrink-0">
                {item.key}
              </code>
              {editingKey === item.key ? (
                <div className="flex-1">
                  <input
                    type="text"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSaveEdit(); if (e.key === 'Escape') { setEditingKey(null); setEditValue(''); } }}
                    onBlur={handleSaveEdit}
                    placeholder="输入值"
                    className="w-full px-2.5 py-1 text-xs border border-slate-200 rounded-lg
                      focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand font-mono"
                    autoFocus
                  />
                </div>
              ) : (
                <>
                  <code className="flex-1 text-xs text-slate-400 font-mono truncate">
                    {item.configured ? item.maskedValue : '(未设置)'}
                  </code>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => startEdit(item.key)}
                      className="p-1 text-slate-400 hover:text-brand rounded transition-colors"
                      title="编辑"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(item.key)}
                      className="p-1 text-slate-400 hover:text-red-500 rounded transition-colors"
                      title="删除"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}

          {addingNew && (
            <div className="px-4 py-2.5 flex items-center gap-2 bg-brand/[0.02]">
              <input
                type="text"
                value={newKey}
                onChange={(e) => setNewKey(e.target.value.toUpperCase())}
                placeholder="VARIABLE_NAME"
                className="w-[160px] px-2.5 py-1 text-xs border border-slate-200 rounded-lg
                  focus:outline-none focus:ring-2 focus:ring-brand/40 font-mono font-semibold"
                autoFocus
              />
              <input
                type="password"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddNew(); if (e.key === 'Escape') { setAddingNew(false); setNewKey(''); setNewValue(''); } }}
                placeholder="Value"
                className="flex-1 px-2.5 py-1 text-xs border border-slate-200 rounded-lg
                  focus:outline-none focus:ring-2 focus:ring-brand/40 font-mono"
              />
              <button
                onClick={handleAddNew}
                disabled={!newKey.trim() || !newValue.trim()}
                className="text-xs px-2.5 py-1 font-medium text-white bg-brand rounded-lg
                  hover:bg-brand-hover disabled:opacity-40 transition-colors"
              >
                添加
              </button>
              <button
                onClick={() => { setAddingNew(false); setNewKey(''); setNewValue(''); }}
                className="text-xs text-slate-400 hover:text-slate-600"
              >
                取消
              </button>
            </div>
          )}
        </div>

        {presetGroupsWithStatus.some(g => g.unconfiguredItems.length > 0) && (
          <div className="px-4 py-3 border-t border-slate-100 bg-slate-50/50 space-y-2">
            {presetGroupsWithStatus.map((group) => (
              <div key={group.label} className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-slate-400 shrink-0">
                  {group.icon} {group.label}
                  <span className={`ml-1 ${group.configuredCount === group.items.length ? 'text-emerald-500' : group.configuredCount > 0 ? 'text-amber-500' : 'text-slate-300'}`}>
                    ({group.configuredCount}/{group.items.length})
                  </span>
                  :
                </span>
                {group.unconfiguredItems.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => handleAddPreset(p.key)}
                    className="text-xs px-2 py-0.5 text-slate-500 hover:text-brand
                      bg-white border border-slate-200 rounded-full
                      hover:border-brand/30 transition-colors"
                    title={p.hint}
                  >
                    + {p.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium shadow-lg z-50 ${
          toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.message}
        </div>
      )}
    </>
  );
}

// ─── 关于 Tab ───

// ─── M7-Tier1 PR3: Skill 自进化 Tab ────────────────────────────────────

interface EvolverConfig {
  enabled: boolean;
  cronSchedule: string;
  minEvidenceCount: number;
  successRateThreshold: number;
  maxCandidatesPerRun: number;
  model?: string;
  // M7-Tier3 PR-T3-1c: A-B 对照配置（schema 在 packages/shared 已定义）
  abTestEnabled: boolean;
  abMinCallsPerVariant: number;
  abMaxTestDays: number;
  abEvaluatorCron: string;
  abPromoteSuccessDeltaMin: number;
  abRollbackSuccessDeltaMin: number;
  abPValueThreshold: number;
  abDurationRatioRollback: number;
  // M7-Tier3 PR-T3-2a: 进化执行模式（apply / dryRun，PR-T3-2b 扩 canary）
  mode: 'apply' | 'dryRun';
}

/** M7-Tier1 PR6: Curator 完整配置（与 security.skillCurator schema 对齐） */
interface CuratorConfig {
  enabled: boolean;
  intervalDays: number;
  staleDays: number;
  archivedDays: number;
  protectBundled: boolean;
}

interface CuratorStatus {
  state: { paused: boolean; lastRunAt: string | null; lastRunSummary: string | null; runCount: number };
  nextRun: { shouldRun: boolean; reason: string };
  agentCreatedStateCounts: { active: number; stale: number; archived: number };
  pinnedCount: number;
  intervalDays: number;
}

function SkillEvolverTab() {
  const [original, setOriginal] = useState<EvolverConfig | null>(null);
  const [draft, setDraft] = useState<EvolverConfig | null>(null);
  /** PR6: Curator 配置 */
  const [curatorOriginal, setCuratorOriginal] = useState<CuratorConfig | null>(null);
  const [curatorDraft, setCuratorDraft] = useState<CuratorConfig | null>(null);
  const [curator, setCurator] = useState<CuratorStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingCurator, setSavingCurator] = useState(false);
  const [running, setRunning] = useState<'evolver' | 'curator' | 'ab-evaluator' | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [evRes, curCfgRes, curRes] = await Promise.all([
        get<{ evolver: EvolverConfig }>('/skill-evolution/config'),
        get<{ curator: CuratorConfig }>('/curator/config'),
        get<CuratorStatus>('/curator/status'),
      ]);
      setOriginal(evRes.evolver);
      setDraft(evRes.evolver);
      setCuratorOriginal(curCfgRes.curator);
      setCuratorDraft(curCfgRes.curator);
      setCurator(curRes);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '加载配置失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void loadAll(); }, [loadAll]);

  const isDirty = original !== null && draft !== null
    && JSON.stringify(original) !== JSON.stringify(draft);

  const handleSave = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    try {
      const res = await post<{ ok: boolean; evolver: EvolverConfig }>(
        '/skill-evolution/config',
        { evolver: draft },
      );
      setOriginal(res.evolver);
      setDraft(res.evolver);
      showToast('已保存（scheduler 自动热重载）', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  }, [draft, showToast]);

  const handleRunEvolver = useCallback(async () => {
    setRunning('evolver');
    try {
      await post('/skill-evolution/run-now', {});
      showToast('Evolver 已触发（异步运行，请查看进化历史）', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '触发失败', 'error');
    } finally {
      setRunning(null);
    }
  }, [showToast]);

  // M7-Tier3 PR-T3-1c: 立即跑一次 A-B 评估器
  const handleRunAbEvaluator = useCallback(async () => {
    setRunning('ab-evaluator');
    try {
      const res = await post<{ scanned: number; promoted: number; rolledBack: number; inconclusive: number; continued: number; errors: number }>(
        '/skill-evolution/ab-evaluate-now',
        {},
      );
      showToast(
        `已评估：扫描 ${res.scanned} · 升级 ${res.promoted} · 回滚 ${res.rolledBack} · 不显著 ${res.inconclusive} · 继续 ${res.continued}`,
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : '触发失败', 'error');
    } finally {
      setRunning(null);
    }
  }, [showToast]);

  const handleRunCurator = useCallback(async () => {
    setRunning('curator');
    try {
      await post('/curator/run', {});
      showToast('Curator 已触发（后台运行，可能需 30s+）', 'success');
      await loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '触发失败', 'error');
    } finally {
      setRunning(null);
    }
  }, [showToast, loadAll]);

  const handleToggleCuratorPause = useCallback(async () => {
    if (!curator) return;
    const target = curator.state.paused ? 'resume' : 'pause';
    try {
      await post(`/curator/${target}`, {});
      await loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '切换失败', 'error');
    }
  }, [curator, loadAll, showToast]);

  /** PR6: Curator 配置保存 */
  const handleCuratorSave = useCallback(async () => {
    if (!curatorDraft) return;
    setSavingCurator(true);
    try {
      const res = await post<{ ok: boolean; curator: CuratorConfig }>(
        '/curator/config',
        { curator: curatorDraft },
      );
      setCuratorOriginal(res.curator);
      setCuratorDraft(res.curator);
      showToast('Curator 配置已保存（自动热重载）', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存失败', 'error');
    } finally {
      setSavingCurator(false);
    }
  }, [curatorDraft, showToast]);

  const isCuratorDirty = curatorOriginal !== null && curatorDraft !== null
    && JSON.stringify(curatorOriginal) !== JSON.stringify(curatorDraft);

  if (loading || !draft || !original || !curatorDraft || !curatorOriginal) {
    return <div className="text-center py-20 text-slate-400 text-sm">加载中…</div>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      {toast && (
        <div className={`px-4 py-2 rounded-lg text-sm ${
          toast.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
        }`}>{toast.message}</div>
      )}

      {/* ─── Evolver 子区 ─── */}
      <section className="rounded-xl border border-slate-200 p-5 bg-white">
        <header className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Cron Evolver</h3>
            <p className="text-xs text-slate-500 mt-0.5">按定时调度对失败率高的 skill 自动微调（可审计 + 可回滚）</p>
          </div>
          <button
            onClick={handleRunEvolver}
            disabled={running !== null}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {running === 'evolver' ? '触发中…' : '立即触发'}
          </button>
        </header>

        <div className="space-y-3">
          <Field label="启用" hint="关闭后 cron 不会触发任何决策（inline review 走另一通道，独立开关）">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300 text-brand focus:ring-brand"
              />
              <span className="text-sm text-slate-700">{draft.enabled ? '已启用' : '已禁用'}</span>
            </label>
          </Field>

          <Field label="Cron 调度" hint="标准 5 段 cron 表达式，每分钟检查一次。例：0 3 * * * = 每日 03:00">
            <input
              type="text"
              value={draft.cronSchedule}
              onChange={(e) => setDraft({ ...draft, cronSchedule: e.target.value })}
              className="w-full px-3 py-1.5 text-sm font-mono rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand/40 focus:border-brand"
              placeholder="0 3 * * *"
            />
          </Field>

          {/* M7-Tier3 PR-T3-2a: 执行模式 */}
          <Field
            label="执行模式"
            hint={
              draft.mode === 'dryRun'
                ? 'dryRun 模式下决策仅落审计日志，需在「进化历史」Tab 手动应用/拒绝（与 A-B 对照实验互斥）'
                : 'apply 直接生效；dryRun 仅写日志，等用户审批后再生效'
            }
          >
            <select
              value={draft.mode}
              onChange={(e) => {
                const next: 'apply' | 'dryRun' = e.target.value === 'dryRun' ? 'dryRun' : 'apply';
                // dryRun 与 abTestEnabled 互斥（schema refine 强制），切到 dryRun 自动关 A-B
                setDraft({
                  ...draft,
                  mode: next,
                  ...(next === 'dryRun' ? { abTestEnabled: false } : {}),
                });
              }}
              className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand/40 focus:border-brand"
            >
              <option value="apply">apply — 直接生效</option>
              <option value="dryRun">dryRun — 待审核（手动应用/拒绝）</option>
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="最少证据数" hint="单 skill 至少积累多少条 usage 才进入 LLM 决策（1~50）">
              <input
                type="number"
                min={1}
                max={50}
                value={draft.minEvidenceCount}
                onChange={(e) => setDraft({ ...draft, minEvidenceCount: Number(e.target.value) || 1 })}
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand/40 focus:border-brand"
              />
            </Field>

            <Field label="成功率阈值" hint="低于此值才进候选（0~1）。例 0.8 = 失败率 > 20% 触发">
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={draft.successRateThreshold}
                onChange={(e) => setDraft({ ...draft, successRateThreshold: Number(e.target.value) })}
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand/40 focus:border-brand"
              />
            </Field>
          </div>

          <Field label="单次最多进化数" hint="每次 cycle 最多动几个 skill，硬上限 20">
            <input
              type="number"
              min={1}
              max={20}
              value={draft.maxCandidatesPerRun}
              onChange={(e) => setDraft({ ...draft, maxCandidatesPerRun: Number(e.target.value) || 1 })}
              className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand/40 focus:border-brand"
            />
          </Field>

          <Field label="辅助模型 ID（可选）" hint="留空走 ModelRouter 默认辅助模型。格式：provider/modelId">
            <input
              type="text"
              value={draft.model ?? ''}
              onChange={(e) => setDraft({ ...draft, model: e.target.value || undefined })}
              className="w-full px-3 py-1.5 text-sm font-mono rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand/40 focus:border-brand"
              placeholder="例：openai/gpt-4o-mini"
            />
          </Field>
        </div>

        {/* ─── A-B 对照实验子分组 ─── */}
        <details className="mt-4 pt-4 border-t border-slate-100" open={draft.abTestEnabled}>
          <summary className="cursor-pointer flex items-center justify-between -mx-1 px-1 py-1 rounded hover:bg-slate-50">
            <div>
              <span className="text-sm font-semibold text-slate-800">A-B 对照实验</span>
              <span className="ml-2 text-xs text-slate-500">refine 后启动 A/B 桶位 + 统计学验证</span>
            </div>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); void handleRunAbEvaluator(); }}
              disabled={running !== null}
              className="px-3 py-1 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {running === 'ab-evaluator' ? '评估中…' : '立即评估'}
            </button>
          </summary>

          <div className="mt-3 space-y-3">
            <Field
              label="启用 A-B"
              hint={
                draft.mode === 'dryRun'
                  ? 'dryRun 模式下不写 SKILL.md → 没法启动 A-B（自动禁用）'
                  : '关闭后 refine 直接落地，不进入桶位对照'
              }
            >
              <label className={`inline-flex items-center gap-2 ${draft.mode === 'dryRun' ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  checked={draft.abTestEnabled && draft.mode !== 'dryRun'}
                  disabled={draft.mode === 'dryRun'}
                  onChange={(e) => setDraft({ ...draft, abTestEnabled: e.target.checked })}
                  className="w-4 h-4 rounded border-slate-300 text-brand focus:ring-brand disabled:opacity-50"
                />
                <span className="text-sm text-slate-700">
                  {draft.mode === 'dryRun' ? '已禁用（dryRun 互斥）' : draft.abTestEnabled ? '已启用' : '已禁用'}
                </span>
              </label>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="每变体最少调用数" hint="A/B 各跑满此数才进入统计检验（5~1000，默认 30）">
                <input
                  type="number"
                  min={5}
                  max={1000}
                  value={draft.abMinCallsPerVariant}
                  onChange={(e) => setDraft({ ...draft, abMinCallsPerVariant: Number(e.target.value) || 5 })}
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand/40 focus:border-brand"
                />
              </Field>

              <Field label="测试期上限（天）" hint="超过即按现有数据强制评估（1~365，默认 7）">
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={draft.abMaxTestDays}
                  onChange={(e) => setDraft({ ...draft, abMaxTestDays: Number(e.target.value) || 1 })}
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand/40 focus:border-brand"
                />
              </Field>
            </div>

            <Field label="评估器 Cron" hint="独立调度，建议错峰 evolver。例 30 4 * * * = 每日 04:30">
              <input
                type="text"
                value={draft.abEvaluatorCron}
                onChange={(e) => setDraft({ ...draft, abEvaluatorCron: e.target.value })}
                className="w-full px-3 py-1.5 text-sm font-mono rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand/40 focus:border-brand"
                placeholder="30 4 * * *"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label="升级 success Δ ≥" hint="B 比 A 成功率至少高多少（且 p<阈值）才升级（0~1，默认 0.05）">
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={draft.abPromoteSuccessDeltaMin}
                  onChange={(e) => setDraft({ ...draft, abPromoteSuccessDeltaMin: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand/40 focus:border-brand"
                />
              </Field>

              <Field label="回滚 success Δ ≥" hint="B 比 A 成功率至少低多少（且 p<阈值）才回滚（0~1，默认 0.10）">
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={draft.abRollbackSuccessDeltaMin}
                  onChange={(e) => setDraft({ ...draft, abRollbackSuccessDeltaMin: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand/40 focus:border-brand"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="p 值阈值" hint="Mann-Whitney U 检验显著性阈值（0~1，默认 0.05）">
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={draft.abPValueThreshold}
                  onChange={(e) => setDraft({ ...draft, abPValueThreshold: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand/40 focus:border-brand"
                />
              </Field>

              <Field label="耗时倍数回滚阈值" hint="B 平均耗时 ≥ A × 此倍数则强制回滚（1~10，默认 1.5）">
                <input
                  type="number"
                  min={1}
                  max={10}
                  step={0.1}
                  value={draft.abDurationRatioRollback}
                  onChange={(e) => setDraft({ ...draft, abDurationRatioRollback: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand/40 focus:border-brand"
                />
              </Field>
            </div>
          </div>
        </details>

        <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-slate-100">
          {isDirty && (
            <button
              onClick={() => setDraft(original)}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            >放弃改动</button>
          )}
          <button
            onClick={handleSave}
            disabled={!isDirty || saving}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              isDirty && !saving
                ? 'bg-brand text-white hover:bg-brand-hover'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}
          >{saving ? '保存中…' : isDirty ? '保存改动' : '已保存'}</button>
        </div>
      </section>

      {/* ─── Curator 子区（PR6: 完整配置 + 状态合一） ─── */}
      <section className="rounded-xl border border-slate-200 p-5 bg-white">
        <header className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Skill Curator</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              跨 session umbrella consolidation + 自动 stale/archive 治理
            </p>
          </div>
          <button
            onClick={handleRunCurator}
            disabled={running !== null}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {running === 'curator' ? '触发中…' : '立即触发'}
          </button>
        </header>

        {/* 配置区 */}
        <div className="space-y-3">
          <Field label="启用" hint="关闭后调度器不会自动触发；立即触发按钮仍然可用">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={curatorDraft.enabled}
                onChange={(e) => setCuratorDraft({ ...curatorDraft, enabled: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300 text-brand focus:ring-brand"
              />
              <span className="text-sm text-slate-700">{curatorDraft.enabled ? '已启用' : '已禁用'}</span>
            </label>
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label="触发间隔（天）" hint="跨 session 治理周期，默认 7">
              <input
                type="number"
                min={1}
                max={365}
                value={curatorDraft.intervalDays}
                onChange={(e) => setCuratorDraft({ ...curatorDraft, intervalDays: Number(e.target.value) || 1 })}
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand/40 focus:border-brand"
              />
            </Field>

            <Field label="陈旧阈值（天）" hint="N 天未用 → stale 状态">
              <input
                type="number"
                min={1}
                max={3650}
                value={curatorDraft.staleDays}
                onChange={(e) => setCuratorDraft({ ...curatorDraft, staleDays: Number(e.target.value) || 1 })}
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand/40 focus:border-brand"
              />
            </Field>

            <Field label="归档阈值（天）" hint="N 天未用 → 物理归档（须 > 陈旧阈值）">
              <input
                type="number"
                min={1}
                max={3650}
                value={curatorDraft.archivedDays}
                onChange={(e) => setCuratorDraft({ ...curatorDraft, archivedDays: Number(e.target.value) || 1 })}
                className={`w-full px-3 py-1.5 text-sm rounded-lg border focus:ring-2 focus:ring-brand/40 focus:border-brand ${
                  curatorDraft.archivedDays <= curatorDraft.staleDays ? 'border-rose-300 bg-rose-50' : 'border-slate-200'
                }`}
              />
            </Field>
          </div>

          <Field label="保护 bundled" hint="开启时内置 skill 永远不被自动归档（推荐保持开启）">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={curatorDraft.protectBundled}
                onChange={(e) => setCuratorDraft({ ...curatorDraft, protectBundled: e.target.checked })}
                className="w-4 h-4 rounded border-slate-300 text-brand focus:ring-brand"
              />
              <span className="text-sm text-slate-700">{curatorDraft.protectBundled ? '已保护' : '未保护（不推荐）'}</span>
            </label>
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-slate-100">
          {isCuratorDirty && (
            <button
              onClick={() => setCuratorDraft(curatorOriginal)}
              disabled={savingCurator}
              className="px-3 py-1.5 text-xs font-medium rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            >放弃改动</button>
          )}
          <button
            onClick={handleCuratorSave}
            disabled={!isCuratorDirty || savingCurator}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              isCuratorDirty && !savingCurator
                ? 'bg-brand text-white hover:bg-brand-hover'
                : 'bg-slate-100 text-slate-400 cursor-not-allowed'
            }`}
          >{savingCurator ? '保存中…' : isCuratorDirty ? '保存改动' : '已保存'}</button>
        </div>

        {/* 状态区 */}
        {curator && (
          <div className="mt-5 pt-4 border-t border-slate-100 space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-3">
              <CuratorStat label="active" value={curator.agentCreatedStateCounts.active} color="text-emerald-600" />
              <CuratorStat label="stale" value={curator.agentCreatedStateCounts.stale} color="text-amber-600" />
              <CuratorStat label="archived" value={curator.agentCreatedStateCounts.archived} color="text-slate-500" />
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-slate-50">
              <div>
                <p className="text-sm text-slate-700">{curator.state.paused ? '已暂停' : '正常调度'}</p>
                <p className="text-xs text-slate-500 mt-0.5">{curator.nextRun.reason}</p>
              </div>
              <button
                onClick={handleToggleCuratorPause}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50"
              >
                {curator.state.paused ? '恢复调度' : '暂停调度'}
              </button>
            </div>

            <div className="text-xs text-slate-500 space-y-0.5">
              <p>已钉住：<strong className="text-slate-700">{curator.pinnedCount}</strong> 个 skill（不会被自动归档）</p>
              <p>累计运行：<strong className="text-slate-700">{curator.state.runCount}</strong> 次</p>
              {curator.state.lastRunAt && (
                <p>最近一次：<span className="text-slate-700">{new Date(curator.state.lastRunAt).toLocaleString('zh-CN')}</span> — {curator.state.lastRunSummary ?? '—'}</p>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

interface FieldProps {
  label: string;
  hint?: string;
  children: React.ReactNode;
}

function Field({ label, hint, children }: FieldProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function CuratorStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="p-3 rounded-lg bg-slate-50 text-center">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-slate-500 mt-0.5">{label}</div>
    </div>
  );
}

// ─── M7-Tier2 PR5: 安全策略 Tab（5×3 矩阵） ───────────────────────────────

type SkillSourceKey = 'bundled' | 'local' | 'clawhub' | 'github' | 'mcp';
type RiskKey = 'low' | 'medium' | 'high';
type PolicyValue = 'auto' | 'require-confirm' | 'block';

const SOURCE_LABELS: Record<SkillSourceKey, string> = {
  bundled: '内置',
  local: '本地',
  clawhub: 'ClawHub',
  github: 'GitHub',
  mcp: 'MCP',
};

const RISK_LABELS: Record<RiskKey, string> = {
  low: '低风险',
  medium: '中风险',
  high: '高风险',
};

const POLICY_LABELS: Record<PolicyValue, { label: string; bg: string; text: string }> = {
  auto: { label: '直接安装', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  'require-confirm': { label: '需确认', bg: 'bg-amber-50', text: 'text-amber-800' },
  block: { label: '阻止', bg: 'bg-rose-50', text: 'text-rose-700' },
};

const POLICY_CYCLE: PolicyValue[] = ['auto', 'require-confirm', 'block'];

const SOURCES: SkillSourceKey[] = ['bundled', 'local', 'clawhub', 'github', 'mcp'];
const RISKS: RiskKey[] = ['low', 'medium', 'high'];

interface PolicyMatrix {
  default: Record<string, PolicyValue>;
  override: Record<string, PolicyValue>;
}

function SecurityPolicyTab() {
  const [matrix, setMatrix] = useState<PolicyMatrix | null>(null);
  const [draft, setDraft] = useState<Record<string, PolicyValue>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await get<PolicyMatrix>('/skill/policy');
      setMatrix(res);
      setDraft(res.override);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '加载失败', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { void load(); }, [load]);

  /** 当前生效值 = override 优先，缺省 default */
  const effective = useCallback((source: SkillSourceKey, risk: RiskKey): PolicyValue => {
    const key = `${source}:${risk}`;
    return draft[key] ?? matrix?.default[key] ?? 'require-confirm';
  }, [draft, matrix]);

  /** 单元格点击：在 auto → require-confirm → block 三态间循环 */
  const handleCellCycle = useCallback((source: SkillSourceKey, risk: RiskKey) => {
    const key = `${source}:${risk}`;
    const cur = effective(source, risk);
    const next = POLICY_CYCLE[(POLICY_CYCLE.indexOf(cur) + 1) % POLICY_CYCLE.length]!;
    const defaultVal = matrix?.default[key];
    setDraft((prev) => {
      const out = { ...prev };
      if (next === defaultVal) {
        delete out[key];           // 与默认一致 → 去除覆盖
      } else {
        out[key] = next;
      }
      return out;
    });
  }, [effective, matrix]);

  const isDirty = matrix !== null
    && JSON.stringify(matrix.override) !== JSON.stringify(draft);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await post<{ ok: boolean; override: Record<string, PolicyValue> }>(
        '/skill/policy',
        { override: draft },
      );
      setMatrix((m) => m ? { ...m, override: res.override } : m);
      setDraft(res.override);
      showToast('已保存', 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  }, [draft, showToast]);

  const handleResetAll = useCallback(() => {
    if (!matrix) return;
    if (!window.confirm('确定清空所有覆盖，恢复默认矩阵？')) return;
    setDraft({});
  }, [matrix]);

  if (loading || !matrix) {
    return <div className="text-center py-20 text-slate-400 text-sm">加载中…</div>;
  }

  const overrideCount = Object.keys(draft).length;

  return (
    <div className="max-w-3xl space-y-4">
      {toast && (
        <div className={`px-4 py-2 rounded-lg text-sm ${
          toast.type === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
        }`}>{toast.message}</div>
      )}

      <section className="rounded-xl border border-slate-200 p-5 bg-white">
        <header className="mb-4">
          <h3 className="text-base font-semibold text-slate-900">Skill 安装策略矩阵</h3>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            按"来源 × 风险等级"决定 Skill 安装时的处理：
            <span className="ml-1 px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-medium">直接安装</span>
            <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 font-medium">需确认</span>
            <span className="ml-1 px-1.5 py-0.5 rounded bg-rose-50 text-rose-700 font-medium">阻止</span>。
            点击单元格在三态间切换。覆盖项以蓝框标记，与默认相同时自动清除（节省存储 + 避免误判)。
          </p>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 border-b border-slate-200">来源 \ 风险</th>
                {RISKS.map((r) => (
                  <th key={r} className="px-3 py-2 text-center text-xs font-medium text-slate-500 border-b border-slate-200">
                    {RISK_LABELS[r]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SOURCES.map((src) => (
                <tr key={src} className="border-b border-slate-100">
                  <td className="px-3 py-2 text-sm font-medium text-slate-700">{SOURCE_LABELS[src]}</td>
                  {RISKS.map((r) => {
                    const key = `${src}:${r}`;
                    const value = effective(src, r);
                    const isOverridden = draft[key] !== undefined;
                    const meta = POLICY_LABELS[value];
                    return (
                      <td key={r} className="px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleCellCycle(src, r)}
                          className={`w-full px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${meta.bg} ${meta.text} ${
                            isOverridden ? 'ring-2 ring-blue-400' : 'hover:ring-1 hover:ring-slate-300'
                          }`}
                          title={isOverridden ? `已覆盖（默认：${POLICY_LABELS[matrix.default[key] ?? 'require-confirm'].label}）` : '点击修改'}
                        >
                          {meta.label}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
          <div className="text-xs text-slate-500">
            当前覆盖：<strong className="text-slate-700">{overrideCount}</strong> 个单元格（共 15 个）
          </div>
          <div className="flex items-center gap-2">
            {overrideCount > 0 && (
              <button
                onClick={handleResetAll}
                disabled={saving}
                className="px-3 py-1.5 text-xs font-medium rounded-lg text-rose-600 hover:bg-rose-50 disabled:opacity-40"
              >全部恢复默认</button>
            )}
            {isDirty && (
              <button
                onClick={() => setDraft(matrix.override)}
                disabled={saving}
                className="px-3 py-1.5 text-xs font-medium rounded-lg text-slate-600 hover:bg-slate-100 disabled:opacity-40"
              >放弃改动</button>
            )}
            <button
              onClick={handleSave}
              disabled={!isDirty || saving}
              className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                isDirty && !saving
                  ? 'bg-brand text-white hover:bg-brand-hover'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >{saving ? '保存中…' : isDirty ? '保存改动' : '已保存'}</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function AboutTab() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-600">应用名称</span>
          <span className="text-sm text-slate-800 font-medium">{BRAND_NAME}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-slate-600">架构</span>
          <span className="text-sm text-slate-800">Tauri 2.0 + Node.js Sidecar</span>
        </div>
      </div>
    </div>
  );
}

// ─── 主页面 ───

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-slate-200 bg-white">
        <h2 className="text-lg font-bold text-slate-900">设置</h2>
        {/* Tab 切换 */}
        <div className="flex gap-1 mt-3">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                activeTab === tab.key
                  ? 'bg-brand/10 text-brand font-medium'
                  : 'text-slate-500 hover:text-slate-700 hover:bg-slate-50'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {activeTab === 'general' && <GeneralTab />}
        {activeTab === 'env' && <EnvVarsTab />}
        {activeTab === 'mcp' && <MCPServersPanel />}
        {activeTab === 'skill-evolver' && <SkillEvolverTab />}
        {activeTab === 'security-policy' && <SecurityPolicyTab />}
        {activeTab === 'api-docs' && <ApiDocsPanel />}
        {activeTab === 'about' && <AboutTab />}
      </div>
    </div>
  );
}
