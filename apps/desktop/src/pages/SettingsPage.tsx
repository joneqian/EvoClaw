import { useState, useEffect, useCallback } from 'react';
import { BRAND_NAME } from '@evoclaw/shared';
import { get, put } from '../lib/api';
import Select from '../components/Select';
import MCPServersPanel from '../components/MCPServersPanel';
import ApiDocsPanel from '../components/ApiDocsPanel';
import ProfileManager from '../components/ProfileManager';

// ─── Tab 定义 ───

type SettingsTab = 'general' | 'env' | 'mcp' | 'api-docs' | 'about';

const TABS: { key: SettingsTab; label: string }[] = [
  { key: 'general', label: '通用' },
  { key: 'env', label: '环境变量' },
  { key: 'mcp', label: 'MCP 服务器' },
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
        {activeTab === 'api-docs' && <ApiDocsPanel />}
        {activeTab === 'about' && <AboutTab />}
      </div>
    </div>
  );
}
