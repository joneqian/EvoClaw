/**
 * Select — 自定义下拉选择器
 * 替代原生 <select>，统一风格：圆角卡片 + 点击外部关闭 + 键盘支持
 */
import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
  hint?: string;
}

interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

export default function Select({ options, value, onChange, placeholder = '请选择', className = '' }: SelectProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

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
    // 上下箭头切换选项
    if (open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      const currentIdx = options.findIndex((o) => o.value === value);
      const nextIdx = e.key === 'ArrowDown'
        ? Math.min(currentIdx + 1, options.length - 1)
        : Math.max(currentIdx - 1, 0);
      onChange(options[nextIdx].value);
    }
  };

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {/* 触发按钮 */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={handleKeyDown}
        className="flex items-center justify-between gap-2 w-full px-3 py-1.5 text-sm border border-border rounded-lg bg-card
          hover:border-border focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand
          transition-colors"
      >
        <span className={selected ? 'text-foreground' : 'text-muted-foreground'}>
          {selected?.label ?? placeholder}
        </span>
        <ChevronDown
          className={`w-3.5 h-3.5 text-muted-foreground shrink-0 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
          strokeWidth={2}
          aria-hidden="true"
        />
      </button>

      {/* 下拉面板 */}
      {open && (
        <div className="absolute z-50 mt-1 w-full min-w-[160px] bg-card border border-border rounded-xl shadow-lg py-1
          animate-in fade-in slide-in-from-top-1 duration-150 right-0">
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                option.value === value
                  ? 'bg-brand/5 text-brand font-medium'
                  : 'text-foreground hover:bg-muted'
              }`}
            >
              <div className="flex items-center justify-between">
                <span>{option.label}</span>
                {option.value === value && (
                  <Check className="w-3.5 h-3.5 text-brand" strokeWidth={2.5} aria-hidden="true" />
                )}
              </div>
              {option.hint && (
                <div className="text-xs text-muted-foreground mt-0.5">{option.hint}</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
