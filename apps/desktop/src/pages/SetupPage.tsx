import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { put, post, healthCheck } from '../lib/api';
import { useAppStore } from '../stores/app-store';

/** Provider 预设 */
interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  placeholder: string;
  defaultModel: { id: string; name: string };
  /** 如果该 Provider 支持 embedding，填此字段 */
  embedding?: { id: string; name: string; dimension: number };
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1',
    api: 'openai-completions', placeholder: 'sk-...',
    defaultModel: { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
    embedding: { id: 'text-embedding-3-small', name: 'Text Embedding 3 Small', dimension: 1536 },
  },
  {
    id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1',
    api: 'anthropic', placeholder: 'sk-ant-...',
    defaultModel: { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' },
    // Anthropic 不提供 embedding API
  },
  {
    id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1',
    api: 'openai-completions', placeholder: 'sk-...',
    defaultModel: { id: 'deepseek-chat', name: 'DeepSeek Chat' },
    // DeepSeek 不提供 embedding API
  },
  {
    id: 'qwen', name: '通义千问 (Qwen)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    api: 'openai-completions', placeholder: 'sk-...',
    defaultModel: { id: 'qwen-turbo', name: 'Qwen Turbo' },
    embedding: { id: 'text-embedding-v3', name: 'Text Embedding v3', dimension: 1024 },
  },
  {
    id: 'glm', name: '智谱 (GLM)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    api: 'openai-completions', placeholder: '...',
    defaultModel: { id: 'glm-4-flash', name: 'GLM-4 Flash' },
    embedding: { id: 'embedding-3', name: 'Embedding-3', dimension: 2048 },
  },
  {
    id: 'doubao', name: '豆包 (Doubao)', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    api: 'openai-completions', placeholder: '...',
    defaultModel: { id: 'doubao-pro-4k', name: 'Doubao Pro' },
  },
];

/** 仅包含支持 embedding 的 Provider */
const EMBEDDING_PROVIDERS = PROVIDER_PRESETS.filter(p => p.embedding);

type Step = 'welcome' | 'provider' | 'embedding' | 'done';

export default function SetupPage() {
  const navigate = useNavigate();
  const { setInitState, setSidecarConnected } = useAppStore();

  const [step, setStep] = useState<Step>('welcome');

  // --- LLM Provider 状态 ---
  const [selectedProvider, setSelectedProvider] = useState(PROVIDER_PRESETS[0]);
  const [apiKey, setApiKey] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  // --- Embedding 状态 ---
  // 如果 LLM Provider 自带 embedding，embeddingSource 为 'same'；否则需要选另一个 Provider
  const llmHasEmbedding = !!selectedProvider.embedding;
  const [embeddingSource, setEmbeddingSource] = useState<'same' | 'other'>('same');
  const [embeddingProvider, setEmbeddingProvider] = useState(EMBEDDING_PROVIDERS[0]);
  const [embeddingApiKey, setEmbeddingApiKey] = useState('');
  const [embeddingCustomBaseUrl, setEmbeddingCustomBaseUrl] = useState('');
  const [embeddingSaving, setEmbeddingSaving] = useState(false);
  const [embeddingError, setEmbeddingError] = useState('');
  const [embeddingTesting, setEmbeddingTesting] = useState(false);
  const [embeddingTestResult, setEmbeddingTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  // 进入 embedding 步骤时自动决定模式
  const goToEmbeddingStep = useCallback(() => {
    if (llmHasEmbedding) {
      setEmbeddingSource('same');
    } else {
      setEmbeddingSource('other');
      // 默认选第一个支持 embedding 的 Provider（排除当前 LLM Provider）
      const available = EMBEDDING_PROVIDERS.filter(p => p.id !== selectedProvider.id);
      if (available.length > 0) {
        setEmbeddingProvider(available[0]);
      }
    }
    setEmbeddingError('');
    setStep('embedding');
  }, [llmHasEmbedding, selectedProvider]);

  // 可用的 embedding Provider 列表（排除当前选的 LLM Provider，除非它自己支持 embedding）
  const availableEmbeddingProviders = useMemo(() => {
    if (embeddingSource === 'same') return [];
    return EMBEDDING_PROVIDERS.filter(p => p.id !== selectedProvider.id || llmHasEmbedding);
  }, [embeddingSource, selectedProvider, llmHasEmbedding]);

  /** 测试连接 */
  const handleTest = useCallback(async () => {
    if (!apiKey.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await post<{ success: boolean; error?: string; model?: string }>(
        `/provider/${selectedProvider.id}/test`,
        {
          apiKey: apiKey.trim(),
          baseUrl: customBaseUrl.trim() || selectedProvider.baseUrl,
          model: selectedProvider.defaultModel.id,
          api: selectedProvider.api,
        },
      );
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : '测试失败' });
    } finally {
      setTesting(false);
    }
  }, [apiKey, customBaseUrl, selectedProvider]);

  /** 测试 Embedding 连接 */
  const handleEmbeddingTest = useCallback(async () => {
    setEmbeddingTesting(true);
    setEmbeddingTestResult(null);
    try {
      let testApiKey: string;
      let testBaseUrl: string;
      let testModel: string;

      if (embeddingSource === 'same' && selectedProvider.embedding) {
        testApiKey = apiKey.trim();
        testBaseUrl = customBaseUrl.trim() || selectedProvider.baseUrl;
        testModel = selectedProvider.embedding.id;
      } else {
        testApiKey = embeddingApiKey.trim();
        testBaseUrl = embeddingCustomBaseUrl.trim() || embeddingProvider.baseUrl;
        testModel = embeddingProvider.embedding?.id ?? '';
      }

      if (!testApiKey) {
        setEmbeddingTestResult({ success: false, error: '未输入 API Key' });
        return;
      }

      // 调用 OpenAI 兼容的 embeddings 端点测试
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);

      const res = await fetch(`${testBaseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${testApiKey}`,
        },
        body: JSON.stringify({
          model: testModel,
          input: 'test',
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json();
        const dim = data?.data?.[0]?.embedding?.length;
        setEmbeddingTestResult({ success: true, error: dim ? `维度: ${dim}` : undefined });
      } else {
        const errBody = await res.text().catch(() => '');
        setEmbeddingTestResult({ success: false, error: `HTTP ${res.status}: ${errBody.slice(0, 200)}` });
      }
    } catch (err) {
      setEmbeddingTestResult({ success: false, error: err instanceof Error ? err.message : '测试失败' });
    } finally {
      setEmbeddingTesting(false);
    }
  }, [embeddingSource, selectedProvider, apiKey, customBaseUrl, embeddingApiKey, embeddingCustomBaseUrl, embeddingProvider]);

  /** 保存 LLM 配置，然后进入 embedding 步骤 */
  const handleSaveLLM = useCallback(async () => {
    if (!apiKey.trim()) {
      setError('请输入 API Key');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const baseUrl = customBaseUrl.trim() || selectedProvider.baseUrl;
      const providerId = selectedProvider.id;
      const model = selectedProvider.defaultModel;

      const config: Record<string, unknown> = {
        models: {
          default: `${providerId}/${model.id}`,
          providers: {
            [providerId]: {
              baseUrl,
              apiKey: apiKey.trim(),
              api: selectedProvider.api,
              models: [{ id: model.id, name: model.name }],
            },
          },
        },
      };

      await put('/config', config);

      // 同步该 Provider 下所有可用模型到 evo_claw.json
      try {
        await post(`/provider/${providerId}/sync-models`, {
          apiKey: apiKey.trim(),
          baseUrl,
        });
      } catch {
        // 同步模型失败不阻塞流程（部分 Provider 不支持 /models 接口）
      }

      // 验证配置生效
      const health = await healthCheck();
      if (health?.status === 'ok' || health?.status === 'needs-setup') {
        goToEmbeddingStep();
      } else {
        setError(`配置保存失败: ${health?.missing?.join(', ') ?? '未知错误'}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [apiKey, customBaseUrl, selectedProvider, goToEmbeddingStep]);

  /** 保存 embedding 配置 */
  const handleSaveEmbedding = useCallback(async () => {
    setEmbeddingSaving(true);
    setEmbeddingError('');
    try {
      // 获取当前配置
      const baseUrl = customBaseUrl.trim() || selectedProvider.baseUrl;
      const providerId = selectedProvider.id;
      const model = selectedProvider.defaultModel;

      // 构建完整配置
      const providers: Record<string, unknown> = {
        [providerId]: {
          baseUrl,
          apiKey: apiKey.trim(),
          api: selectedProvider.api,
          models: [{ id: model.id, name: model.name }],
        },
      };

      let embeddingRef: string;

      if (embeddingSource === 'same' && selectedProvider.embedding) {
        // 同 Provider 的 embedding：在已有 provider 的 models 里追加 embedding model
        const emb = selectedProvider.embedding;
        providers[providerId] = {
          baseUrl,
          apiKey: apiKey.trim(),
          api: selectedProvider.api,
          models: [
            { id: model.id, name: model.name },
            { id: emb.id, name: emb.name, dimension: emb.dimension },
          ],
        };
        embeddingRef = `${providerId}/${emb.id}`;
      } else {
        // 不同 Provider 的 embedding
        const ep = embeddingProvider;
        if (!ep.embedding) {
          setEmbeddingError('所选 Provider 不支持 Embedding');
          return;
        }
        const epApiKey = embeddingApiKey.trim();
        if (!epApiKey) {
          setEmbeddingError('请输入 Embedding Provider 的 API Key');
          return;
        }
        const epBaseUrl = embeddingCustomBaseUrl.trim() || ep.baseUrl;
        providers[ep.id] = {
          baseUrl: epBaseUrl,
          apiKey: epApiKey,
          api: ep.api,
          models: [{ id: ep.embedding.id, name: ep.embedding.name, dimension: ep.embedding.dimension }],
        };
        embeddingRef = `${ep.id}/${ep.embedding.id}`;
      }

      await put('/config', {
        models: {
          default: `${providerId}/${model.id}`,
          embedding: embeddingRef,
          providers,
        },
      });

      const health = await healthCheck();
      if (health?.status === 'ok') {
        setSidecarConnected(true);
        setInitState('connected');
        setStep('done');
      } else {
        setEmbeddingError(`配置保存但验证未通过: ${health?.missing?.join(', ') ?? '未知错误'}`);
      }
    } catch (err) {
      setEmbeddingError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setEmbeddingSaving(false);
    }
  }, [embeddingSource, selectedProvider, apiKey, customBaseUrl, embeddingProvider, embeddingApiKey, embeddingCustomBaseUrl, setSidecarConnected, setInitState]);

  // --- 跳过 embedding 确认 ---
  const [showSkipConfirm, setShowSkipConfirm] = useState(false);

  /** 跳过 embedding，直接完成 */
  const handleSkipEmbedding = useCallback(async () => {
    const health = await healthCheck();
    if (health?.status === 'ok') {
      setSidecarConnected(true);
      setInitState('connected');
    }
    setStep('done');
  }, [setSidecarConnected, setInitState]);

  /** 进入主界面 */
  const goToMain = useCallback(() => {
    navigate('/chat');
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="w-full max-w-lg mx-4">
        {/* 步骤指示器 */}
        {step !== 'welcome' && step !== 'done' && (
          <div className="flex items-center justify-center gap-2 mb-6">
            {(['provider', 'embedding'] as const).map((s, i) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
                  step === s
                    ? 'bg-[#00d4aa] text-white'
                    : i < (['provider', 'embedding'] as const).indexOf(step)
                      ? 'bg-[#00d4aa]/20 text-[#00a88a]'
                      : 'bg-gray-200 dark:bg-gray-600 text-gray-400'
                }`}>
                  {i + 1}
                </div>
                {i < 1 && <div className="w-12 h-px bg-gray-200 dark:bg-gray-600" />}
              </div>
            ))}
          </div>
        )}

        {/* 步骤 1: 欢迎 */}
        {step === 'welcome' && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8 text-center">
            <div className="text-6xl mb-4">🐾</div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              欢迎使用 EvoClaw
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mb-6 leading-relaxed">
              自进化 AI 伴侣桌面应用。创建具有独立人格、记忆和权限的 AI Agent，
              与你协同工作和成长。
            </p>
            <p className="text-sm text-gray-400 dark:text-gray-500 mb-8">
              首先，让我们配置 LLM Provider 来让你的 Agent 拥有思考和记忆能力。
            </p>
            <button
              onClick={() => setStep('provider')}
              className="px-6 py-3 bg-[#00d4aa] text-white font-medium rounded-xl
                hover:bg-[#00b894] transition-colors"
            >
              开始配置
            </button>
          </div>
        )}

        {/* 步骤 2: LLM Provider 配置 */}
        {step === 'provider' && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
              配置对话模型
            </h2>
            <p className="text-sm text-gray-400 dark:text-gray-500 mb-6">
              选择一个 LLM Provider 并输入 API Key
            </p>

            {/* Provider 选择 */}
            <div className="grid grid-cols-3 gap-2 mb-6">
              {PROVIDER_PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => {
                    setSelectedProvider(p);
                    setTestResult(null);
                    setCustomBaseUrl('');
                  }}
                  className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                    selectedProvider.id === p.id
                      ? 'border-[#00d4aa] bg-[#00d4aa]/10 text-[#00a88a] font-medium'
                      : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}
                >
                  {p.name}
                </button>
              ))}
            </div>

            {/* API Key */}
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => { setApiKey(e.target.value); setTestResult(null); setError(''); }}
              placeholder={selectedProvider.placeholder}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg mb-4
                bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                focus:outline-none focus:ring-2 focus:ring-[#00d4aa]/40 focus:border-[#00d4aa]
                placeholder:text-gray-300 dark:placeholder:text-gray-500"
              autoFocus
            />

            {/* 自定义 Base URL（可选） */}
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              Base URL <span className="text-gray-400 font-normal">（可选，留空使用默认）</span>
            </label>
            <input
              type="text"
              value={customBaseUrl}
              onChange={(e) => setCustomBaseUrl(e.target.value)}
              placeholder={selectedProvider.baseUrl}
              className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg mb-4
                bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                focus:outline-none focus:ring-2 focus:ring-[#00d4aa]/40 focus:border-[#00d4aa]
                placeholder:text-gray-300 dark:placeholder:text-gray-500"
            />

            {/* 默认模型提示 */}
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
              默认模型: {selectedProvider.defaultModel.name} ({selectedProvider.defaultModel.id})
            </p>

            {/* 测试结果 */}
            {testResult && (
              <div className={`mb-4 text-sm px-3 py-2 rounded-lg ${
                testResult.success
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400'
              }`}>
                {testResult.success ? '连接成功！' : `连接失败: ${testResult.error}`}
              </div>
            )}

            {/* 错误提示 */}
            {error && (
              <div className="mb-4 text-sm px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400">
                {error}
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-3">
              <button
                onClick={() => setStep('welcome')}
                className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                返回
              </button>
              <button
                onClick={handleTest}
                disabled={testing || !apiKey.trim()}
                className="px-4 py-2 text-sm font-medium border border-gray-200 dark:border-gray-600
                  text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700
                  transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {testing ? '测试中...' : '测试连接'}
              </button>
              <button
                onClick={handleSaveLLM}
                disabled={saving || !apiKey.trim()}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-[#00d4aa]
                  rounded-lg hover:bg-[#00b894] transition-colors
                  disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? '保存中...' : '下一步'}
              </button>
            </div>
          </div>
        )}

        {/* 步骤 3: Embedding 配置 */}
        {step === 'embedding' && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
              配置向量模型
            </h2>
            <p className="text-sm text-gray-400 dark:text-gray-500 mb-6">
              向量模型用于记忆语义搜索和知识库检索，大幅提升 Agent 的记忆能力
            </p>

            {llmHasEmbedding ? (
              /* ---- 情况 A: LLM Provider 自带 embedding ---- */
              <div>
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 mb-6">
                  <p className="text-sm text-green-700 dark:text-green-300 font-medium mb-1">
                    {selectedProvider.name} 支持向量模型
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-400">
                    推荐使用 {selectedProvider.embedding!.name}（{selectedProvider.embedding!.dimension} 维），
                    共用已配置的 API Key，无需额外设置。
                  </p>
                </div>

                {/* 两个选项 */}
                <div className="space-y-3 mb-6">
                  <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    embeddingSource === 'same'
                      ? 'border-[#00d4aa] bg-[#00d4aa]/5'
                      : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}>
                    <input
                      type="radio"
                      checked={embeddingSource === 'same'}
                      onChange={() => setEmbeddingSource('same')}
                      className="mt-0.5 accent-[#00d4aa]"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        使用 {selectedProvider.name} 的 {selectedProvider.embedding!.name}
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        共用同一个 API Key，推荐
                      </p>
                    </div>
                  </label>

                  <label className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                    embeddingSource === 'other'
                      ? 'border-[#00d4aa] bg-[#00d4aa]/5'
                      : 'border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700'
                  }`}>
                    <input
                      type="radio"
                      checked={embeddingSource === 'other'}
                      onChange={() => setEmbeddingSource('other')}
                      className="mt-0.5 accent-[#00d4aa]"
                    />
                    <div>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">
                        使用其他 Provider 的向量模型
                      </p>
                      <p className="text-xs text-gray-400 dark:text-gray-500">
                        如果你想用不同服务商的 embedding
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            ) : (
              /* ---- 情况 B: LLM Provider 不支持 embedding ---- */
              <div className="bg-amber-50 dark:bg-amber-900/20 rounded-lg p-4 mb-6">
                <p className="text-sm text-amber-700 dark:text-amber-300 font-medium mb-1">
                  {selectedProvider.name} 不提供向量模型
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  请选择一个支持向量模型的 Provider。推荐 OpenAI 或通义千问，价格低廉且质量可靠。
                </p>
              </div>
            )}

            {/* 选择其他 embedding Provider（情况 B 始终显示，情况 A 仅在选 other 时显示） */}
            {(embeddingSource === 'other') && (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-2">
                  {availableEmbeddingProviders.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => {
                        setEmbeddingProvider(p);
                        setEmbeddingCustomBaseUrl('');
                      }}
                      className={`px-3 py-2 text-sm rounded-lg border transition-colors ${
                        embeddingProvider.id === p.id
                          ? 'border-[#00d4aa] bg-[#00d4aa]/10 text-[#00a88a] font-medium'
                          : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'
                      }`}
                    >
                      {p.name}
                    </button>
                  ))}
                </div>

                {embeddingProvider.embedding && (
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    向量模型: {embeddingProvider.embedding.name}（{embeddingProvider.embedding.dimension} 维）
                  </p>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    API Key
                  </label>
                  <input
                    type="password"
                    value={embeddingApiKey}
                    onChange={(e) => { setEmbeddingApiKey(e.target.value); setEmbeddingError(''); }}
                    placeholder={embeddingProvider.placeholder}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg
                      bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                      focus:outline-none focus:ring-2 focus:ring-[#00d4aa]/40 focus:border-[#00d4aa]
                      placeholder:text-gray-300 dark:placeholder:text-gray-500"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Base URL <span className="text-gray-400 font-normal">（可选）</span>
                  </label>
                  <input
                    type="text"
                    value={embeddingCustomBaseUrl}
                    onChange={(e) => setEmbeddingCustomBaseUrl(e.target.value)}
                    placeholder={embeddingProvider.baseUrl}
                    className="w-full px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg
                      bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                      focus:outline-none focus:ring-2 focus:ring-[#00d4aa]/40 focus:border-[#00d4aa]
                      placeholder:text-gray-300 dark:placeholder:text-gray-500"
                  />
                </div>
              </div>
            )}

            {/* 测试结果 */}
            {embeddingTestResult && (
              <div className={`mt-4 text-sm px-3 py-2 rounded-lg ${
                embeddingTestResult.success
                  ? 'bg-green-50 dark:bg-green-900/20 text-green-600 dark:text-green-400'
                  : 'bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400'
              }`}>
                {embeddingTestResult.success
                  ? `连接成功！${embeddingTestResult.error ? `（${embeddingTestResult.error}）` : ''}`
                  : `连接失败: ${embeddingTestResult.error}`}
              </div>
            )}

            {/* 错误提示 */}
            {embeddingError && (
              <div className="mt-4 text-sm px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-400">
                {embeddingError}
              </div>
            )}

            {/* 跳过确认提示 */}
            {showSkipConfirm && (
              <div className="mt-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                <p className="text-sm font-medium text-amber-700 dark:text-amber-300 mb-2">
                  跳过向量模型配置将影响以下功能：
                </p>
                <ul className="text-xs text-amber-600 dark:text-amber-400 space-y-1 mb-3 list-disc list-inside">
                  <li>记忆语义搜索不可用 — Agent 只能通过关键词匹配回忆，无法理解语义相似的记忆</li>
                  <li>知识库 RAG 检索降级 — 文档检索仅靠全文搜索，无法按语义相关度排序</li>
                  <li>记忆检索准确率下降 — 三阶段渐进检索的 Phase 1 向量宽搜索将被跳过</li>
                </ul>
                <p className="text-xs text-amber-500 dark:text-amber-500 mb-3">
                  你可以稍后在「设置」中随时配置向量模型。
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowSkipConfirm(false)}
                    className="px-3 py-1.5 text-xs font-medium text-amber-700 dark:text-amber-300
                      border border-amber-300 dark:border-amber-700 rounded-lg
                      hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors"
                  >
                    返回配置
                  </button>
                  <button
                    onClick={handleSkipEmbedding}
                    className="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400
                      hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
                  >
                    确认跳过
                  </button>
                </div>
              </div>
            )}

            {/* 操作按钮 */}
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setStep('provider')}
                className="px-4 py-2 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
              >
                返回
              </button>
              <button
                onClick={() => setShowSkipConfirm(true)}
                className="px-4 py-2 text-sm font-medium border border-gray-200 dark:border-gray-600
                  text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700
                  transition-colors"
              >
                以后再配置
              </button>
              <button
                onClick={handleEmbeddingTest}
                disabled={embeddingTesting || (embeddingSource === 'other' && !embeddingApiKey.trim())}
                className="px-4 py-2 text-sm font-medium border border-gray-200 dark:border-gray-600
                  text-gray-600 dark:text-gray-300 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700
                  transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {embeddingTesting ? '测试中...' : '测试连接'}
              </button>
              <button
                onClick={handleSaveEmbedding}
                disabled={embeddingSaving || (embeddingSource === 'other' && !embeddingApiKey.trim())}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-[#00d4aa]
                  rounded-lg hover:bg-[#00b894] transition-colors
                  disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {embeddingSaving ? '保存中...' : '保存并完成'}
              </button>
            </div>
          </div>
        )}

        {/* 步骤 4: 完成 */}
        {step === 'done' && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8 text-center">
            <div className="text-6xl mb-4">🎉</div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              配置完成！
            </h2>
            <p className="text-gray-500 dark:text-gray-400 mb-6">
              一切就绪，现在你可以创建你的第一个 AI Agent 了。
            </p>
            <button
              onClick={goToMain}
              className="px-6 py-3 bg-[#00d4aa] text-white font-medium rounded-xl
                hover:bg-[#00b894] transition-colors"
            >
              进入 EvoClaw
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
