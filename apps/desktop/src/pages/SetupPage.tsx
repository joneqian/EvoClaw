import { useState, useCallback } from 'react';
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
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', api: 'openai-completions', placeholder: 'sk-...', defaultModel: { id: 'gpt-4o-mini', name: 'GPT-4o Mini' } },
  { id: 'anthropic', name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', api: 'anthropic', placeholder: 'sk-ant-...', defaultModel: { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6' } },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', api: 'openai-completions', placeholder: 'sk-...', defaultModel: { id: 'deepseek-chat', name: 'DeepSeek Chat' } },
  { id: 'qwen', name: '通义千问 (Qwen)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', api: 'openai-completions', placeholder: 'sk-...', defaultModel: { id: 'qwen-turbo', name: 'Qwen Turbo' } },
  { id: 'glm', name: '智谱 (GLM)', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', api: 'openai-completions', placeholder: '...', defaultModel: { id: 'glm-4-flash', name: 'GLM-4 Flash' } },
  { id: 'doubao', name: '豆包 (Doubao)', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', api: 'openai-completions', placeholder: '...', defaultModel: { id: 'doubao-pro-4k', name: 'Doubao Pro' } },
];

type Step = 'welcome' | 'provider' | 'done';

export default function SetupPage() {
  const navigate = useNavigate();
  const { setInitState, setSidecarConnected } = useAppStore();

  const [step, setStep] = useState<Step>('welcome');
  const [selectedProvider, setSelectedProvider] = useState(PROVIDER_PRESETS[0]);
  const [apiKey, setApiKey] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  /** 测试连接 */
  const handleTest = useCallback(async () => {
    if (!apiKey.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      const result = await post<{ success: boolean; error?: string; model?: string }>(
        `/provider/${selectedProvider.id}/test`,
        { apiKey: apiKey.trim() },
      );
      setTestResult(result);
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : '测试失败' });
    } finally {
      setTesting(false);
    }
  }, [apiKey, selectedProvider]);

  /** 保存配置 */
  const handleSave = useCallback(async () => {
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

      // 写入完整配置到 evo_claw.json
      await put('/config', {
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
      });

      // 验证配置生效
      const health = await healthCheck();
      if (health?.status === 'ok') {
        setSidecarConnected(true);
        setInitState('connected');
        setStep('done');
      } else {
        setError(`配置已保存但验证未通过: ${health?.missing?.join(', ') ?? '未知错误'}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [apiKey, customBaseUrl, selectedProvider, setSidecarConnected, setInitState]);

  /** 进入主界面 */
  const goToMain = useCallback(() => {
    navigate('/chat');
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="w-full max-w-lg mx-4">
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
              首先，让我们配置一个 LLM Provider 来让你的 Agent 拥有思考能力。
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

        {/* 步骤 2: Provider 配置 */}
        {step === 'provider' && (
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-lg p-8">
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-1">
              配置 LLM Provider
            </h2>
            <p className="text-sm text-gray-400 dark:text-gray-500 mb-6">
              选择一个 Provider 并输入 API Key
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
                onClick={handleSave}
                disabled={saving || !apiKey.trim()}
                className="flex-1 px-4 py-2 text-sm font-medium text-white bg-[#00d4aa]
                  rounded-lg hover:bg-[#00b894] transition-colors
                  disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {saving ? '保存中...' : '保存并继续'}
              </button>
            </div>
          </div>
        )}

        {/* 步骤 3: 完成 */}
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
