/**
 * 命令面板（M3-T3c）
 *
 * Cmd+K / Ctrl+K 打开，提供 HTTP 路由、Agent 工具、渠道命令的统一搜索入口。
 * 数据源：GET /commands（M3-T3b）。点击路由条目复制 `<METHOD> <path>` 到剪贴板。
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { get } from '../lib/api';
import { Skeleton } from './Skeleton';

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
  file_read:  'bg-info/10 text-info',
  file_write: 'bg-warning/10 text-warning',
  network:    'bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300',
  shell:      'bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300',
  browser:    'bg-cyan-50 dark:bg-cyan-950/40 text-cyan-700 dark:text-cyan-300',
  mcp:        'bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300',
  skill:      'bg-success/10 text-success',
};

const METHOD_COLORS: Record<string, string> = {
  GET:    'text-success',
  POST:   'text-info',
  PUT:    'text-warning',
  PATCH:  'text-warning',
  DELETE: 'text-rose-600 dark:text-rose-300',
};

// ─── 组件 ───

export interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function CommandPalette({ isOpen, onClose }: CommandPaletteProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<PaletteEntry[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

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

  // 扁平化结果用于键盘导航
  const flat = useMemo(() => grouped.flatMap(([, arr]) => arr), [grouped]);

  // 查询变化时重置 selected
  useEffect(() => { setSelectedIndex(0); }, [query, entries.length]);

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
      toast.success(t('common.copied', { text }));
    } catch {
      toast.error(t('common.copyFailed'));
    }
  }, [t]);

  // Esc 关闭 + ↑↓ 导航 + Enter 选中
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, Math.max(0, flat.length - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        const entry = flat[selectedIndex];
        if (entry) {
          e.preventDefault();
          handleEntryClick(entry);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, flat, selectedIndex, handleEntryClick]);

  // 选中项滚动到可视区
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;
    const el = container.querySelector<HTMLElement>(`[data-cmd-index="${selectedIndex}"]`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 backdrop-blur-[2px] pt-[15vh]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('commandPalette.placeholder')}
        className="bg-card rounded-2xl shadow-2xl shadow-foreground/10 w-full max-w-[600px] mx-4
          animate-in fade-in zoom-in-95 duration-150 flex flex-col max-h-[70vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 搜索框 */}
        <div className="px-4 py-3 border-b border-border">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('commandPalette.placeholder')}
            aria-label={t('commandPalette.placeholder')}
            aria-activedescendant={flat[selectedIndex] ? `cmd-item-${selectedIndex}` : undefined}
            className="w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none"
          />
        </div>

        {/* 结果列表 */}
        <div ref={listRef} className="flex-1 overflow-y-auto" role="listbox">
          {loading && (
            <div className="px-4 py-4 space-y-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-4 w-4 rounded shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-3 w-1/3" />
                    <Skeleton className="h-2.5 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          )}
          {!loading && entries.length === 0 && (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">{t('commandPalette.notReady')}</div>
          )}
          {!loading && grouped.length === 0 && entries.length > 0 && (
            <div className="px-4 py-6 text-sm text-muted-foreground text-center">{t('commandPalette.noMatch')}</div>
          )}
          {(() => {
            let runningIndex = -1;
            return grouped.map(([group, arr]) => (
            <div key={group} className="py-1.5">
              <div className="px-4 py-1 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                {group}
              </div>
              <ul>
                {arr.map((entry, i) => {
                  runningIndex += 1;
                  const flatIndex = runningIndex;
                  const isSelected = flatIndex === selectedIndex;
                  return (
                  <li key={`${group}-${i}`}>
                    <button
                      id={`cmd-item-${flatIndex}`}
                      data-cmd-index={flatIndex}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setSelectedIndex(flatIndex)}
                      onClick={() => handleEntryClick(entry)}
                      className={`w-full px-4 py-2 text-left flex items-center gap-3 group ${
                        isSelected ? 'bg-muted' : 'hover:bg-muted'
                      }`}
                    >
                      {entry.kind === 'route' && (
                        <>
                          <span className={`text-[11px] font-mono font-semibold w-14 shrink-0 ${METHOD_COLORS[entry.data.method] ?? 'text-muted-foreground'}`}>
                            {entry.data.method}
                          </span>
                          <code className="text-xs font-mono text-foreground truncate flex-1">{entry.data.path}</code>
                          {entry.data.requiredPermission && (
                            <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${PERMISSION_COLORS[entry.data.requiredPermission] ?? 'bg-accent text-muted-foreground'}`}>
                              {entry.data.requiredPermission}
                            </span>
                          )}
                          <span className="text-xs text-muted-foreground truncate max-w-[160px]">{entry.data.description}</span>
                        </>
                      )}
                      {entry.kind === 'tool' && (
                        <>
                          <span className="text-xs font-mono font-medium text-foreground w-28 shrink-0 truncate">{entry.data.name}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded shrink-0 ${PERMISSION_COLORS[entry.data.category] ?? 'bg-accent text-muted-foreground'}`}>
                            {entry.data.category}
                          </span>
                          {entry.data.destructive && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-warning/10 text-warning shrink-0">破坏性</span>
                          )}
                          <span className="text-xs text-muted-foreground truncate flex-1">{entry.data.description}</span>
                        </>
                      )}
                      {entry.kind === 'channel' && (
                        <>
                          <span className="text-xs font-mono font-medium text-foreground w-28 shrink-0 truncate">/{entry.data.name}</span>
                          <span className="text-xs text-muted-foreground truncate flex-1">{entry.data.description}</span>
                        </>
                      )}
                    </button>
                  </li>
                  );
                })}
              </ul>
            </div>
            ));
          })()}
        </div>

        {/* 底部状态条 */}
        <div className="px-4 py-2 border-t border-border flex items-center justify-between text-[11px] text-muted-foreground">
          <span>{t('commandPalette.footer')}</span>
          {entries.length > 0 && <span>{t('commandPalette.totalItems', { count: entries.length })}</span>}
        </div>
      </div>

    </div>
  );
}
