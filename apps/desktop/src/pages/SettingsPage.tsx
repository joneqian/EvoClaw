import { useState, useCallback } from 'react';

/** LLM Provider 配置 */
interface ProviderConfig {
  id: string;
  name: string;
  placeholder: string;
}

const PROVIDERS: ProviderConfig[] = [
  { id: 'openai', name: 'OpenAI', placeholder: 'sk-...' },
  { id: 'anthropic', name: 'Anthropic', placeholder: 'sk-ant-...' },
  { id: 'deepseek', name: 'DeepSeek', placeholder: 'sk-...' },
  { id: 'qwen', name: '通义千问', placeholder: 'sk-...' },
  { id: 'zhipu', name: '智谱GLM', placeholder: '...' },
  { id: 'doubao', name: '豆包', placeholder: '...' },
];

/** Toast 通知状态 */
interface Toast {
  message: string;
  type: 'success' | 'error';
}

export default function SettingsPage() {
  /** 每个 provider 的 API Key（仅前端临时保存，实际保存需通过 Tauri IPC） */
  const [keys, setKeys] = useState<Record<string, string>>({});
  /** 已保存状态 */
  const [saved, setSaved] = useState<Record<string, boolean>>({});
  /** Toast 通知 */
  const [toast, setToast] = useState<Toast | null>(null);

  /** 显示 toast */
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2000);
  }, []);

  /** 更新某个 provider 的 key */
  const updateKey = useCallback((providerId: string, value: string) => {
    setKeys((prev) => ({ ...prev, [providerId]: value }));
    // key 变化后取消已保存标记
    setSaved((prev) => ({ ...prev, [providerId]: false }));
  }, []);

  /** 保存（目前只是模拟） */
  const handleSave = useCallback(
    (providerId: string) => {
      const key = keys[providerId]?.trim();
      if (!key) {
        showToast('请输入 API Key', 'error');
        return;
      }
      // TODO: 通过 Tauri IPC 调用 Rust 侧保存到 macOS Keychain
      setSaved((prev) => ({ ...prev, [providerId]: true }));
      showToast('已保存');
    },
    [keys, showToast],
  );

  return (
    <div className="p-6 max-w-2xl">
      <h2 className="text-xl font-bold text-gray-800 mb-1">设置</h2>
      <p className="text-sm text-gray-400 mb-6">管理 LLM Provider 的 API Key 配置</p>

      {/* Provider 列表 */}
      <div className="space-y-4">
        {PROVIDERS.map((provider) => {
          const key = keys[provider.id] ?? '';
          const isSaved = saved[provider.id] ?? false;

          return (
            <div
              key={provider.id}
              className="bg-white rounded-xl border border-gray-200 p-4"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-medium text-gray-800">{provider.name}</h4>
                  {isSaved ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-600">
                      已配置
                    </span>
                  ) : key ? (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-600">
                      未保存
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-400">
                      未配置
                    </span>
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <input
                  type="password"
                  value={key}
                  onChange={(e) => updateKey(provider.id, e.target.value)}
                  placeholder={provider.placeholder}
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg
                    focus:outline-none focus:ring-2 focus:ring-[#00d4aa]/40 focus:border-[#00d4aa]
                    placeholder:text-gray-300"
                />
                <button
                  onClick={() => handleSave(provider.id)}
                  className="shrink-0 px-4 py-2 text-sm font-medium rounded-lg transition-colors
                    bg-[#00d4aa] text-white hover:bg-[#00b894]
                    disabled:opacity-40"
                  disabled={!key.trim()}
                >
                  保存
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* 说明 */}
      <p className="mt-6 text-xs text-gray-400 leading-relaxed">
        API Key 将通过 macOS Keychain 安全存储，不会明文保存在磁盘上。
        当前版本为 UI 预览，实际 Keychain 集成将在后续版本完成。
      </p>

      {/* Toast 通知 */}
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
