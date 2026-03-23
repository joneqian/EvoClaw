/**
 * ModelSelector — 内联模型选择器下拉组件
 * 位于输入框底部操作栏，发送按钮左侧
 */

import { useState, useEffect, useRef } from 'react';
import { get } from '../lib/api';

interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

interface ModelSelectorProps {
  /** 当前选中的模型 ID（临时覆盖） */
  selectedModelId: string | null;
  /** 模型变更回调 */
  onModelChange: (modelId: string | null) => void;
  disabled?: boolean;
}

export default function ModelSelector({ selectedModelId, onModelChange, disabled }: ModelSelectorProps) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 延迟加载模型列表（首次打开时）
  const fetchModels = async () => {
    if (loaded) return;
    try {
      const data = await get<{ models: ModelInfo[] }>('/models');
      setModels(data.models ?? []);
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

  const selectedModel = models.find((m) => m.id === selectedModelId);
  const displayName = selectedModel?.name ?? '默认模型';

  return (
    <div className="relative" ref={menuRef}>
      {/* 触发按钮 */}
      <button
        onClick={handleToggle}
        disabled={disabled}
        className="flex items-center gap-1 px-2 py-1 text-xs text-slate-500
          hover:bg-slate-100 hover:text-slate-700 rounded-lg transition-colors
          disabled:opacity-40 disabled:cursor-not-allowed"
        title="切换模型"
      >
        <span className="max-w-[120px] truncate">{displayName}</span>
        <svg className={`w-3 h-3 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
        </svg>
      </button>

      {/* 下拉菜单 */}
      {open && (
        <div className="absolute bottom-full left-0 mb-1.5 w-56 bg-white border border-slate-200
          rounded-xl shadow-lg shadow-slate-200/50 overflow-hidden z-50 max-h-64 overflow-y-auto">
          {/* 默认模型选项 */}
          <button
            onClick={() => { onModelChange(null); setOpen(false); }}
            className={`w-full text-left px-3 py-2 text-sm transition-colors ${
              selectedModelId === null
                ? 'bg-brand/10 text-brand-active font-medium'
                : 'text-slate-600 hover:bg-slate-50'
            }`}
          >
            默认模型
            <span className="text-xs text-slate-400 ml-1">(跟随专家配置)</span>
          </button>

          {models.length === 0 && loaded && (
            <p className="px-3 py-2 text-xs text-slate-400">暂无可用模型</p>
          )}

          {!loaded && (
            <div className="flex justify-center py-3">
              <span className="w-4 h-4 border-2 border-slate-300 border-t-brand rounded-full animate-spin" />
            </div>
          )}

          {models.map((model) => (
            <button
              key={model.id}
              onClick={() => { onModelChange(model.id); setOpen(false); }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                selectedModelId === model.id
                  ? 'bg-brand/10 text-brand-active font-medium'
                  : 'text-slate-600 hover:bg-slate-50'
              }`}
            >
              <span className="truncate">{model.name}</span>
              <span className="text-xs text-slate-400 ml-1">({model.provider})</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
