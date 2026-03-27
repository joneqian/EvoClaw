import { useState, useEffect, useCallback } from 'react';
import { BRAND_NAME } from '@evoclaw/shared';
import { get, put } from '../lib/api';

/** 外部服务配置 */
interface ServicesConfig {
  brave: { configured: boolean; maskedApiKey: string };
}

/** 服务定义 */
interface ServiceDef {
  id: string;
  name: string;
  icon: string;
  description: string;
  keyPlaceholder: string;
  docsUrl?: string;
}

const SERVICES: ServiceDef[] = [
  {
    id: 'brave',
    name: '网络搜索 (Brave)',
    icon: '🔍',
    description: '启用 web_search 工具，让 Agent 能够搜索互联网获取实时信息',
    keyPlaceholder: 'BSA...',
    docsUrl: 'https://brave.com/search/api/',
  },
];

function ServiceCard({
  service,
  configured,
  maskedApiKey,
  onSave,
}: {
  service: ServiceDef;
  configured: boolean;
  maskedApiKey: string;
  onSave: (apiKey: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await onSave(apiKey.trim());
      setApiKey('');
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }, [apiKey, onSave]);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-start gap-3">
        <span className="text-xl">{service.icon}</span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-slate-800">{service.name}</h4>
            {configured ? (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-green-50 text-green-600 font-medium">已配置</span>
            ) : (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-400 font-medium">未配置</span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-1">{service.description}</p>

          {/* API Key 显示/编辑 */}
          <div className="mt-3">
            {editing ? (
              <div className="flex gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
                  placeholder={service.keyPlaceholder}
                  className="flex-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg
                    bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
                  autoFocus
                />
                <button
                  onClick={handleSave}
                  disabled={!apiKey.trim() || saving}
                  className="px-3 py-1.5 text-xs font-medium text-white bg-brand rounded-lg
                    hover:bg-brand-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? '保存中...' : '保存'}
                </button>
                <button
                  onClick={() => { setEditing(false); setApiKey(''); }}
                  className="px-3 py-1.5 text-xs text-slate-500 hover:text-slate-700 transition-colors"
                >
                  取消
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {configured && (
                  <code className="text-xs text-slate-500 bg-slate-50 px-2 py-1 rounded font-mono">
                    {maskedApiKey}
                  </code>
                )}
                <button
                  onClick={() => setEditing(true)}
                  className="text-xs text-brand hover:text-brand-hover font-medium transition-colors"
                >
                  {configured ? '修改' : '配置 API Key'}
                </button>
                {service.docsUrl && (
                  <a
                    href={service.docsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-slate-400 hover:text-slate-600 transition-colors"
                  >
                    获取 Key →
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [services, setServices] = useState<ServicesConfig | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const fetchServices = useCallback(async () => {
    try {
      const data = await get<{ services: ServicesConfig }>('/config/services');
      setServices(data.services);
    } catch {
      // Sidecar 可能未就绪
    }
  }, []);

  useEffect(() => { fetchServices(); }, [fetchServices]);

  // Toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleSaveService = useCallback(async (serviceId: string, apiKey: string) => {
    try {
      await put(`/config/services/${serviceId}`, { apiKey });
      setToast({ message: '已保存', type: 'success' });
      fetchServices();
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : '保存失败', type: 'error' });
      throw err;
    }
  }, [fetchServices]);

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 py-4 border-b border-slate-200 bg-white">
        <h2 className="text-lg font-bold text-slate-900">设置</h2>
        <p className="text-sm text-slate-400 mt-1">应用常规设置</p>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* 外部服务 */}
          <div>
            <h3 className="text-sm font-semibold text-slate-700 mb-3">外部服务</h3>
            <div className="space-y-3">
              {SERVICES.map((service) => (
                <ServiceCard
                  key={service.id}
                  service={service}
                  configured={services?.[service.id as keyof ServicesConfig]?.configured ?? false}
                  maskedApiKey={(services?.[service.id as keyof ServicesConfig] as any)?.maskedApiKey ?? ''}
                  onSave={(apiKey) => handleSaveService(service.id, apiKey)}
                />
              ))}
            </div>
          </div>

          {/* 关于 */}
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">关于</h3>
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
        </div>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-lg text-sm font-medium shadow-lg z-50 ${
          toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}
