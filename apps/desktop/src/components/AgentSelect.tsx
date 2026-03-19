/**
 * AgentSelect — 自定义 Agent 下拉选择器
 * 替代原生 <select>，展示 AgentAvatar + 名称，风格统一
 */
import { useState, useRef, useEffect } from 'react';
import AgentAvatar from './AgentAvatar';

interface AgentOption {
  id: string;
  name: string;
}

interface AgentSelectProps {
  agents: AgentOption[];
  value: string;
  onChange: (agentId: string) => void;
  placeholder?: string;
}

export default function AgentSelect({ agents, value, onChange, placeholder = '暂无专家' }: AgentSelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = agents.find((a) => a.id === value);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // 键盘支持
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') setOpen(false);
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen((v) => !v);
    }
  };

  return (
    <div ref={containerRef} className="relative">
      {/* 触发按钮 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleKeyDown}
        className="flex items-center gap-2 px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white
          hover:border-slate-300 focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand
          transition-colors min-w-[140px]"
      >
        {selected ? (
          <>
            <AgentAvatar name={selected.name} size="xs" />
            <span className="text-slate-700 truncate">{selected.name}</span>
          </>
        ) : (
          <span className="text-slate-400">{placeholder}</span>
        )}
        {/* 箭头 */}
        <svg
          className={`w-4 h-4 text-slate-400 ml-auto shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* 下拉面板 */}
      {open && (
        <div className="absolute right-0 top-full mt-1 z-50 w-56 py-1 bg-white border border-slate-200 rounded-xl shadow-lg
          max-h-64 overflow-y-auto animate-in fade-in slide-in-from-top-1 duration-150">
          {agents.length === 0 ? (
            <div className="px-3 py-4 text-center text-sm text-slate-400">{placeholder}</div>
          ) : (
            agents.map((agent) => (
              <button
                key={agent.id}
                type="button"
                onClick={() => {
                  onChange(agent.id);
                  setOpen(false);
                }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-left transition-colors
                  ${agent.id === value
                    ? 'bg-brand/5 text-brand font-medium'
                    : 'text-slate-700 hover:bg-slate-50'
                  }`}
              >
                <AgentAvatar name={agent.name} size="sm" />
                <span className="truncate">{agent.name}</span>
                {agent.id === value && (
                  <svg className="w-4 h-4 ml-auto text-brand shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
