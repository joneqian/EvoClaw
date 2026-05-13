import { useState, useEffect, useCallback, useMemo } from 'react';
import { Lock, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { BRAND_NAME } from '@evoclaw/shared';
import { get, post, put, del } from '../lib/api';
import Select from '../components/Select';
import MCPServersPanel from '../components/MCPServersPanel';
import ApiDocsPanel from '../components/ApiDocsPanel';
import ProfileManager from '../components/ProfileManager';
import LanguageSwitcher from '../components/LanguageSwitcher';
import { useTheme, type ThemeMode } from '../contexts/ThemeProvider';

// ─── 主题切换行（M15 PR-U1） ───

function ThemeRow() {
  const { mode, setMode } = useTheme();
  const { t } = useTranslation();
  return (
    <div className="px-4 py-3 flex items-center justify-between">
      <div>
        <div className="text-sm font-medium text-foreground">{t('settings.theme')}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{t('settings.themeDesc')}</div>
      </div>
      <Select
        value={mode}
        onChange={(val) => setMode(val as ThemeMode)}
        options={[
          { value: 'system', label: t('settings.themeFollow') },
          { value: 'light', label: t('settings.themeLight') },
          { value: 'dark', label: t('settings.themeDark') },
        ]}
        className="w-[140px]"
      />
    </div>
  );
}

// ─── 界面语言切换行（M15 PR-U4） ───

function UILanguageRow() {
  const { t } = useTranslation();
  return (
    <div className="px-4 py-3 flex items-center justify-between">
      <div>
        <div className="text-sm font-medium text-foreground">{t('settings.uiLanguage')}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{t('settings.uiLanguageDesc')}</div>
      </div>
      <LanguageSwitcher />
    </div>
  );
}

// ─── Tab 定义 ───

type SettingsTab = 'general' | 'env' | 'mcp' | 'skill-evolver' | 'security-policy' | 'identity-links' | 'api-docs' | 'about';

const TABS: { key: SettingsTab; labelKey: string }[] = [
  { key: 'general', labelKey: 'settings.tabs.general' },
  { key: 'env', labelKey: 'settings.tabs.env' },
  { key: 'mcp', labelKey: 'settings.tabs.mcp' },
  { key: 'skill-evolver', labelKey: 'settings.tabs.skillEvolver' },
  { key: 'security-policy', labelKey: 'settings.tabs.securityPolicy' },
  { key: 'identity-links', labelKey: 'settings.tabs.identityLinks' },
  { key: 'api-docs', labelKey: 'settings.tabs.apiDocs' },
  { key: 'about', labelKey: 'settings.tabs.about' },
];

// ─── 通用设置 Tab ───

/** 检查字段是否被企业管理员锁定 */
function isEnforced(enforcedPaths: string[], field: string): boolean {
  return enforcedPaths.some(p => p === field || field.startsWith(p + '.'));
}

/** 锁定标记组件 */
function EnforcedBadge() {
  const { t } = useTranslation();
  return (
    <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-warning/15 text-warning" title={t('settings.enforcedTooltip')}>
      <Lock className="w-3 h-3 mr-0.5" strokeWidth={2} aria-hidden="true" />
      {t('settings.enforced')}
    </span>
  );
}

function GeneralTab() {
  const { t } = useTranslation();
  const [language, setLanguage] = useState<'zh' | 'en'>('zh');
  const [enforced, setEnforced] = useState<string[]>([]);

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

  const saveConfig = useCallback(async (patch: Record<string, unknown>) => {
    try {
      await put('/config', patch);
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('common.saveFailed'));
    }
  }, []);

  return (
    <>
      {/* M6 T2: Profile 管理（置顶，影响面最大） */}
      <ProfileManager showToast={(message, type = 'success') => type === 'error' ? toast.error(message) : toast.success(message)} />

      <div className="bg-card rounded-xl border border-border divide-y divide-border">
        {/* 界面语言（M15 PR-U4） */}
        <UILanguageRow />

        {/* Agent 响应语言 */}
        <div className="px-4 py-3 flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-foreground">{t('settings.language')}{isEnforced(enforced, 'language') && <EnforcedBadge />}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{t('settings.languageDesc')}</div>
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

        {/* 主题切换（M15 PR-U1） */}
        <ThemeRow />

      </div>
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
  const { t } = useTranslation();
  const [envVars, setEnvVars] = useState<EnvVarItem[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [addingNew, setAddingNew] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    if (type === 'error') toast.error(message);
    else toast.success(message);
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

  const saveVars = useCallback(async (vars: Record<string, string>) => {
    try {
      await put('/config/env-vars', { envVars: vars });
      showToast(t('common.saved'));
      fetchEnvVars();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.saveFailed'), 'error');
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
      showToast(t('settings.envExists', { key: k }), 'error');
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
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <p className="text-xs text-muted-foreground">{t('settings.envDesc')}</p>
          <button
            onClick={() => { setAddingNew(true); setNewKey(''); setNewValue(''); }}
            className="text-xs px-2.5 py-1 font-medium text-brand border border-brand/30 rounded-lg
              hover:bg-brand/5 transition-colors"
          >
            + 添加
          </button>
        </div>

        <div className="divide-y divide-border">
          {envVars.length === 0 && !addingNew && (
            <div className="px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">{t('settings.envEmpty')}</p>
              <p className="text-xs text-muted-foreground mt-1">{t('settings.envEmptyHint')}</p>
            </div>
          )}

          {envVars.map((item) => (
            <div key={item.key} className="px-4 py-2 flex items-center gap-2 group">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${item.configured ? 'bg-success' : 'bg-accent'}`} />
              <code className="text-xs font-mono font-semibold text-foreground bg-muted px-2 py-0.5 rounded min-w-[140px] shrink-0">
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
                    placeholder={t('settings.envValue')}
                    className="w-full px-2.5 py-1 text-xs border border-border rounded-lg
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand font-mono"
                    autoFocus
                  />
                </div>
              ) : (
                <>
                  <code className="flex-1 text-xs text-muted-foreground font-mono truncate">
                    {item.configured ? item.maskedValue : t('settings.envUnset')}
                  </code>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => startEdit(item.key)}
                      className="p-1 text-muted-foreground hover:text-brand rounded transition-colors"
                      title={t('common.edit')}
                    >
                      <Pencil className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
                    </button>
                    <button
                      onClick={() => handleDelete(item.key)}
                      className="p-1 text-muted-foreground hover:text-danger rounded transition-colors"
                      title={t('common.delete')}
                    >
                      <Trash2 className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
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
                className="w-[160px] px-2.5 py-1 text-xs border border-border rounded-lg
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 font-mono font-semibold"
                autoFocus
              />
              <input
                type="password"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddNew(); if (e.key === 'Escape') { setAddingNew(false); setNewKey(''); setNewValue(''); } }}
                placeholder="Value"
                className="flex-1 px-2.5 py-1 text-xs border border-border rounded-lg
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 font-mono"
              />
              <button
                onClick={handleAddNew}
                disabled={!newKey.trim() || !newValue.trim()}
                className="text-xs px-2.5 py-1 font-medium text-white bg-brand rounded-lg
                  hover:bg-brand-hover disabled:opacity-40 transition-colors"
              >
                {t('settings.add')}
              </button>
              <button
                onClick={() => { setAddingNew(false); setNewKey(''); setNewValue(''); }}
                className="text-xs text-muted-foreground hover:text-muted-foreground"
              >
                {t('common.cancel')}
              </button>
            </div>
          )}
        </div>

        {presetGroupsWithStatus.some(g => g.unconfiguredItems.length > 0) && (
          <div className="px-4 py-3 border-t border-border bg-muted/50 space-y-2">
            {presetGroupsWithStatus.map((group) => (
              <div key={group.label} className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-muted-foreground shrink-0">
                  {group.icon} {group.label}
                  <span className={`ml-1 ${group.configuredCount === group.items.length ? 'text-success' : group.configuredCount > 0 ? 'text-warning' : 'text-muted-foreground'}`}>
                    ({group.configuredCount}/{group.items.length})
                  </span>
                  :
                </span>
                {group.unconfiguredItems.map((p) => (
                  <button
                    key={p.key}
                    onClick={() => handleAddPreset(p.key)}
                    className="text-xs px-2 py-0.5 text-muted-foreground hover:text-brand
                      bg-card border border-border rounded-full
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
  // M7-Tier3 PR-T3-2a/2b: 进化执行模式（apply / dryRun / canary）
  mode: 'apply' | 'dryRun' | 'canary';
  // M7-Tier3 PR-T3-2b: canary B 桶比例（仅 mode='canary' 生效）
  canaryRatioB: number;
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
  const { t } = useTranslation();
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
  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    if (type === 'error') toast.error(message);
    else toast.success(message);
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
      showToast(err instanceof Error ? err.message : t('settings.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

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
      showToast(t('settings.saveSuccessHotReload'), 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.saveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  }, [draft, showToast, t]);

  const handleRunEvolver = useCallback(async () => {
    setRunning('evolver');
    try {
      await post('/skill-evolution/run-now', {});
      showToast(t('settings.evolverTriggered'), 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('settings.triggerFailed'), 'error');
    } finally {
      setRunning(null);
    }
  }, [showToast, t]);

  // M7-Tier3 PR-T3-1c: 立即跑一次 A-B 评估器
  const handleRunAbEvaluator = useCallback(async () => {
    setRunning('ab-evaluator');
    try {
      const res = await post<{ scanned: number; promoted: number; rolledBack: number; inconclusive: number; continued: number; errors: number }>(
        '/skill-evolution/ab-evaluate-now',
        {},
      );
      showToast(
        t('settings.abEvaluatorResult', {
          scanned: res.scanned,
          promoted: res.promoted,
          rolledBack: res.rolledBack,
          inconclusive: res.inconclusive,
          continued: res.continued,
        }),
        'success',
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('settings.triggerFailed'), 'error');
    } finally {
      setRunning(null);
    }
  }, [showToast, t]);

  const handleRunCurator = useCallback(async () => {
    setRunning('curator');
    try {
      await post('/curator/run', {});
      showToast(t('settings.curatorTriggered'), 'success');
      await loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('settings.triggerFailed'), 'error');
    } finally {
      setRunning(null);
    }
  }, [showToast, loadAll, t]);

  const handleToggleCuratorPause = useCallback(async () => {
    if (!curator) return;
    const target = curator.state.paused ? 'resume' : 'pause';
    try {
      await post(`/curator/${target}`, {});
      await loadAll();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('settings.switchFailed'), 'error');
    }
  }, [curator, loadAll, showToast, t]);

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
      showToast(t('settings.curatorSaved'), 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.saveFailed'), 'error');
    } finally {
      setSavingCurator(false);
    }
  }, [curatorDraft, showToast, t]);

  const isCuratorDirty = curatorOriginal !== null && curatorDraft !== null
    && JSON.stringify(curatorOriginal) !== JSON.stringify(curatorDraft);

  if (loading || !draft || !original || !curatorDraft || !curatorOriginal) {
    return <div className="text-center py-20 text-muted-foreground text-sm">{t('common.loading')}</div>;
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* ─── Evolver 子区 ─── */}
      <section className="rounded-xl border border-border p-5 bg-card">
        <header className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">{t('settings.evolverTitle')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{t('settings.evolverDesc')}</p>
          </div>
          <button
            onClick={handleRunEvolver}
            disabled={running !== null}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-foreground bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {running === 'evolver' ? t('settings.evolverTriggering') : t('settings.evolverTriggerNow')}
          </button>
        </header>

        <div className="space-y-3">
          <Field label={t('settings.evolverEnabled')} hint={t('settings.evolverEnabledHint')}>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
                className="w-4 h-4 rounded border-border text-brand focus-visible:ring-brand"
              />
              <span className="text-sm text-foreground">{draft.enabled ? t('settings.evolverStatusEnabled') : t('settings.evolverStatusDisabled')}</span>
            </label>
          </Field>

          <Field label={t('settings.evolverCron')} hint={t('settings.evolverCronHint')}>
            <input
              type="text"
              value={draft.cronSchedule}
              onChange={(e) => setDraft({ ...draft, cronSchedule: e.target.value })}
              className="w-full px-3 py-1.5 text-sm font-mono rounded-lg border border-border focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
              placeholder="0 3 * * *"
            />
          </Field>

          {/* M7-Tier3 PR-T3-2a/2b: 执行模式 */}
          <Field
            label={t('settings.evolverMode')}
            hint={
              draft.mode === 'dryRun'
                ? t('settings.evolverModeHintDryRun')
                : draft.mode === 'canary'
                  ? t('settings.evolverModeHintCanary', { percent: Math.round((draft.canaryRatioB ?? 0.1) * 100) })
                  : t('settings.evolverModeHintApply')
            }
          >
            <select
              value={draft.mode}
              onChange={(e) => {
                const v = e.target.value;
                const next: 'apply' | 'dryRun' | 'canary' =
                  v === 'dryRun' ? 'dryRun' : v === 'canary' ? 'canary' : 'apply';
                // dryRun 与 abTestEnabled 互斥（schema refine 强制），切到 dryRun 自动关 A-B
                setDraft({
                  ...draft,
                  mode: next,
                  ...(next === 'dryRun' ? { abTestEnabled: false } : {}),
                });
              }}
              className="w-full px-3 py-1.5 text-sm rounded-lg border border-border focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
            >
              <option value="apply">{t('settings.evolverModeApply')}</option>
              <option value="dryRun">{t('settings.evolverModeDryRun')}</option>
              <option value="canary">{t('settings.evolverModeCanary')}</option>
            </select>
          </Field>

          {/* M7-Tier3 PR-T3-2b: canary B 桶比例 — 仅 mode='canary' 显示 */}
          {draft.mode === 'canary' && (
            <Field
              label={t('settings.evolverCanaryRatio')}
              hint={t('settings.evolverCanaryRatioHint')}
            >
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0.05}
                  max={0.5}
                  step={0.05}
                  value={draft.canaryRatioB}
                  onChange={(e) => setDraft({ ...draft, canaryRatioB: Number(e.target.value) })}
                  className="flex-1"
                />
                <input
                  type="number"
                  min={0.05}
                  max={0.5}
                  step={0.05}
                  value={draft.canaryRatioB}
                  onChange={(e) => setDraft({ ...draft, canaryRatioB: Number(e.target.value) })}
                  className="w-20 px-2 py-1 text-sm rounded-lg border border-border focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
                />
                <span className="text-sm text-muted-foreground tabular-nums w-12">
                  {Math.round(draft.canaryRatioB * 100)}%
                </span>
              </div>
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label={t('settings.evolverMinEvidence')} hint={t('settings.evolverMinEvidenceHint')}>
              <input
                type="number"
                min={1}
                max={50}
                value={draft.minEvidenceCount}
                onChange={(e) => setDraft({ ...draft, minEvidenceCount: Number(e.target.value) || 1 })}
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-border focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
              />
            </Field>

            <Field label={t('settings.evolverSuccessRate')} hint={t('settings.evolverSuccessRateHint')}>
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={draft.successRateThreshold}
                onChange={(e) => setDraft({ ...draft, successRateThreshold: Number(e.target.value) })}
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-border focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
              />
            </Field>
          </div>

          <Field label={t('settings.evolverMaxCandidates')} hint={t('settings.evolverMaxCandidatesHint')}>
            <input
              type="number"
              min={1}
              max={20}
              value={draft.maxCandidatesPerRun}
              onChange={(e) => setDraft({ ...draft, maxCandidatesPerRun: Number(e.target.value) || 1 })}
              className="w-full px-3 py-1.5 text-sm rounded-lg border border-border focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
            />
          </Field>

          <Field label={t('settings.evolverModel')} hint={t('settings.evolverModelHint')}>
            <input
              type="text"
              value={draft.model ?? ''}
              onChange={(e) => setDraft({ ...draft, model: e.target.value || undefined })}
              className="w-full px-3 py-1.5 text-sm font-mono rounded-lg border border-border focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
              placeholder={t('settings.evolverModelPlaceholder')}
            />
          </Field>
        </div>

        {/* ─── A-B 对照实验子分组 ─── */}
        <details className="mt-4 pt-4 border-t border-border" open={draft.abTestEnabled}>
          <summary className="cursor-pointer flex items-center justify-between -mx-1 px-1 py-1 rounded hover:bg-muted">
            <div>
              <span className="text-sm font-semibold text-foreground">{t('settings.abTitle')}</span>
              <span className="ml-2 text-xs text-muted-foreground">{t('settings.abSubtitle')}</span>
            </div>
            <button
              type="button"
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); void handleRunAbEvaluator(); }}
              disabled={running !== null}
              className="px-3 py-1 text-xs font-medium rounded-lg border border-border text-foreground bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {running === 'ab-evaluator' ? t('settings.abEvaluating') : t('settings.abEvaluateNow')}
            </button>
          </summary>

          <div className="mt-3 space-y-3">
            <Field
              label={t('settings.abEnable')}
              hint={
                draft.mode === 'dryRun'
                  ? t('settings.abEnableHintDryRun')
                  : t('settings.abEnableHintNormal')
              }
            >
              <label className={`inline-flex items-center gap-2 ${draft.mode === 'dryRun' ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
                <input
                  type="checkbox"
                  checked={draft.abTestEnabled && draft.mode !== 'dryRun'}
                  disabled={draft.mode === 'dryRun'}
                  onChange={(e) => setDraft({ ...draft, abTestEnabled: e.target.checked })}
                  className="w-4 h-4 rounded border-border text-brand focus-visible:ring-brand disabled:opacity-50"
                />
                <span className="text-sm text-foreground">
                  {draft.mode === 'dryRun' ? t('settings.abDisabledDryRun') : draft.abTestEnabled ? t('settings.evolverStatusEnabled') : t('settings.evolverStatusDisabled')}
                </span>
              </label>
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t('settings.abMinCalls')} hint={t('settings.abMinCallsHint')}>
                <input
                  type="number"
                  min={5}
                  max={1000}
                  value={draft.abMinCallsPerVariant}
                  onChange={(e) => setDraft({ ...draft, abMinCallsPerVariant: Number(e.target.value) || 5 })}
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-border focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
                />
              </Field>

              <Field label={t('settings.abMaxDays')} hint={t('settings.abMaxDaysHint')}>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={draft.abMaxTestDays}
                  onChange={(e) => setDraft({ ...draft, abMaxTestDays: Number(e.target.value) || 1 })}
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-border focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
                />
              </Field>
            </div>

            <Field label={t('settings.abEvaluatorCron')} hint={t('settings.abEvaluatorCronHint')}>
              <input
                type="text"
                value={draft.abEvaluatorCron}
                onChange={(e) => setDraft({ ...draft, abEvaluatorCron: e.target.value })}
                className="w-full px-3 py-1.5 text-sm font-mono rounded-lg border border-border focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
                placeholder="30 4 * * *"
              />
            </Field>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t('settings.abPromoteDelta')} hint={t('settings.abPromoteDeltaHint')}>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={draft.abPromoteSuccessDeltaMin}
                  onChange={(e) => setDraft({ ...draft, abPromoteSuccessDeltaMin: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-border focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
                />
              </Field>

              <Field label={t('settings.abRollbackDelta')} hint={t('settings.abRollbackDeltaHint')}>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={draft.abRollbackSuccessDeltaMin}
                  onChange={(e) => setDraft({ ...draft, abRollbackSuccessDeltaMin: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-border focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
                />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label={t('settings.abPValue')} hint={t('settings.abPValueHint')}>
                <input
                  type="number"
                  min={0}
                  max={1}
                  step={0.01}
                  value={draft.abPValueThreshold}
                  onChange={(e) => setDraft({ ...draft, abPValueThreshold: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-border focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
                />
              </Field>

              <Field label={t('settings.abDurationRatio')} hint={t('settings.abDurationRatioHint')}>
                <input
                  type="number"
                  min={1}
                  max={10}
                  step={0.1}
                  value={draft.abDurationRatioRollback}
                  onChange={(e) => setDraft({ ...draft, abDurationRatioRollback: Number(e.target.value) })}
                  className="w-full px-3 py-1.5 text-sm rounded-lg border border-border focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
                />
              </Field>
            </div>
          </div>
        </details>

        <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-border">
          {isDirty && (
            <button
              onClick={() => setDraft(original)}
              disabled={saving}
              className="px-3 py-1.5 text-xs font-medium rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-40"
            >{t('settings.discardChanges')}</button>
          )}
          <button
            onClick={handleSave}
            disabled={!isDirty || saving}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              isDirty && !saving
                ? 'bg-brand text-white hover:bg-brand-hover'
                : 'bg-accent text-muted-foreground cursor-not-allowed'
            }`}
          >{saving ? t('common.saving') : isDirty ? t('settings.saveChanges') : t('common.saved')}</button>
        </div>
      </section>

      {/* ─── Curator 子区（PR6: 完整配置 + 状态合一） ─── */}
      <section className="rounded-xl border border-border p-5 bg-card">
        <header className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-semibold text-foreground">{t('settings.curatorTitle')}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t('settings.curatorDesc')}
            </p>
          </div>
          <button
            onClick={handleRunCurator}
            disabled={running !== null}
            className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-foreground bg-card hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {running === 'curator' ? t('settings.evolverTriggering') : t('settings.evolverTriggerNow')}
          </button>
        </header>

        {/* 配置区 */}
        <div className="space-y-3">
          <Field label={t('settings.curatorEnabled')} hint={t('settings.curatorEnabledHint')}>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={curatorDraft.enabled}
                onChange={(e) => setCuratorDraft({ ...curatorDraft, enabled: e.target.checked })}
                className="w-4 h-4 rounded border-border text-brand focus-visible:ring-brand"
              />
              <span className="text-sm text-foreground">{curatorDraft.enabled ? t('settings.evolverStatusEnabled') : t('settings.evolverStatusDisabled')}</span>
            </label>
          </Field>

          <div className="grid grid-cols-3 gap-3">
            <Field label={t('settings.curatorInterval')} hint={t('settings.curatorIntervalHint')}>
              <input
                type="number"
                min={1}
                max={365}
                value={curatorDraft.intervalDays}
                onChange={(e) => setCuratorDraft({ ...curatorDraft, intervalDays: Number(e.target.value) || 1 })}
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-border focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
              />
            </Field>

            <Field label={t('settings.curatorStale')} hint={t('settings.curatorStaleHint')}>
              <input
                type="number"
                min={1}
                max={3650}
                value={curatorDraft.staleDays}
                onChange={(e) => setCuratorDraft({ ...curatorDraft, staleDays: Number(e.target.value) || 1 })}
                className="w-full px-3 py-1.5 text-sm rounded-lg border border-border focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
              />
            </Field>

            <Field label={t('settings.curatorArchived')} hint={t('settings.curatorArchivedHint')}>
              <input
                type="number"
                min={1}
                max={3650}
                value={curatorDraft.archivedDays}
                onChange={(e) => setCuratorDraft({ ...curatorDraft, archivedDays: Number(e.target.value) || 1 })}
                className={`w-full px-3 py-1.5 text-sm rounded-lg border focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand ${
                  curatorDraft.archivedDays <= curatorDraft.staleDays ? 'border-rose-300 bg-rose-50 dark:bg-rose-950/40' : 'border-border'
                }`}
              />
            </Field>
          </div>

          <Field label={t('settings.curatorProtect')} hint={t('settings.curatorProtectHint')}>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={curatorDraft.protectBundled}
                onChange={(e) => setCuratorDraft({ ...curatorDraft, protectBundled: e.target.checked })}
                className="w-4 h-4 rounded border-border text-brand focus-visible:ring-brand"
              />
              <span className="text-sm text-foreground">{curatorDraft.protectBundled ? t('settings.curatorProtected') : t('settings.curatorUnprotected')}</span>
            </label>
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 mt-4 pt-4 border-t border-border">
          {isCuratorDirty && (
            <button
              onClick={() => setCuratorDraft(curatorOriginal)}
              disabled={savingCurator}
              className="px-3 py-1.5 text-xs font-medium rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-40"
            >{t('settings.discardChanges')}</button>
          )}
          <button
            onClick={handleCuratorSave}
            disabled={!isCuratorDirty || savingCurator}
            className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
              isCuratorDirty && !savingCurator
                ? 'bg-brand text-white hover:bg-brand-hover'
                : 'bg-accent text-muted-foreground cursor-not-allowed'
            }`}
          >{savingCurator ? t('common.saving') : isCuratorDirty ? t('settings.saveChanges') : t('common.saved')}</button>
        </div>

        {/* 状态区 */}
        {curator && (
          <div className="mt-5 pt-4 border-t border-border space-y-3 text-sm">
            <div className="grid grid-cols-3 gap-3">
              <CuratorStat label="active" value={curator.agentCreatedStateCounts.active} color="text-success" />
              <CuratorStat label="stale" value={curator.agentCreatedStateCounts.stale} color="text-warning" />
              <CuratorStat label="archived" value={curator.agentCreatedStateCounts.archived} color="text-muted-foreground" />
            </div>

            <div className="flex items-center justify-between p-3 rounded-lg bg-muted">
              <div>
                <p className="text-sm text-foreground">{curator.state.paused ? t('settings.curatorPaused') : t('settings.curatorRunning')}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{curator.nextRun.reason}</p>
              </div>
              <button
                onClick={handleToggleCuratorPause}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-border text-foreground bg-card hover:bg-muted"
              >
                {curator.state.paused ? t('settings.curatorResume') : t('settings.curatorPause')}
              </button>
            </div>

            <div className="text-xs text-muted-foreground space-y-0.5">
              <p>{t('settings.curatorPinnedCountPrefix')}<strong className="text-foreground">{curator.pinnedCount}</strong>{t('settings.curatorPinnedCountSuffix')}</p>
              <p>{t('settings.curatorRunCountPrefix')}<strong className="text-foreground">{curator.state.runCount}</strong>{t('settings.curatorRunCountSuffix')}</p>
              {curator.state.lastRunAt && (
                <p>{t('settings.curatorLastRun', {
                  time: new Date(curator.state.lastRunAt).toLocaleString(),
                  summary: curator.state.lastRunSummary ?? '—',
                })}</p>
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
      <label className="block text-sm font-medium text-foreground mb-1">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

function CuratorStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="p-3 rounded-lg bg-muted text-center">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

// ─── M7-Tier2 PR5: 安全策略 Tab（5×3 矩阵） ───────────────────────────────

type SkillSourceKey = 'bundled' | 'local' | 'clawhub' | 'github' | 'mcp';
type RiskKey = 'low' | 'medium' | 'high';
type PolicyValue = 'auto' | 'require-confirm' | 'block';

const SOURCE_LABEL_KEYS: Record<SkillSourceKey, string> = {
  bundled: 'settings.policySourceBundled',
  local: 'settings.policySourceLocal',
  clawhub: 'settings.policySourceClawhub',
  github: 'settings.policySourceGithub',
  mcp: 'settings.policySourceMcp',
};

const RISK_LABEL_KEYS: Record<RiskKey, string> = {
  low: 'settings.policyRiskLow',
  medium: 'settings.policyRiskMedium',
  high: 'settings.policyRiskHigh',
};

const POLICY_META: Record<PolicyValue, { labelKey: string; bg: string; text: string }> = {
  auto: { labelKey: 'settings.policyValueAuto', bg: 'bg-success/10', text: 'text-success' },
  'require-confirm': { labelKey: 'settings.policyValueConfirm', bg: 'bg-warning/10', text: 'text-warning' },
  block: { labelKey: 'settings.policyValueBlock', bg: 'bg-rose-50 dark:bg-rose-950/40', text: 'text-rose-700 dark:text-rose-300' },
};

const POLICY_CYCLE: PolicyValue[] = ['auto', 'require-confirm', 'block'];

const SOURCES: SkillSourceKey[] = ['bundled', 'local', 'clawhub', 'github', 'mcp'];
const RISKS: RiskKey[] = ['low', 'medium', 'high'];

interface PolicyMatrix {
  default: Record<string, PolicyValue>;
  override: Record<string, PolicyValue>;
}

function SecurityPolicyTab() {
  const { t } = useTranslation();
  const [matrix, setMatrix] = useState<PolicyMatrix | null>(null);
  const [draft, setDraft] = useState<Record<string, PolicyValue>>({});
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    if (type === 'error') toast.error(message);
    else toast.success(message);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await get<PolicyMatrix>('/skill/policy');
      setMatrix(res);
      setDraft(res.override);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('settings.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

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
      showToast(t('common.saved'), 'success');
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('common.saveFailed'), 'error');
    } finally {
      setSaving(false);
    }
  }, [draft, showToast]);

  const handleResetAll = useCallback(() => {
    if (!matrix) return;
    if (!window.confirm(t('settings.policyResetConfirm'))) return;
    setDraft({});
  }, [matrix, t]);

  if (loading || !matrix) {
    return <div className="text-center py-20 text-muted-foreground text-sm">{t('common.loading')}</div>;
  }

  const overrideCount = Object.keys(draft).length;

  return (
    <div className="max-w-3xl space-y-4">
      <section className="rounded-xl border border-border p-5 bg-card">
        <header className="mb-4">
          <h3 className="text-base font-semibold text-foreground">{t('settings.policyTitle')}</h3>
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {t('settings.policyDescPrefix')}
            <span className="ml-1 px-1.5 py-0.5 rounded bg-success/10 text-success font-medium">{t('settings.policyValueAuto')}</span>
            <span className="ml-1 px-1.5 py-0.5 rounded bg-warning/10 text-warning font-medium">{t('settings.policyValueConfirm')}</span>
            <span className="ml-1 px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300 font-medium">{t('settings.policyValueBlock')}</span>
            {t('settings.policyDescSuffix')}
          </p>
        </header>

        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground border-b border-border">{t('settings.policyHeaderSource')}</th>
                {RISKS.map((r) => (
                  <th key={r} className="px-3 py-2 text-center text-xs font-medium text-muted-foreground border-b border-border">
                    {t(RISK_LABEL_KEYS[r])}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {SOURCES.map((src) => (
                <tr key={src} className="border-b border-border">
                  <td className="px-3 py-2 text-sm font-medium text-foreground">{t(SOURCE_LABEL_KEYS[src])}</td>
                  {RISKS.map((r) => {
                    const key = `${src}:${r}`;
                    const value = effective(src, r);
                    const isOverridden = draft[key] !== undefined;
                    const meta = POLICY_META[value];
                    const defaultPolicy = matrix.default[key] ?? 'require-confirm';
                    return (
                      <td key={r} className="px-2 py-2 text-center">
                        <button
                          type="button"
                          onClick={() => handleCellCycle(src, r)}
                          className={`w-full px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${meta.bg} ${meta.text} ${
                            isOverridden ? 'ring-2 ring-info/60' : 'hover:ring-1 hover:ring-border'
                          }`}
                          title={isOverridden
                            ? t('settings.policyOverridden', { label: t(POLICY_META[defaultPolicy].labelKey) })
                            : t('settings.policyCellHint')}
                        >
                          {t(meta.labelKey)}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-4 pt-4 border-t border-border">
          <div className="text-xs text-muted-foreground">
            {t('settings.policyOverridePrefix')}<strong className="text-foreground">{overrideCount}</strong>{t('settings.policyOverrideSuffix')}
          </div>
          <div className="flex items-center gap-2">
            {overrideCount > 0 && (
              <button
                onClick={handleResetAll}
                disabled={saving}
                className="px-3 py-1.5 text-xs font-medium rounded-lg text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:bg-rose-950/40 disabled:opacity-40"
              >{t('settings.policyResetAll')}</button>
            )}
            {isDirty && (
              <button
                onClick={() => setDraft(matrix.override)}
                disabled={saving}
                className="px-3 py-1.5 text-xs font-medium rounded-lg text-muted-foreground hover:bg-accent disabled:opacity-40"
              >{t('settings.discardChanges')}</button>
            )}
            <button
              onClick={handleSave}
              disabled={!isDirty || saving}
              className={`px-4 py-1.5 text-sm font-medium rounded-lg transition-colors ${
                isDirty && !saving
                  ? 'bg-brand text-white hover:bg-brand-hover'
                  : 'bg-accent text-muted-foreground cursor-not-allowed'
              }`}
            >{saving ? t('common.saving') : isDirty ? t('settings.saveChanges') : t('common.saved')}</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function AboutTab() {
  const { t } = useTranslation();
  return (
    <div className="bg-card rounded-xl border border-border p-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{t('settings.aboutAppName')}</span>
          <span className="text-sm text-foreground font-medium">{BRAND_NAME}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">{t('settings.aboutArch')}</span>
          <span className="text-sm text-foreground">Tauri 2.0 + Node.js Sidecar</span>
        </div>
      </div>
    </div>
  );
}

// ─── M13 Phase 1 PR-1B: 我的多渠道身份 Tab ─────────────────────────

interface IdentityLink {
  id: number;
  canonicalId: string;
  channel: string;
  peerId: string;
  createdAt: string;
}

const CHANNEL_OPTIONS = [
  { value: 'feishu', labelKey: 'settings.identityChannelFeishu' },
  { value: 'wecom', labelKey: 'settings.identityChannelWecom' },
  { value: 'weixin', labelKey: 'settings.identityChannelWeixin' },
];

function IdentityLinksTab() {
  const { t } = useTranslation();
  const [links, setLinks] = useState<IdentityLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState({ canonicalId: 'self', channel: 'feishu', peerId: '' });
  const [saving, setSaving] = useState(false);

  const showToast = useCallback((message: string, type: 'success' | 'error') => {
    if (type === 'error') toast.error(message);
    else toast.success(message);
  }, []);

  const loadLinks = useCallback(async () => {
    setLoading(true);
    try {
      const res = await get<{ links: IdentityLink[] }>('/identity-links');
      setLinks(res.links);
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('settings.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast, t]);

  useEffect(() => { void loadLinks(); }, [loadLinks]);

  const handleAdd = async () => {
    if (!draft.canonicalId || !draft.channel || !draft.peerId.trim()) {
      showToast(t('settings.identityIncomplete'), 'error');
      return;
    }
    setSaving(true);
    try {
      await post('/identity-links', {
        canonicalId: draft.canonicalId,
        channel: draft.channel,
        peerId: draft.peerId.trim(),
      });
      showToast(t('settings.identityBindSuccess', {
        channel: draft.channel,
        peer: draft.peerId.trim(),
        canonical: draft.canonicalId,
      }), 'success');
      setDraft({ ...draft, peerId: '' });
      await loadLinks();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('settings.identityBindFailed'), 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (channel: string, peerId: string) => {
    if (!window.confirm(t('settings.identityUnbindConfirm', { channel, peer: peerId }))) return;
    try {
      await del(`/identity-links?channel=${encodeURIComponent(channel)}&peer=${encodeURIComponent(peerId)}`);
      showToast(t('settings.identityUnbindSuccess', { channel, peer: peerId }), 'success');
      await loadLinks();
    } catch (err) {
      showToast(err instanceof Error ? err.message : t('settings.identityUnbindFailed'), 'error');
    }
  };

  // 按 canonical 分组
  const grouped: Array<[string, IdentityLink[]]> = useMemo(() => {
    const map = new Map<string, IdentityLink[]>();
    for (const link of links) {
      const arr = map.get(link.canonicalId) ?? [];
      arr.push(link);
      map.set(link.canonicalId, arr);
    }
    return Array.from(map.entries());
  }, [links]);

  return (
    <div className="max-w-3xl space-y-6">
      <section className="rounded-xl border border-border p-5 bg-card">
        <header className="mb-4">
          <h3 className="text-base font-semibold text-foreground">{t('settings.identityTitle')}</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {t('settings.identityDesc')}
          </p>
        </header>

        {/* 添加表单 */}
        <div className="bg-muted rounded-lg p-3 mb-4 grid grid-cols-12 gap-2 items-end">
          <div className="col-span-3">
            <label className="text-xs text-muted-foreground block mb-1">{t('settings.identityCanonical')}</label>
            <input
              type="text"
              value={draft.canonicalId}
              onChange={(e) => setDraft({ ...draft, canonicalId: e.target.value })}
              className="w-full px-2 py-1 text-sm rounded border border-border focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
              placeholder="self"
            />
          </div>
          <div className="col-span-3">
            <label className="text-xs text-muted-foreground block mb-1">{t('settings.identityChannel')}</label>
            <select
              value={draft.channel}
              onChange={(e) => setDraft({ ...draft, channel: e.target.value })}
              className="w-full px-2 py-1 text-sm rounded border border-border focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
            >
              {CHANNEL_OPTIONS.map(c => <option key={c.value} value={c.value}>{t(c.labelKey)}</option>)}
            </select>
          </div>
          <div className="col-span-4">
            <label className="text-xs text-muted-foreground block mb-1">{t('settings.identityPeerId')}</label>
            <input
              type="text"
              value={draft.peerId}
              onChange={(e) => setDraft({ ...draft, peerId: e.target.value })}
              className="w-full px-2 py-1 text-sm font-mono rounded border border-border focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand"
              placeholder="ou_xxx / userid_yyy / wxid_zzz"
            />
          </div>
          <div className="col-span-2">
            <button
              onClick={handleAdd}
              disabled={saving}
              className="w-full px-3 py-1.5 text-sm font-medium rounded-lg bg-brand text-white hover:bg-brand-hover disabled:opacity-40"
            >{saving ? t('settings.identityBinding') : t('settings.identityBind')}</button>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8 text-muted-foreground text-sm">{t('common.loading')}</div>
        ) : links.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-sm">
            {t('settings.identityEmpty')}
          </div>
        ) : (
          <div className="space-y-3">
            {grouped.map(([canonical, items]) => (
              <div key={canonical} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-foreground">
                    {canonical} <span className="text-xs text-muted-foreground">{t('settings.identityChannelCount', { count: items.length })}</span>
                  </span>
                </div>
                <div className="space-y-1">
                  {items.map(link => {
                    const channelOption = CHANNEL_OPTIONS.find(c => c.value === link.channel);
                    return (
                      <div key={link.id} className="flex items-center justify-between text-sm">
                        <span className="text-foreground">
                          <span className="text-muted-foreground">{channelOption ? t(channelOption.labelKey) : link.channel}：</span>
                          <code className="ml-1 font-mono text-xs bg-accent px-1 py-0.5 rounded">{link.peerId}</code>
                        </span>
                        <button
                          onClick={() => handleRemove(link.channel, link.peerId)}
                          className="text-xs px-2 py-0.5 text-rose-600 dark:text-rose-300 hover:bg-rose-50 dark:bg-rose-950/40 rounded"
                        >{t('settings.identityUnbind')}</button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ─── 主页面 ───

export default function SettingsPage() {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-border bg-card">
        <h2 className="text-lg font-bold text-foreground">{t('settings.title')}</h2>
        {/* Tab 切换 */}
        <div className="flex gap-1 mt-3">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                activeTab === tab.key
                  ? 'bg-brand/10 text-brand font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
              }`}
            >
              {t(tab.labelKey)}
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
        {activeTab === 'identity-links' && <IdentityLinksTab />}
        {activeTab === 'api-docs' && <ApiDocsPanel />}
        {activeTab === 'about' && <AboutTab />}
      </div>
    </div>
  );
}
