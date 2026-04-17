/**
 * 命令面板（M3-T3c）
 *
 * Cmd+K / Ctrl+K 打开，提供 HTTP 路由、Agent 工具、渠道命令的统一搜索入口。
 * 数据源：GET /commands（M3-T3b）。点击路由条目复制 `<METHOD> <path>` 到剪贴板。
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { get } from '../lib/api';

// ─── 类型 ───

interface RouteMeta {
  method: string;
  path: string;
  category: string;
  description: string;
  requiredPermission?: string;
  since: string;
}

interface ToolMeta {
  name: string;
  category: string;
  description: string;
  destructive?: boolean;
  source: string;
}

interface ChannelCommandMeta {
  name: string;
  aliases?: string[];
  description: string;
  category?: string;
}

type PaletteEntry =
  | { kind: 'route';    data: RouteMeta;          searchText: string }
  | { kind: 'tool';     data: ToolMeta;           searchText: string }
  | { kind: 'channel';  data: ChannelCommandMeta; searchText: string };

// ─── 权限徽章颜色 ───

const PERMISSION_COLORS: Record<string, string> = {
  file_read:  'bg-blue-50 text-blue-700',
  file_write: 'bg-orange-50 text-orange-700',
  network:    'bg-purple-50 text-purple-700',
  shell:      'bg-rose-50 text-rose-700',
  browser:    'bg-cyan-50 text-cyan-700',
  mcp:        'bg-indigo-50 text-indigo-700',
  skill:      'bg-emerald-50 text-emerald-700',
};

const METHOD_COLORS: Record<string, string> = {
  GET:    'text-emerald-600',
  POST:   'text-blue-600',
  PUT:    'text-amber-600',
  PATCH:  'text-amber-600',
  DELETE: 'text-rose-600',
};

// ─── 组件 ───

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const [entries, setEntries] = useState<PaletteEntry[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // 拉取数据（仅首次打开，缓存到 state）
  useEffect(() => {
    if (!isOpen || entries.length > 0) return;
    setLoading(true);
    (async () => {
      try {
        const data = await get<{
          routes: RouteMeta[];
          tools: ToolMeta[];
          channelCommands: ChannelCommandMeta[];
        }>('/commands');
        const combined: PaletteEntry[] = [
          ...data.routes.map(r => ({
            kind: 'route' as const,
            data: r,
            searchText: `${r.method} ${r.path} ${r.category} ${r.description}`.toLowerCase(),
          })),
          ...data.tools.map(t => ({
            kind: 'tool' as const,
            data: t,
            searchText: `${t.name} ${t.category} ${t.description} ${t.source}`.toLowerCase(),
          })),
          ...data.channelCommands.map(c => ({
            kind: 'channel' as const,
            data: c,
            searchText: `/${c.name} ${(c.aliases ?? []).join(' ')} ${c.description}`.toLowerCase(),
          })),
        ];
        setEntries(combined);
      } catch {
        // sidecar 未就绪时保持 entries 空
      } finally {
        setLoading(false);
      }
    })();
  }, [isOpen, entries.length]);

  // 打开时自动 focus 输入框
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    } else {
      setQuery('');
    }
  }, [isOpen]);

  // Esc 关闭
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  // Toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  // 搜索 + 分组
  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? entries.filter(e => e.searchText.includes(q))
      : entries;
    const byGroup = new Map<string, PaletteEntry[]>();
    for (const e of filtered) {
      const group = e.kind === 'route'
        ? `HTTP · ${e.data.category}`
        : e.kind === 'tool'
          ? `工具 · ${e.data.source}`
          : `渠道命令`;
      const arr = byGroup.get(group) ?? [];
      arr.push(e);
      byGroup.set(group, arr);
    }
    // 限制每组展示数量避免滚动压力
    return [...byGroup.entries()]
      .map(([g, arr]) => [g, arr.slice(0, 20)] as const)
      .slice(0, 12);
  }, [entries, query]);

  const handleEntryClick = useCallback((entry: PaletteEntry) => {
    let text = '';
    switch (entry.kind) {
      case 'route':
        text = `${entry.data.method} ${entry.data.path}`;
        break;
      case 'tool':
        text = entry.data.name;
        break;
      case 'channel':
        text = `/${entry.data.name}`;
        break;
    }
    try {
      void navigator.clipboard.writeText(text);
      setToast(`已复制：${text}`);
    } catch {
      setToast(`未能复制到剪贴板`);
    }
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 backdrop-blur-[2px] pt-[15vh]"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl shadow-slate-900/10 w-full max-w-[600px] mx-4
          animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 搜索框 */}
        <div className="px-4 py-3 border-b border-slate-100">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索命令、API 路径、工具名…"
            className="w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 outline-none"
          />
        </div>

        {/* 结果列表 */}
        <div className="flex-1 overflow-y-auto">
          {loading && <div className="px-4 py-6 text-sm text-slate-400 text-center">加载中…</div>}
          {!loading && entries.length === 0 && (
            <div className="px-4 py-6 text-sm text-slate-400 text-center">Sidecar 未就绪或无命令数据</div>
          )}
          {!loading && grouped.length === 0 && entries.length > 0 && (
            <div className="px-4 py-6 text-sm text-slate-400 text-center">没有匹配的命令</div>
          )}
          {grouped.map(([group, arr]) => (
            <div key={group} className="py-1.5">
              <div className="px-4 py-1 text-[11px] font-medium text-slate-400 uppercase tracking-wide">
                {group}
              </div>
              <ul>
                {arr.map((entry, i) => (
                  <li key={`${group}-${i}`}>
                    <button
                      onClick={() => handleEntryClick(entry)}
                      className="w-full px-4 py-2 text-left hover:bg-slate-50 flex items-center gap-3 group"
                    >
                      {entry.kind === 'route' && (
                        <>
                          <span className={`text-[11px] font-mono font-semibold w-14 shrink-0 ${METHOD_COLORS[entry.data.method] ?? 'text-slate-600'}`}>
                            {entry.data.method}
                          </span>
                          <code className="text-xs font-mono text-slate-700 truncate flex-1">{entry.data.path}</code>
                          {entry.data.requiredPermission && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${PERMISSION_COLORS[entry.data.requiredPermission] ?? 'bg-slate-100 text-slate-600'}`}>
                              {entry.data.requiredPermission}
                            </span>
                          )}
                          <span className="text-xs text-slate-400 truncate max-w-[160px]">{entry.data.description}</span>
                        </>
                      )}
                      {entry.kind === 'tool' && (
                        <>
                          <span className="text-xs font-mono font-medium text-slate-700 w-28 shrink-0 truncate">{entry.data.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${PERMISSION_COLORS[entry.data.category] ?? 'bg-slate-100 text-slate-600'}`}>
                            {entry.data.category}
                          </span>
                          {entry.data.destructive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 shrink-0">破坏性</span>
                          )}
                          <span className="text-xs text-slate-400 truncate flex-1">{entry.data.description}</span>
                        </>
                      )}
                      {entry.kind === 'channel' && (
                        <>
                          <span className="text-xs font-mono font-medium text-slate-700 w-28 shrink-0 truncate">/{entry.data.name}</span>
                          <span className="text-xs text-slate-400 truncate flex-1">{entry.data.description}</span>
                        </>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* 底部状态条 */}
        <div className="px-4 py-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
          <span>点击条目复制到剪贴板 · Esc 关闭</span>
          {entries.length > 0 && <span>共 {entries.length} 项</span>}
        </div>
      </div>

      {/* 复制成功 toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 px-3 py-1.5 rounded-lg bg-slate-900 text-white text-xs shadow-lg">
          {toast}
        </div>
      )}
    </div>
  );
}
