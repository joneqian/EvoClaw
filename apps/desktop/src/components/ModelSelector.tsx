/**
 * ModelSelector — 内联模型选择器下拉组件
 * 位于输入框底部操作栏，发送按钮左侧
 */

import { useState, useEffect, useRef } from 'react';
import { get } from '../lib/api';

interface ModelInfo {
  id: string;
  name: string;
  provider: string;      // 显示名称
  providerId: string;    // Provider ID (用于后端保存)
}

interface ProviderInfo {
  id: string;
  name: string;
  models: { id: string; name: string }[];
}

interface ModelSelectorProps {
  /** 当前选中的模型 ID */
  selectedModelId: string | null;
  /** 模型变更回调 (modelId + provider) */
  onModelChange: (modelId: string | null, provider?: string) => void;
  disabled?: boolean;
}

/** 按 Provider 分组的模型数据 */
interface ProviderGroup {
  providerName: string;
  models: ModelInfo[];
}

export default function ModelSelector({ selectedModelId, onModelChange, disabled }: ModelSelectorProps) {
  const [groups, setGroups] = useState<ProviderGroup[]>([]);
  const [allModels, setAllModels] = useState<ModelInfo[]>([]);
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 组件挂载时立即加载模型列表 + 默认模型
  useEffect(() => { fetchModels(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchModels = async () => {
    if (loaded) return;
    try {
      const [providerData, defaultData] = await Promise.all([
        get<{ providers: ProviderInfo[] }>('/provider'),
        get<{ provider: string; modelId: string }>('/provider/default/model').catch(() => null),
      ]);
      const providerGroups: ProviderGroup[] = [];
      const flat: ModelInfo[] = [];
      for (const provider of providerData.providers ?? []) {
        const providerName = provider.name || provider.id;
        const models: ModelInfo[] = [];
        for (const model of provider.models ?? []) {
          const m: ModelInfo = { id: model.id, name: model.name || model.id, provider: providerName, providerId: provider.id };
          models.push(m);
          flat.push(m);
        }
        if (models.length > 0) {
          providerGroups.push({ providerName, models });
        }
      }
      setGroups(providerGroups);
      setAllModels(flat);
      if (defaultData?.modelId) {
        setDefaultModelId(defaultData.modelId);
      }
    } catch {
      // Sidecar 可能未就绪
    }
    setLoaded(true);
  };

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleToggle = () => {
    if (disabled) return;
    if (!open) fetchModels();
    setOpen(!open);
  };

  // 实际生效的模型：用户选了就用用户选的，否则用系统默认
  const activeModelId = selectedModelId ?? defaultModelId;
  const activeModel = allModels.find((m) => m.id === activeModelId);
  const displayName = activeModel?.name ?? (allModels.length > 0 ? allModels[0].name : '选择模型');

  return (
    <div className="relative" ref={menuRef}>
      {/* 触发按钮 */}
      <button
        onClick={handleToggle}
        disabled={disabled}
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-600
          bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-full transition-colors
          disabled:opacity-40 disabled:cursor-not-allowed"
        title="切换模型"
      >
        <span className="max-w-[150px] truncate">{displayName}</span>
        <svg className={`w-3.5 h-3.5 shrink-0 transition-transform text-slate-400 ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {/* 下拉菜单 — 参考 EasyClaw 设计，固定定位避免被裁切 */}
      {open && (
        <div
          className="fixed w-80 bg-white border border-slate-200 rounded-2xl shadow-xl overflow-hidden z-[100] flex flex-col"
          style={{
            bottom: `${window.innerHeight - (menuRef.current?.getBoundingClientRect().top ?? 0) + 8}px`,
            right: `${window.innerWidth - (menuRef.current?.getBoundingClientRect().right ?? 0)}px`,
            maxHeight: `${(menuRef.current?.getBoundingClientRect().top ?? 400) - 20}px`,
          }}
        >
          {/* 标题 */}
          <div className="px-4 py-3 border-b border-slate-100">
            <span className="text-sm font-bold text-slate-800">选择模型</span>
          </div>

          <div className="overflow-y-auto flex-1">
            {!loaded && (
              <div className="flex justify-center py-6">
                <span className="w-5 h-5 border-2 border-slate-300 border-t-brand rounded-full animate-spin" />
              </div>
            )}

            {allModels.length === 0 && loaded && (
              <p className="px-4 py-4 text-sm text-slate-400 text-center">暂无可用模型</p>
            )}

            {groups.map((group) => (
              <div key={group.providerName}>
                {/* 分组标题 — 品牌色 */}
                <div className="px-4 pt-3 pb-1.5 border-t border-slate-100">
                  <span className="text-xs font-semibold text-brand tracking-wide">
                    {group.providerName}
                  </span>
                </div>
                {/* 模型列表 */}
                {group.models.map((model) => {
                  const isSelected = activeModelId === model.id;
                  return (
                    <button
                      key={model.id}
                      onClick={() => {
                        const newId = model.id === defaultModelId && selectedModelId === null ? null : model.id;
                        onModelChange(newId, model.providerId);
                        setOpen(false);
                      }}
                      className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors ${
                        isSelected ? 'bg-brand/5' : 'hover:bg-slate-50'
                      }`}
                    >
                      {/* Provider 首字母图标 */}
                      <span className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500 shrink-0">
                        {group.providerName.charAt(0).toUpperCase()}
                      </span>
                      {/* 模型名称 */}
                      <span className={`flex-1 text-sm text-left truncate ${isSelected ? 'text-brand-active font-medium' : 'text-slate-700'}`}>
                        {model.name}
                      </span>
                      {/* 选中勾 */}
                      {isSelected && (
                        <svg className="w-4 h-4 text-brand shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
