import { useState, useEffect, useCallback } from 'react';
import { get, put, post, del } from '../lib/api';
import Select from '../components/Select';

/** Provider 预设（新增 Provider 时可选） */
interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  placeholder: string;
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', api: 'openai-completions', placeholder: 'sk-...' },
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', api: 'anthropic', placeholder: 'sk-ant-...' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', api: 'openai-completions', placeholder: 'sk-...' },
  { id: 'qwen', name: '通义千问 (Qwen)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', api: 'openai-completions', placeholder: 'sk-...' },
  { id: 'glm', name: '智谱 (GLM)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', api: 'openai-completions', placeholder: '...' },
  { id: 'doubao', name: '豆包 (Doubao)', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', api: 'openai-completions', placeholder: '...' },
  { id: 'minimax', name: 'MiniMax', baseUrl: 'https://api.minimaxi.com/v1', api: 'openai-completions', placeholder: '...' },
  { id: 'kimi', name: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.cn/v1', api: 'openai-completions', placeholder: 'sk-...' },
];

/** 后端返回的 Provider 信息 */
interface ProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
  hasApiKey: boolean;
  maskedApiKey?: string;
  api: string;
  models: ModelInfo[];
}

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  maxContextLength: number;
  maxOutputTokens: number;
  supportsVision: boolean;
  supportsToolUse: boolean;
  isDefault: boolean;
  dimension?: number;
}

interface Toast {
  message: string;
  type: 'success' | 'error';
}

/** API 协议友好名称 */
const API_LABELS: Record<string, string> = {
  'openai-completions': 'OpenAI 兼容',
  'anthropic': 'Anthropic',
  'anthropic-messages': 'Anthropic',
};

// ─── Provider 详情卡片 ───

function ProviderCard({
  provider,
  defaultLLM,
  defaultEMB,
  onSetDefaultLLM,
  onSetDefaultEMB,
  onRefresh,
  showToast,
  onDelete,
}: {
  provider: ProviderInfo;
  defaultLLM: { provider: string; modelId: string };
  defaultEMB: { provider: string; modelId: string };
  onSetDefaultLLM: (provider: string, modelId: string) => void;
  onSetDefaultEMB: (provider: string, modelId: string) => void;
  onRefresh: () => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  onDelete: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editApiKey, setEditApiKey] = useState('');
  const [editBaseUrl, setEditBaseUrl] = useState(provider.baseUrl);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [fullApiKey, setFullApiKey] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [modelSearch, setModelSearch] = useState('');
  const [addingModel, setAddingModel] = useState(false);
  const [newModelId, setNewModelId] = useState('');
  const [newModelName, setNewModelName] = useState('');
  const [newModelType, setNewModelType] = useState<'llm' | 'emb'>('llm');
  const [newModelDimension, setNewModelDimension] = useState('');

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const params: Record<string, string> = { api: provider.api };
      if (editApiKey.trim()) params.apiKey = editApiKey.trim();
      if (editBaseUrl.trim() && editBaseUrl !== provider.baseUrl) params.baseUrl = editBaseUrl.trim();
      // 传入该 Provider 的第一个 LLM 模型用于测试
      const firstLLM = provider.models.find((m) =>
        !m.dimension && !m.id.toLowerCase().includes('embedding') && !m.id.toLowerCase().includes('embo-')
      );
      if (firstLLM) params.model = firstLLM.id;
      const result = await post<{ success: boolean; error?: string; model?: string; count?: number }>(
        `/provider/${provider.id}/test`,
        params,
      );
      setTestResult(result);
      if (result.success) {
        const info = result.count ? `发现 ${result.count} 个模型` : result.model || '';
        showToast(`连接成功${info ? ` (${info})` : ''}`);
      }
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : '测试失败' });
    } finally {
      setTesting(false);
    }
  }, [editApiKey, editBaseUrl, provider, showToast]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      await put(`/provider/${provider.id}`, {
        name: provider.name,
        baseUrl: editBaseUrl.trim() || provider.baseUrl,
        apiKeyRef: editApiKey.trim() || undefined,
        models: provider.models,
      });
      await put(`/config/provider/${provider.id}`, {
        baseUrl: editBaseUrl.trim() || provider.baseUrl,
        apiKey: editApiKey.trim() || '___KEEP___',
        api: provider.api,
        models: provider.models.map((m) => ({ id: m.id, name: m.name })),
      });
      setEditing(false);
      setEditApiKey('');
      setTestResult(null);
      showToast('已保存');
      onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存失败', 'error');
    } finally {
      setSaving(false);
    }
  }, [editApiKey, editBaseUrl, provider, showToast, onRefresh]);

  const handleSyncModels = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await post<{ success: boolean; count?: number; error?: string }>(
        `/provider/${provider.id}/sync-models`,
        {},
      );
      if (result.success) {
        showToast(`已加载 ${result.count} 个预设模型`);
        onRefresh();
      } else {
        showToast(result.error || '加载失败', 'error');
      }
    } catch (err) {
      showToast(err instanceof Error ? err.message : '加载失败', 'error');
    } finally {
      setSyncing(false);
    }
  }, [provider.id, showToast, onRefresh]);

  const handleAddModel = useCallback(async () => {
    const id = newModelId.trim();
    if (!id) return;
    // 检查重复
    if (provider.models.some((m) => m.id === id)) {
      showToast('模型 ID 已存在', 'error');
      return;
    }
    const name = newModelName.trim() || id;
    const isEmb = newModelType === 'emb';
    const dim = isEmb && newModelDimension.trim() ? Number(newModelDimension.trim()) : undefined;
    // Embedding 模型必须有 dimension
    if (isEmb && !dim) {
      showToast('Embedding 模型必须填写向量维度', 'error');
      return;
    }
    const updatedModels = [
      ...provider.models,
      {
        id, name, provider: provider.id,
        maxContextLength: isEmb ? 8192 : 128000,
        maxOutputTokens: isEmb ? 0 : 8192,
        supportsVision: false,
        supportsToolUse: !isEmb,
        isDefault: false,
        ...(dim ? { dimension: dim } : {}),
      },
    ];
    try {
      await put(`/provider/${provider.id}`, {
        name: provider.name,
        baseUrl: provider.baseUrl,
        models: updatedModels,
      });
      await put(`/config/provider/${provider.id}`, {
        baseUrl: provider.baseUrl,
        apiKey: '___KEEP___',
        api: provider.api,
        models: updatedModels.map((m) => ({
          id: m.id, name: m.name,
          ...(m.dimension ? { dimension: m.dimension } : {}),
        })),
      });
      setNewModelId('');
      setNewModelName('');
      setNewModelType('llm');
      setNewModelDimension('');
      setAddingModel(false);
      showToast(`已添加模型 ${id}`);
      onRefresh();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '添加失败', 'error');
    }
  }, [newModelId, newModelName, newModelType, newModelDimension, provider, showToast, onRefresh]);

  /** 切换 API Key 明文显示 */
  const handleToggleApiKey = useCallback(async () => {
    if (showApiKey) {
      setShowApiKey(false);
      return;
    }
    // 首次点击时从后端获取完整 key
    if (!fullApiKey) {
      try {
        const res = await get<{ apiKey: string }>(`/provider/${provider.id}/apikey`);
        setFullApiKey(res.apiKey);
      } catch {
        showToast('获取 API Key 失败', 'error');
        return;
      }
    }
    setShowApiKey(true);
  }, [showApiKey, fullApiKey, provider.id, showToast]);

  /** API Key 显示内容 */
  const apiKeyDisplay = provider.hasApiKey
    ? (showApiKey && fullApiKey ? fullApiKey : '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022')
    : '未设置';

  return (
    <div className={`bg-white rounded-xl border transition-colors ${
      expanded ? 'border-brand/30 ring-1 ring-brand/10' : 'border-slate-200'
    }`}>
      {/* 头部 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3.5 flex items-center gap-3 text-left hover:bg-slate-50/50 transition-colors rounded-xl"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-slate-800">{provider.name}</h4>
            <code className="text-xs px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded font-mono">
              {provider.id}
            </code>
            {provider.hasApiKey ? (
              <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-600">
                已配置
              </span>
            ) : (
              <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-500">
                未配置
              </span>
            )}
            {provider.id === defaultLLM.provider && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-brand/10 text-brand-active">默认 LLM</span>
            )}
            {provider.id === defaultEMB.provider && (
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-600">默认 EMB</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-slate-400">
            <span>{provider.baseUrl}</span>
            <span className="text-slate-300">|</span>
            <span>{API_LABELS[provider.api] ?? provider.api}</span>
            <span className="text-slate-300">|</span>
            <span>{provider.models.length} 个模型</span>
          </div>
        </div>
        <span className={`text-slate-400 text-xs transition-transform shrink-0 ${expanded ? 'rotate-90' : ''}`}>
          ▶
        </span>
      </button>

      {/* 展开详情 */}
      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-100">
          {/* 配置信息 */}
          <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-2 text-xs">
            <div>
              <span className="text-slate-400">API Key</span>
              <div className="flex items-center gap-1.5 mt-0.5">
                <p className="font-mono text-slate-600">{apiKeyDisplay}</p>
                {provider.hasApiKey && (
                  <button
                    onClick={handleToggleApiKey}
                    className="text-slate-400 hover:text-slate-600 transition-colors"
                    title={showApiKey ? '隐藏' : '显示'}
                  >
                    {showApiKey ? (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.878 9.878L3 3m6.878 6.878L21 21" />
                      </svg>
                    ) : (
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                      </svg>
                    )}
                  </button>
                )}
              </div>
            </div>
            <div>
              <span className="text-slate-400">API 协议</span>
              <p className="text-slate-600 mt-0.5">{API_LABELS[provider.api] ?? provider.api}</p>
            </div>
            <div className="col-span-2">
              <span className="text-slate-400">Base URL</span>
              <p className="font-mono text-slate-600 mt-0.5 break-all">{provider.baseUrl}</p>
            </div>
          </div>

          {/* 编辑区域 */}
          {editing ? (
            <div className="mt-3 space-y-2 bg-slate-50 rounded-lg p-3">
              <div>
                <label className="block text-xs text-slate-500 mb-1">API Key（留空保持不变）</label>
                <input
                  type="password"
                  value={editApiKey}
                  onChange={(e) => { setEditApiKey(e.target.value); setTestResult(null); }}
                  placeholder={provider.hasApiKey ? '已配置，输入新值可覆盖' : '请输入 API Key'}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
                    bg-white text-slate-900
                    focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand
                    placeholder:text-slate-300"
                />
              </div>
              <div>
                <label className="block text-xs text-slate-500 mb-1">Base URL</label>
                <input
                  type="text"
                  value={editBaseUrl}
                  onChange={(e) => setEditBaseUrl(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
                    bg-white text-slate-900 font-mono
                    focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
                />
              </div>
              {testResult && (
                <div className={`text-xs px-3 py-1.5 rounded ${
                  testResult.success
                    ? 'bg-green-50 text-green-600'
                    : 'bg-red-50 text-red-500'
                }`}>
                  {testResult.success ? '连接成功' : `连接失败: ${testResult.error}`}
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setEditing(false); setEditApiKey(''); setEditBaseUrl(provider.baseUrl); setTestResult(null); }}
                  className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700"
                >
                  取消
                </button>
                <button
                  onClick={handleTest}
                  disabled={testing || (!editApiKey.trim() && !provider.hasApiKey)}
                  className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg
                    text-slate-600 hover:bg-slate-100
                    disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {testing ? '测试中...' : '测试连接'}
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || (!editApiKey.trim() && editBaseUrl === provider.baseUrl)}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-brand rounded-lg hover:bg-brand-hover
                    disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? '保存中...' : '保存'}
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-3 flex gap-2">
              <button
                onClick={() => { setEditing(true); setEditBaseUrl(provider.baseUrl); }}
                className="text-xs px-3 py-1.5 font-medium border border-slate-200 rounded-lg
                  text-slate-600 hover:bg-slate-50 transition-colors"
              >
                编辑配置
              </button>
              <button
                onClick={handleSyncModels}
                disabled={syncing || !provider.hasApiKey}
                className="text-xs px-3 py-1.5 font-medium border border-blue-200 rounded-lg
                  text-blue-500 hover:bg-blue-50
                  disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {syncing ? '加载中...' : '刷新预设'}
              </button>
              <button
                onClick={() => onDelete(provider.id)}
                className="text-xs px-3 py-1.5 font-medium border border-red-200 rounded-lg
                  text-red-500 hover:bg-red-50 transition-colors"
              >
                删除
              </button>
            </div>
          )}

          {/* 模型列表 */}
          <div className="mt-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-medium text-slate-500">模型列表</p>
              <div className="flex items-center gap-2">
                <p className="text-xs text-slate-400">{provider.models.length} 个</p>
                <button
                  onClick={() => setAddingModel(!addingModel)}
                  className="text-xs px-2 py-0.5 rounded border border-dashed border-slate-300
                    text-slate-500 hover:border-brand hover:text-brand-active transition-colors"
                >
                  {addingModel ? '取消' : '+ 添加'}
                </button>
              </div>
            </div>

            {/* 手动添加模型表单 */}
            {addingModel && (
              <div className="mb-3 p-3 rounded-lg border border-dashed border-brand/30 bg-brand/5 space-y-2">
                {/* 类型切换 */}
                <div className="flex gap-1">
                  {(['llm', 'emb'] as const).map((t) => (
                    <button
                      key={t}
                      onClick={() => setNewModelType(t)}
                      className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
                        newModelType === t
                          ? t === 'llm'
                            ? 'bg-blue-100 text-blue-600'
                            : 'bg-amber-100 text-amber-600'
                          : 'bg-slate-100 text-slate-400'
                      }`}
                    >
                      {t === 'llm' ? 'LLM 对话模型' : 'Embedding 向量模型'}
                    </button>
                  ))}
                </div>
                <input
                  value={newModelId}
                  onChange={(e) => setNewModelId(e.target.value)}
                  placeholder="模型 ID（必填，如 qwen-plus-latest）"
                  className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg
                    bg-white text-slate-900
                    focus:outline-none focus:ring-1 focus:ring-brand/40 focus:border-brand
                    placeholder:text-slate-300"
                />
                <input
                  value={newModelName}
                  onChange={(e) => setNewModelName(e.target.value)}
                  placeholder="显示名称（可选，默认同 ID）"
                  className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg
                    bg-white text-slate-900
                    focus:outline-none focus:ring-1 focus:ring-brand/40 focus:border-brand
                    placeholder:text-slate-300"
                />
                {newModelType === 'emb' && (
                  <input
                    value={newModelDimension}
                    onChange={(e) => setNewModelDimension(e.target.value.replace(/\D/g, ''))}
                    placeholder="向量维度（必填，如 1536/1024/768）"
                    className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg
                      bg-white text-slate-900
                      focus:outline-none focus:ring-1 focus:ring-brand/40 focus:border-brand
                      placeholder:text-slate-300"
                  />
                )}
                <button
                  onClick={handleAddModel}
                  disabled={!newModelId.trim() || (newModelType === 'emb' && !newModelDimension.trim())}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-brand text-white
                    hover:bg-brand-active disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  确认添加
                </button>
              </div>
            )}

            {provider.models.length === 0 && !addingModel ? (
              <p className="text-xs text-slate-400 italic">暂无模型，点击上方「+ 添加」手动录入</p>
            ) : (
              <>
                {/* 搜索框 */}
                {provider.models.length > 5 && (
                  <div className="mb-2">
                    <input
                      value={modelSearch}
                      onChange={(e) => setModelSearch(e.target.value)}
                      placeholder="搜索模型名称或 ID..."
                      className="w-full px-3 py-1.5 text-xs border border-slate-200 rounded-lg
                        bg-white text-slate-900
                        focus:outline-none focus:ring-1 focus:ring-brand/40 focus:border-brand
                        placeholder:text-slate-300"
                    />
                  </div>
                )}
                <div className="space-y-1.5 max-h-64 overflow-y-auto">
                  {provider.models
                    .filter((m) => {
                      if (!modelSearch.trim()) return true;
                      const q = modelSearch.toLowerCase();
                      return m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q);
                    })
                    .map((model) => {
                      const isEmbedding = !!model.dimension ||
                        model.id.toLowerCase().includes('embedding') ||
                        model.id.toLowerCase().includes('embo-');
                      const isDefaultLLMModel = !isEmbedding && provider.id === defaultLLM.provider && model.id === defaultLLM.modelId;
                      const isDefaultEMBModel = isEmbedding && provider.id === defaultEMB.provider && model.id === defaultEMB.modelId;
                      const hasDefaultBadge = isDefaultLLMModel || isDefaultEMBModel;
                      return (
                        <div
                          key={model.id}
                          className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
                            isDefaultLLMModel
                              ? 'bg-brand/5 border border-brand/20'
                              : isDefaultEMBModel
                                ? 'bg-amber-50/50 border border-amber-200/30'
                                : 'bg-slate-50'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${
                              isEmbedding
                                ? 'bg-amber-50 text-amber-600'
                                : 'bg-blue-50 text-blue-600'
                            }`}>
                              {isEmbedding ? 'EMB' : 'LLM'}
                            </span>
                            <span className="font-medium text-slate-700 truncate">{model.name}</span>
                            <code className="text-xs text-slate-400 font-mono truncate">{model.id}</code>
                            {model.dimension && (
                              <span className="text-xs text-slate-400 shrink-0">{model.dimension}d</span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {hasDefaultBadge ? (
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                isDefaultLLMModel
                                  ? 'bg-brand/10 text-brand-active'
                                  : 'bg-amber-100 text-amber-600'
                              }`}>
                                {isDefaultLLMModel ? '默认 LLM' : '默认 EMB'}
                              </span>
                            ) : (
                              <button
                                onClick={() => isEmbedding
                                  ? onSetDefaultEMB(provider.id, model.id)
                                  : onSetDefaultLLM(provider.id, model.id)
                                }
                                className="text-xs px-2 py-0.5 rounded-full border border-slate-200
                                  text-slate-400 hover:border-brand hover:text-brand-active transition-colors"
                              >
                                {isEmbedding ? '设为默认 EMB' : '设为默认 LLM'}
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── 新增 Provider 表单 ───

function AddProviderForm({
  existingIds,
  onSaved,
  showToast,
  onCancel,
}: {
  existingIds: string[];
  onSaved: () => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  onCancel: () => void;
}) {
  const [mode, setMode] = useState<'preset' | 'custom'>('preset');
  const availablePresets = PROVIDER_PRESETS.filter((p) => !existingIds.includes(p.id));
  const [selectedPreset, setSelectedPreset] = useState(availablePresets[0] ?? null);

  const [customId, setCustomId] = useState('');
  const [customName, setCustomName] = useState('');
  const [baseUrl, setBaseUrl] = useState(selectedPreset?.baseUrl ?? '');
  const [api, setApi] = useState(selectedPreset?.api ?? 'openai-completions');
  const [apiKey, setApiKey] = useState('');
  const [modelId, setModelId] = useState('');
  const [modelName, setModelName] = useState('');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // 切换预设时同步字段
  const selectPreset = (p: ProviderPreset) => {
    setSelectedPreset(p);
    setBaseUrl(p.baseUrl);
    setApi(p.api);
    setModelId('');
    setModelName('');
    setTestResult(null);
  };

  const effectiveId = mode === 'preset' ? selectedPreset?.id ?? '' : customId.trim();
  const effectiveName = mode === 'preset' ? selectedPreset?.name ?? '' : customName.trim();
  const effectiveBaseUrl = baseUrl.trim();

  const handleTest = useCallback(async () => {
    if (!apiKey.trim() || !effectiveId) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await post<{ success: boolean; error?: string; model?: string }>(
        `/provider/${effectiveId}/test`,
        { apiKey: apiKey.trim(), baseUrl: effectiveBaseUrl, api },
      );
      setTestResult(result);
      if (result.success) showToast(`连接成功${result.model ? ` (${result.model})` : ''}`);
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : '测试失败' });
    } finally {
      setTesting(false);
    }
  }, [apiKey, effectiveId, effectiveBaseUrl, api, showToast]);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) { showToast('请输入 API Key', 'error'); return; }
    if (!effectiveId) { showToast('请选择或输入 Provider ID', 'error'); return; }

    setSaving(true);
    try {
      const models = modelId.trim()
        ? [{ id: modelId.trim(), name: modelName.trim() || modelId.trim() }]
        : [];

      // 写入 evo_claw.json
      await put(`/config/provider/${effectiveId}`, {
        baseUrl: effectiveBaseUrl,
        apiKey: apiKey.trim(),
        api,
        models,
      });

      // 注册到内存
      await put(`/provider/${effectiveId}`, {
        name: effectiveName || effectiveId,
        baseUrl: effectiveBaseUrl,
        apiKeyRef: apiKey.trim(),
        models: models.map((m) => ({
          ...m,
          provider: effectiveId,
          maxContextLength: 128000,
          maxOutputTokens: 4096,
          supportsVision: false,
          supportsToolUse: true,
          isDefault: false,
        })),
      });

      showToast(`${effectiveName || effectiveId} 已添加`);
      onSaved();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '添加失败', 'error');
    } finally {
      setSaving(false);
    }
  }, [apiKey, effectiveId, effectiveName, effectiveBaseUrl, api, modelId, modelName, showToast, onSaved]);

  return (
    <div className="bg-white rounded-xl border border-brand/30 ring-1 ring-brand/10 p-4">
      <h4 className="text-sm font-semibold text-slate-800 mb-3">添加 Provider</h4>

      {/* 模式切换 */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setMode('preset')}
          className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
            mode === 'preset'
              ? 'border-brand bg-brand/10 text-brand-active font-medium'
              : 'border-slate-200 text-slate-500'
          }`}
        >
          从预设选择
        </button>
        <button
          onClick={() => setMode('custom')}
          className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
            mode === 'custom'
              ? 'border-brand bg-brand/10 text-brand-active font-medium'
              : 'border-slate-200 text-slate-500'
          }`}
        >
          自定义
        </button>
      </div>

      {/* 预设选择 */}
      {mode === 'preset' && (
        availablePresets.length === 0 ? (
          <p className="text-xs text-slate-400 mb-4">所有预设 Provider 都已添加，请使用「自定义」模式。</p>
        ) : (
          <div className="flex flex-wrap gap-2 mb-4">
            {availablePresets.map((p) => (
              <button
                key={p.id}
                onClick={() => selectPreset(p)}
                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                  selectedPreset?.id === p.id
                    ? 'border-brand bg-brand/10 text-brand-active font-medium'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                }`}
              >
                {p.name}
              </button>
            ))}
          </div>
        )
      )}

      {/* 自定义字段 */}
      {mode === 'custom' && (
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Provider ID</label>
            <input
              value={customId}
              onChange={(e) => setCustomId(e.target.value)}
              placeholder="如: my-provider"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
                bg-white text-slate-900 font-mono
                focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand
                placeholder:text-slate-300"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">显示名称</label>
            <input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="如: My Provider"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
                bg-white text-slate-900
                focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand
                placeholder:text-slate-300"
            />
          </div>
        </div>
      )}

      {/* 公共字段 */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs text-slate-500 mb-1">API Key</label>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => { setApiKey(e.target.value); setTestResult(null); }}
            placeholder={mode === 'preset' ? selectedPreset?.placeholder ?? '...' : 'API Key'}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
              bg-white text-slate-900
              focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand
              placeholder:text-slate-300"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">Base URL</label>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.example.com/v1"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
                bg-white text-slate-900 font-mono
                focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand
                placeholder:text-slate-300"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">API 协议</label>
            <Select
              value={api}
              onChange={(val) => setApi(val)}
              options={[
                { value: 'openai-completions', label: 'OpenAI 兼容' },
                { value: 'anthropic', label: 'Anthropic' },
              ]}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-slate-500 mb-1">模型 ID（可选）</label>
            <input
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              placeholder="如: gpt-4o-mini"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
                bg-white text-slate-900 font-mono
                focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand
                placeholder:text-slate-300"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-500 mb-1">模型名称（可选）</label>
            <input
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="如: GPT-4o Mini"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
                bg-white text-slate-900
                focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand
                placeholder:text-slate-300"
            />
          </div>
        </div>
      </div>

      {testResult && (
        <div className={`mt-3 text-xs px-3 py-1.5 rounded ${
          testResult.success
            ? 'bg-green-50 text-green-600'
            : 'bg-red-50 text-red-500'
        }`}>
          {testResult.success ? '连接成功' : `连接失败: ${testResult.error}`}
        </div>
      )}

      {/* 操作按钮 */}
      <div className="flex gap-2 mt-4">
        <button
          onClick={onCancel}
          className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700"
        >
          取消
        </button>
        <button
          onClick={handleTest}
          disabled={testing || !apiKey.trim() || !effectiveId}
          className="px-3 py-1.5 text-xs font-medium border border-slate-200 rounded-lg
            text-slate-600 hover:bg-slate-50
            disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {testing ? '测试中...' : '测试连接'}
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !apiKey.trim() || !effectiveId || !effectiveBaseUrl}
          className="px-4 py-1.5 text-xs font-medium text-white bg-brand rounded-lg hover:bg-brand-hover
            disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving ? '保存中...' : '添加'}
        </button>
      </div>
    </div>
  );
}

// ─── 主页面 ───

export default function ModelsPage() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [defaultLLM, setDefaultLLM] = useState({ provider: '', modelId: '' });
  const [defaultEMB, setDefaultEMB] = useState({ provider: '', modelId: '' });
  const [toast, setToast] = useState<Toast | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  }, []);

  const fetchProviders = useCallback(async () => {
    try {
      const [providerRes, llmRes, embRes] = await Promise.all([
        get<{ providers: ProviderInfo[] }>('/provider'),
        get<{ provider: string; modelId: string }>('/provider/default/model'),
        get<{ provider: string; modelId: string }>('/provider/default/embedding'),
      ]);
      setProviders(providerRes.providers);
      setDefaultLLM(llmRes);
      setDefaultEMB(embRes);
    } catch {
      // Provider API 可能尚未注册
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const handleSetDefaultLLM = useCallback(async (provider: string, modelId: string) => {
    try {
      await put('/provider/default/model', { provider, modelId });
      setDefaultLLM({ provider, modelId });
      showToast(`默认 LLM 已设为 ${provider}/${modelId}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '设置失败', 'error');
    }
  }, [showToast]);

  const handleSetDefaultEMB = useCallback(async (provider: string, modelId: string) => {
    try {
      await put('/provider/default/embedding', { provider, modelId });
      setDefaultEMB({ provider, modelId });
      showToast(`默认 Embedding 已设为 ${provider}/${modelId}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '设置失败', 'error');
    }
  }, [showToast]);

  const handleDelete = useCallback(async (id: string) => {
    try {
      await del(`/provider/${id}`);
      await del(`/config/provider/${id}`);
      showToast(`${id} 已删除`);
      setConfirmDelete(null);
      fetchProviders();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '删除失败', 'error');
    }
  }, [showToast, fetchProviders]);

  return (
    <div className="h-full flex flex-col">
      {/* 头部 */}
      <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-900">模型管理</h2>
          <p className="text-sm text-slate-400 mt-0.5">管理 LLM Provider、API Key 和默认模型</p>
        </div>
        {!showAddForm && (
          <button
            onClick={() => setShowAddForm(true)}
            className="px-4 py-2 text-sm font-medium text-white bg-brand rounded-lg hover:bg-brand-hover transition-colors"
          >
            + 添加 Provider
          </button>
        )}
      </div>

      {/* 内容 */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-4">
          {/* 默认模型信息 */}
          {(defaultLLM.provider || defaultEMB.provider) && (
            <div className="bg-slate-50 rounded-lg px-4 py-3 flex gap-6">
              {defaultLLM.provider && (
                <div>
                  <p className="text-xs text-slate-400">默认 LLM</p>
                  <p className="text-sm font-medium text-slate-700 mt-0.5 font-mono">
                    {defaultLLM.provider}/{defaultLLM.modelId}
                  </p>
                </div>
              )}
              {defaultEMB.provider && (
                <div>
                  <p className="text-xs text-amber-500">默认 Embedding</p>
                  <p className="text-sm font-medium text-slate-700 mt-0.5 font-mono">
                    {defaultEMB.provider}/{defaultEMB.modelId}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* 新增表单 */}
          {showAddForm && (
            <AddProviderForm
              existingIds={providers.map((p) => p.id)}
              onSaved={() => { setShowAddForm(false); fetchProviders(); }}
              showToast={showToast}
              onCancel={() => setShowAddForm(false)}
            />
          )}

          {/* Provider 列表 */}
          {loading ? (
            <div className="text-center text-slate-400 mt-16">
              <p className="text-sm">加载中...</p>
            </div>
          ) : providers.length === 0 && !showAddForm ? (
            <div className="text-center text-slate-400 mt-16">
              <p className="text-lg mb-2">暂无已配置的 Provider</p>
              <p className="text-sm mb-4">点击右上角「添加 Provider」开始配置</p>
            </div>
          ) : (
            providers.map((provider) => (
              <div key={provider.id}>
                <ProviderCard
                  provider={provider}
                  defaultLLM={defaultLLM}
                  defaultEMB={defaultEMB}
                  onSetDefaultLLM={handleSetDefaultLLM}
                  onSetDefaultEMB={handleSetDefaultEMB}
                  onRefresh={fetchProviders}
                  showToast={showToast}
                  onDelete={(id) => setConfirmDelete(id)}
                />
                {/* 删除确认 */}
                {confirmDelete === provider.id && (
                  <div className="mt-2 bg-red-50 border border-red-200 rounded-lg p-3 flex items-center justify-between">
                    <p className="text-xs text-red-600">
                      确定删除 {provider.name}？此操作不可恢复。
                    </p>
                    <div className="flex gap-2 shrink-0">
                      <button
                        onClick={() => setConfirmDelete(null)}
                        className="text-xs px-3 py-1 text-slate-500 hover:text-slate-700"
                      >
                        取消
                      </button>
                      <button
                        onClick={() => handleDelete(provider.id)}
                        className="text-xs px-3 py-1 font-medium text-white bg-red-500 rounded-lg hover:bg-red-600 transition-colors"
                      >
                        确认删除
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}

          <p className="mt-4 text-xs text-slate-400 leading-relaxed">
            点击 Provider 卡片展开查看详情和模型列表。API Key 保存在本地配置文件中。
          </p>
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg ${
          toast.type === 'success' ? 'bg-brand text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
