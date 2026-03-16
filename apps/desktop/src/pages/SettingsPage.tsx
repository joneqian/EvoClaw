import { useState, useEffect, useCallback } from 'react';
import { get, put, post } from '../lib/api';
import { useAppStore } from '../stores/app-store';

/** Provider 展示信息 */
interface ProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
  hasApiKey: boolean;
  models: ModelInfo[];
}

/** 模型信息 */
interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  maxContextLength: number;
  maxOutputTokens: number;
  supportsVision: boolean;
  supportsToolUse: boolean;
  isDefault: boolean;
}

/** 前端已知的 Provider 静态信息 */
const PROVIDER_META: Record<string, { placeholder: string; order: number }> = {
  openai: { placeholder: 'sk-...', order: 0 },
  anthropic: { placeholder: 'sk-ant-...', order: 1 },
  deepseek: { placeholder: 'sk-...', order: 2 },
  qwen: { placeholder: 'sk-...', order: 3 },
  glm: { placeholder: '...', order: 4 },
  doubao: { placeholder: '...', order: 5 },
  minimax: { placeholder: '...', order: 6 },
  kimi: { placeholder: 'sk-...', order: 7 },
};

/** Toast 通知状态 */
interface Toast {
  message: string;
  type: 'success' | 'error';
}

/** 格式化数字 */
function formatTokens(n: number): string {
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

/** Provider 卡片 */
function ProviderCard({
  provider,
  onSaved,
  showToast,
  isDefaultProvider,
  defaultModelId,
  onSetDefault,
}: {
  provider: ProviderInfo;
  onSaved: () => void;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  isDefaultProvider: boolean;
  defaultModelId: string;
  onSetDefault: (provider: string, modelId: string) => void;
}) {
  const [apiKey, setApiKey] = useState('');
  const [dirty, setDirty] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const meta = PROVIDER_META[provider.id] ?? { placeholder: '...', order: 99 };

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) {
      showToast('请输入 API Key', 'error');
      return;
    }
    try {
      await put(`/provider/${provider.id}`, {
        name: provider.name,
        baseUrl: provider.baseUrl,
        apiKeyRef: apiKey.trim(),
        models: provider.models,
      });
      setDirty(false);
      setTestResult(null);
      showToast('已保存');
      onSaved();
    } catch (err) {
      showToast(err instanceof Error ? err.message : '保存失败', 'error');
    }
  }, [apiKey, provider, showToast, onSaved]);

  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const key = apiKey.trim() || undefined;
      const result = await post<{ success: boolean; error?: string; model?: string }>(
        `/provider/${provider.id}/test`,
        key ? { apiKey: key } : {},
      );
      setTestResult(result);
      if (result.success) {
        showToast(`连接成功${result.model ? ` (${result.model})` : ''}`, 'success');
      }
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : '测试失败' });
    } finally {
      setTesting(false);
    }
  }, [apiKey, provider.id, showToast]);

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium text-gray-800 dark:text-gray-200">{provider.name}</h4>
          {provider.hasApiKey ? (
            <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400">
              已配置
            </span>
          ) : (
            <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500">
              未配置
            </span>
          )}
          {isDefaultProvider && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-[#00d4aa]/10 text-[#00a88a]">
              默认
            </span>
          )}
        </div>
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
        >
          {expanded ? '收起' : `${provider.models.length} 个模型`}
        </button>
      </div>

      <div className="flex gap-2">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => { setApiKey(e.target.value); setDirty(true); setTestResult(null); }}
          placeholder={provider.hasApiKey ? '已配置（输入新值可覆盖）' : meta.placeholder}
          className="flex-1 px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg
            bg-white dark:bg-gray-700 text-gray-900 dark:text-white
            focus:outline-none focus:ring-2 focus:ring-[#00d4aa]/40 focus:border-[#00d4aa]
            placeholder:text-gray-300 dark:placeholder:text-gray-500"
        />
        <button
          onClick={handleTest}
          disabled={testing || (!apiKey.trim() && !provider.hasApiKey)}
          className="shrink-0 px-3 py-2 text-sm font-medium rounded-lg transition-colors
            border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300
            hover:bg-gray-50 dark:hover:bg-gray-700
            disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {testing ? '测试中...' : '测试'}
        </button>
        <button
          onClick={handleSave}
          disabled={!apiKey.trim()}
          className="shrink-0 px-4 py-2 text-sm font-medium rounded-lg transition-colors
            bg-[#00d4aa] text-white hover:bg-[#00b894]
            disabled:opacity-40 disabled:cursor-not-allowed"
        >
          保存
        </button>
      </div>

      {testResult && (
        <div className={`mt-2 text-xs px-3 py-1.5 rounded ${
          testResult.success
            ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
            : 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400'
        }`}>
          {testResult.success ? '连接成功' : `连接失败: ${testResult.error}`}
        </div>
      )}

      {expanded && provider.models.length > 0 && (
        <div className="mt-3 border-t border-gray-100 dark:border-gray-700 pt-3">
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">模型列表</p>
          <div className="space-y-1.5">
            {provider.models.map((model) => {
              const isThisDefault = isDefaultProvider && model.id === defaultModelId;
              return (
                <div
                  key={model.id}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg text-sm ${
                    isThisDefault
                      ? 'bg-[#00d4aa]/5 border border-[#00d4aa]/20'
                      : 'bg-gray-50 dark:bg-gray-700'
                  }`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium text-gray-700 dark:text-gray-300 truncate">{model.name}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 font-mono">{model.id}</span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {model.supportsVision && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-900/20 text-purple-500 dark:text-purple-400">Vision</span>
                    )}
                    {model.supportsToolUse && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/20 text-blue-500 dark:text-blue-400">Tool</span>
                    )}
                    <span className="text-xs text-gray-400 dark:text-gray-500">{formatTokens(model.maxContextLength)}</span>
                    {isThisDefault ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-[#00d4aa]/10 text-[#00a88a] font-medium">
                        默认
                      </span>
                    ) : (
                      <button
                        onClick={() => onSetDefault(provider.id, model.id)}
                        className="text-xs px-2 py-0.5 rounded-full border border-gray-200 dark:border-gray-600 text-gray-400 dark:text-gray-500
                          hover:border-[#00d4aa] hover:text-[#00a88a] transition-colors"
                      >
                        设为默认
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [defaultProvider, setDefaultProvider] = useState('openai');
  const [defaultModelId, setDefaultModelId] = useState('gpt-4o-mini');
  const [toast, setToast] = useState<Toast | null>(null);
  const { theme, toggleTheme } = useAppStore();

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  }, []);

  const fetchProviders = useCallback(async () => {
    try {
      const [providerRes, defaultRes] = await Promise.all([
        get<{ providers: ProviderInfo[] }>('/provider'),
        get<{ provider: string; modelId: string }>('/provider/default/model'),
      ]);
      const sorted = providerRes.providers.sort((a, b) => {
        const oa = PROVIDER_META[a.id]?.order ?? 99;
        const ob = PROVIDER_META[b.id]?.order ?? 99;
        return oa - ob;
      });
      setProviders(sorted);
      setDefaultProvider(defaultRes.provider);
      setDefaultModelId(defaultRes.modelId);
    } catch {
      // Provider API 可能尚未注册
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProviders();
  }, [fetchProviders]);

  const handleSetDefault = useCallback(async (provider: string, modelId: string) => {
    try {
      await put('/provider/default/model', { provider, modelId });
      setDefaultProvider(provider);
      setDefaultModelId(modelId);
      showToast(`默认模型已设为 ${modelId}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : '设置失败', 'error');
    }
  }, [showToast]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
        <h2 className="text-lg font-bold text-gray-900 dark:text-white">设置</h2>
        <p className="text-sm text-gray-400 dark:text-gray-500 mt-1">管理 LLM Provider 配置、API Key 和默认模型</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto">
          {/* 外观设置 */}
          <div className="mb-6 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">外观</h3>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600 dark:text-gray-400">主题模式</p>
                <p className="text-xs text-gray-400 dark:text-gray-500">当前: {theme === 'dark' ? '深色' : '浅色'}</p>
              </div>
              <button
                onClick={toggleTheme}
                className="px-3 py-1.5 text-sm border border-gray-200 dark:border-gray-600 rounded-lg
                  text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                {theme === 'dark' ? '☀️ 切换浅色' : '🌙 切换深色'}
              </button>
            </div>
          </div>

          {loading ? (
            <div className="text-center text-gray-400 dark:text-gray-500 mt-20">
              <p className="text-sm">加载中...</p>
            </div>
          ) : providers.length === 0 ? (
            <div className="text-center text-gray-400 dark:text-gray-500 mt-20">
              <p className="text-lg">暂无已注册 Provider</p>
              <p className="text-sm mt-1">Sidecar 启动后会自动注册可用的 Provider</p>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg px-4 py-3 flex items-center justify-between">
                <div>
                  <p className="text-xs text-gray-400 dark:text-gray-500">当前默认模型</p>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mt-0.5">
                    {defaultProvider} / {defaultModelId}
                  </p>
                </div>
                <span className="text-xs text-gray-400 dark:text-gray-500">展开 Provider 可切换</span>
              </div>

              {providers.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  provider={provider}
                  onSaved={fetchProviders}
                  showToast={showToast}
                  isDefaultProvider={provider.id === defaultProvider}
                  defaultModelId={defaultModelId}
                  onSetDefault={handleSetDefault}
                />
              ))}
            </div>
          )}

          <p className="mt-6 text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
            API Key 将通过 macOS Keychain 安全存储，不会明文保存在磁盘上。
            点击「测试」可验证 API Key 是否有效。
          </p>
        </div>
      </div>

      {toast && (
        <div
          className={`fixed bottom-6 right-6 px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg transition-all ${
            toast.type === 'success'
              ? 'bg-[#00d4aa] text-white'
              : 'bg-red-500 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
