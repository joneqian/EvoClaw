import { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  FilePen,
  Globe,
  Terminal,
  Compass,
  Star,
  Zap,
  Shield,
  ShieldCheck,
  Check,
  X as XIcon,
  AlertTriangle,
  Clock,
  ChevronRight,
  Search,
  Users,
  CheckCircle2,
  ListChecks,
  Sliders,
  ShieldAlert,
  ShieldX,
  KeyRound,
  Zap as ZapIcon,
  Image as ImageIcon,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { useAgentStore } from '../stores/agent-store';
import AgentSelect from '../components/AgentSelect';
import { get, del, post, put, patch } from '../lib/api';
import { syncPermissionsToRust } from '../lib/api';
import { invoke } from '@tauri-apps/api/core';

// ─── 配置 ───

interface CategoryEntry {
  label: string;
  Icon: LucideIcon;
  color: string;
  bg: string;
  dot: string;
}

const CATEGORY_CONFIG: Record<string, CategoryEntry> = {
  file_read:  { label: '文件读取', Icon: FileText, color: 'text-info', bg: 'bg-info/10', dot: 'bg-info' },
  file_write: { label: '文件修改', Icon: FilePen, color: 'text-warning', bg: 'bg-warning/10', dot: 'bg-warning' },
  network:    { label: '网络访问', Icon: Globe, color: 'text-purple-600 dark:text-purple-300', bg: 'bg-purple-50 dark:bg-purple-950/40', dot: 'bg-purple-500' },
  shell:      { label: '命令执行', Icon: Terminal, color: 'text-danger', bg: 'bg-danger/10', dot: 'bg-danger' },
  browser:    { label: '浏览器',   Icon: Compass, color: 'text-cyan-600 dark:text-cyan-300', bg: 'bg-cyan-50 dark:bg-cyan-950/40', dot: 'bg-cyan-500' },
  mcp:        { label: 'MCP 工具', Icon: Star, color: 'text-indigo-600 dark:text-indigo-300', bg: 'bg-indigo-50 dark:bg-indigo-950/40', dot: 'bg-indigo-500' },
  skill:      { label: '技能调用', Icon: Zap, color: 'text-success', bg: 'bg-success/10', dot: 'bg-success' },
};

interface StatusEntry { label: string; Icon: LucideIcon; color: string; }

const STATUS_CONFIG: Record<string, StatusEntry> = {
  success: { label: '成功', Icon: Check, color: 'text-success' },
  error:   { label: '错误', Icon: AlertTriangle, color: 'text-danger' },
  denied:  { label: '拒绝', Icon: XIcon, color: 'text-warning' },
  timeout: { label: '超时', Icon: Clock, color: 'text-warning' },
};

// ─── 类型 ───

interface PermissionRecord { id: string; category: string; resource: string; scope: string; grantedAt: string; }
interface AuditLogEntry { id: string; toolName: string; status: string; durationMs: number; createdAt: string; }
interface PermissionStats { total: number; byCategory: Record<string, number>; byScope: Record<string, number>; }
type TabKey = 'permissions' | 'audit' | 'guard';

// ─── Tab 配置 ───

const TABS: { key: TabKey; label: string; Icon: LucideIcon }[] = [
  { key: 'guard', label: '安全防护', Icon: Shield },
  { key: 'permissions', label: '已授权权限', Icon: ShieldCheck },
  { key: 'audit', label: '审计日志', Icon: FileText },
];


// ─── 主页面 ───

export default function SecurityPage() {
  const { agents } = useAgentStore();
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [activeTab, setActiveTab] = useState<TabKey>('guard');
  const [permissions, setPermissions] = useState<PermissionRecord[]>([]);
  const [stats, setStats] = useState<PermissionStats | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [auditOffset, setAuditOffset] = useState(0);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState<string | null>(null);
  const [auditFilter, setAuditFilter] = useState({ toolName: '', status: '' });
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const PAGE_SIZE = 20;

  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2500);
  }, []);

  useEffect(() => {
    if (agents.length > 0 && !selectedAgentId) setSelectedAgentId(agents[0].id);
  }, [agents, selectedAgentId]);

  const fetchPermissions = useCallback(async (agentId: string) => {
    if (!agentId) return;
    setLoading(true);
    try {
      const [permData, statsData] = await Promise.all([
        get<{ permissions: PermissionRecord[] }>(`/security/${agentId}/permissions`),
        get<PermissionStats>(`/security/${agentId}/permission-stats`),
      ]);
      setPermissions(permData.permissions ?? []);
      setStats(statsData);
    } catch { setPermissions([]); setStats(null); }
    finally { setLoading(false); }
  }, []);

  const fetchAuditLogs = useCallback(async (agentId: string, offset = 0, append = false) => {
    if (!agentId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
      if (auditFilter.toolName) params.set('toolName', auditFilter.toolName);
      if (auditFilter.status) params.set('status', auditFilter.status);
      const data = await get<{ entries: AuditLogEntry[]; total: number }>(`/security/${agentId}/audit-log?${params}`);
      const logs = data.entries ?? [];
      setAuditLogs(prev => append ? [...prev, ...logs] : logs);
      setHasMore(offset + logs.length < (data.total ?? 0));
      setAuditOffset(offset + logs.length);
    } catch { if (!append) setAuditLogs([]); setHasMore(false); }
    finally { setLoading(false); }
  }, [auditFilter]);

  useEffect(() => {
    if (!selectedAgentId) return;
    if (activeTab === 'permissions') { fetchPermissions(selectedAgentId); setSelectedIds(new Set()); }
    else if (activeTab === 'audit') { setAuditOffset(0); fetchAuditLogs(selectedAgentId, 0); }
  }, [selectedAgentId, activeTab, fetchPermissions, fetchAuditLogs]);

  const handleRevoke = useCallback(async (permissionId: string) => {
    if (revoking !== permissionId) { setRevoking(permissionId); return; }
    try {
      const revokedPerm = permissions.find(p => p.id === permissionId);
      await del(`/security/${selectedAgentId}/permissions/${permissionId}`);
      setPermissions(prev => prev.filter(p => p.id !== permissionId));
      setSelectedIds(prev => { const n = new Set(prev); n.delete(permissionId); return n; });
      if (revokedPerm) invoke('revoke_permission', { agentId: selectedAgentId, category: revokedPerm.category }).catch(() => {});
      showToast('权限已撤销');
    } catch { showToast('撤销失败', 'error'); }
    finally { setRevoking(null); }
  }, [selectedAgentId, revoking, permissions, showToast]);

  const handleBulkRevoke = useCallback(async (mode: 'selected' | 'session' | 'always') => {
    if (bulkConfirm !== mode) { setBulkConfirm(mode); return; }
    try {
      if (mode === 'selected') await post(`/security/${selectedAgentId}/permissions/bulk-revoke`, { ids: Array.from(selectedIds) });
      else await post(`/security/${selectedAgentId}/permissions/bulk-revoke`, { scope: mode });
      await fetchPermissions(selectedAgentId);
      setSelectedIds(new Set());
      syncPermissionsToRust().catch(() => {});
      showToast('批量撤销完成');
    } catch { showToast('批量撤销失败', 'error'); }
    finally { setBulkConfirm(null); }
  }, [selectedAgentId, selectedIds, bulkConfirm, fetchPermissions, showToast]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  }, []);
  const toggleSelectAll = useCallback(() => {
    setSelectedIds(prev => prev.size === permissions.length ? new Set() : new Set(permissions.map(p => p.id)));
  }, [permissions]);

  const formatTime = (iso: string) => {
    try {
      const d = (iso.endsWith('Z') || iso.includes('+') || iso.includes('T')) ? new Date(iso) : new Date(iso + 'Z');
      return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  };
  const formatDuration = (ms: number) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

  return (
    <div className="h-full flex flex-col bg-muted/50">
      {/* ─── 顶栏 ─── */}
      <div className="px-6 pt-5 pb-4 bg-card border-b border-border/60">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand/20 to-brand/5 flex items-center justify-center">
              <ShieldCheck className="w-5 h-5 text-brand" strokeWidth={1.5} aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-foreground">安全中心</h2>
              <p className="text-xs text-muted-foreground mt-0.5">管理 Agent 权限、审计日志与安全策略</p>
            </div>
          </div>
          <AgentSelect agents={agents} value={selectedAgentId} onChange={setSelectedAgentId} />
        </div>

        {/* Tab */}
        <div className="flex gap-1 bg-accent/80 p-1 rounded-xl">
          {TABS.map(({ key, label, Icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 flex-1 justify-center px-3 py-2 text-sm font-medium rounded-lg transition-all duration-150 ${
                activeTab === key
                  ? 'bg-card text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Icon className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── 内容 ─── */}
      <div className="flex-1 overflow-y-auto">
        {!selectedAgentId ? (
          <EmptyState Icon={Users} title="请先创建一个 Agent" desc="在专家中心创建后即可管理安全设置" />
        ) : loading && (activeTab === 'permissions' ? !permissions.length : !auditLogs.length) ? (
          <div className="flex items-center justify-center h-64"><span className="w-6 h-6 border-2 border-border border-t-brand rounded-full animate-spin" /></div>
        ) : activeTab === 'permissions' ? (
          <PermissionsTab
            permissions={permissions} stats={stats} selectedIds={selectedIds} revoking={revoking}
            bulkConfirm={bulkConfirm} onRevoke={handleRevoke} onBulkRevoke={handleBulkRevoke}
            onToggle={toggleSelect} onToggleAll={toggleSelectAll}
            onCancel={() => { setRevoking(null); setBulkConfirm(null); }}
            formatTime={formatTime}
          />
        ) : activeTab === 'audit' ? (
          <AuditTab
            logs={auditLogs} filter={auditFilter} hasMore={hasMore} loading={loading}
            onFilterChange={(f) => { setAuditFilter(f); setAuditOffset(0); }}
            onSearch={() => selectedAgentId && fetchAuditLogs(selectedAgentId, 0)}
            onLoadMore={() => selectedAgentId && fetchAuditLogs(selectedAgentId, auditOffset, true)}
            formatTime={formatTime} formatDuration={formatDuration}
          />
        ) : (
          <GuardTab />
        )}
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium shadow-lg shadow-foreground/10 transition-all ${
          toast.type === 'success' ? 'bg-foreground text-background' : 'bg-danger text-white'
        }`}>
          {toast.type === 'success' ? <Check className="w-4 h-4" strokeWidth={2} aria-hidden="true" /> : <XIcon className="w-4 h-4" strokeWidth={2} aria-hidden="true" />}
          {toast.message}
        </div>
      )}
    </div>
  );
}

// ─── 空状态 ───

function EmptyState({ Icon, title, desc }: { Icon: LucideIcon; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6">
      <div className="w-16 h-16 rounded-2xl bg-accent flex items-center justify-center mb-4">
        <Icon className="w-8 h-8 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
      </div>
      <p className="text-base font-medium text-muted-foreground">{title}</p>
      <p className="text-sm text-muted-foreground mt-1">{desc}</p>
    </div>
  );
}

// ─── 权限 Tab ───

function PermissionsTab({ permissions, stats, selectedIds, revoking, bulkConfirm, onRevoke, onBulkRevoke, onToggle, onToggleAll, onCancel, formatTime }: {
  permissions: PermissionRecord[]; stats: PermissionStats | null;
  selectedIds: Set<string>; revoking: string | null; bulkConfirm: string | null;
  onRevoke: (id: string) => void; onBulkRevoke: (m: 'selected' | 'session' | 'always') => void;
  onToggle: (id: string) => void; onToggleAll: () => void; onCancel: () => void;
  formatTime: (s: string) => string;
}) {
  const [filterCategory, setFilterCategory] = useState<string>('all');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const toggleCollapse = useCallback((cat: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }, []);

  // 按过滤器筛选
  const filteredPermissions = filterCategory === 'all'
    ? permissions
    : permissions.filter(p => p.category === filterCategory);

  // 按类别分组
  const grouped = new Map<string, PermissionRecord[]>();
  for (const perm of filteredPermissions) {
    if (!grouped.has(perm.category)) grouped.set(perm.category, []);
    grouped.get(perm.category)!.push(perm);
  }

  return (
    <div className="w-full px-6 py-6 space-y-5">
      {/* 类别卡片（过滤器 + 统计） */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilterCategory('all')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
            filterCategory === 'all'
              ? 'bg-foreground text-background border-foreground'
              : 'bg-card text-muted-foreground border-border hover:border-border'
          }`}
        >
          全部
          <span className={`px-1.5 py-0.5 rounded-md text-xs ${
            filterCategory === 'all' ? 'bg-card/20 text-white' : 'bg-accent text-muted-foreground'
          }`}>{permissions.length}</span>
        </button>
        {Object.entries(CATEGORY_CONFIG).map(([cat, cfg]) => {
          const count = stats?.byCategory[cat] ?? 0;
          const isActive = filterCategory === cat;
          return (
            <button
              key={cat}
              onClick={() => setFilterCategory(isActive ? 'all' : cat)}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium border transition-all ${
                isActive
                  ? `${cfg.bg} ${cfg.color} border-current/20`
                  : count > 0
                    ? 'bg-card text-muted-foreground border-border hover:border-border'
                    : 'bg-card text-muted-foreground border-border'
              }`}
            >
              <cfg.Icon className="w-3.5 h-3.5" strokeWidth={1.5} aria-hidden="true" />
              {cfg.label}
              <span className={`px-1.5 py-0.5 rounded-md text-xs ${
                isActive ? 'bg-card/50' : count > 0 ? 'bg-accent text-muted-foreground' : 'bg-muted text-muted-foreground'
              }`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* 操作栏 */}
      {filteredPermissions.length > 0 && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <input type="checkbox"
                checked={filteredPermissions.length > 0 && filteredPermissions.every(p => selectedIds.has(p.id))}
                onChange={() => {
                  const filteredIds = filteredPermissions.map(p => p.id);
                  const allSelected = filteredIds.every(id => selectedIds.has(id));
                  if (allSelected) {
                    // 取消选中当前筛选的
                    const next = new Set(selectedIds);
                    filteredIds.forEach(id => next.delete(id));
                    onToggleAll(); // 这里简化处理，全选/全不选
                  } else {
                    onToggleAll();
                  }
                }}
                className="rounded border-border text-brand focus:ring-brand/30" />
              {selectedIds.size > 0 ? `已选 ${selectedIds.size} 项` : '全选'}
            </label>
            {selectedIds.size > 0 && (
              <>
                <div className="w-px h-4 bg-accent" />
                <button
                  onClick={() => onBulkRevoke('selected')}
                  className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                    bulkConfirm === 'selected' ? 'bg-danger text-white' : 'text-danger hover:bg-danger/10'
                  }`}
                >
                  {bulkConfirm === 'selected' ? `确认撤销 ${selectedIds.size} 条` : '撤销选中'}
                </button>
                {bulkConfirm === 'selected' && (
                  <button onClick={onCancel} className="text-xs text-muted-foreground hover:text-muted-foreground transition-colors">取消</button>
                )}
              </>
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {filterCategory !== 'all' ? `${filteredPermissions.length} / ` : ''}{permissions.length} 条权限
          </span>
        </div>
      )}

      {/* 空状态 */}
      {filteredPermissions.length === 0 && (
        <EmptyState
          Icon={ShieldCheck}
          title={filterCategory === 'all' ? '暂无已授权权限' : `暂无${CATEGORY_CONFIG[filterCategory]?.label ?? ''}权限`}
          desc="Agent 请求权限后将在此处显示"
        />
      )}

      {/* 按类别分组 + 可折叠 */}
      <div className="space-y-4">
        {Array.from(grouped.entries()).map(([cat, perms]) => {
          const cfg: CategoryEntry = CATEGORY_CONFIG[cat] ?? { label: cat, Icon: Shield, color: 'text-muted-foreground', bg: 'bg-muted', dot: 'bg-muted-foreground' };
          const collapsed = collapsedGroups.has(cat);
          return (
            <div key={cat} className="bg-card rounded-2xl border border-border/60 overflow-hidden">
              {/* 分组标题（可点击折叠） */}
              <button
                onClick={() => toggleCollapse(cat)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors"
              >
                <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${collapsed ? '' : 'rotate-90'}`} strokeWidth={2} aria-hidden="true" />
                <div className={`w-7 h-7 rounded-lg ${cfg.bg} flex items-center justify-center`}>
                  <cfg.Icon className={`w-3.5 h-3.5 ${cfg.color}`} strokeWidth={1.5} aria-hidden="true" />
                </div>
                <span className={`text-sm font-semibold ${cfg.color}`}>{cfg.label}</span>
                <span className="ml-auto text-xs text-muted-foreground">{perms.length} 条</span>
              </button>

              {/* 权限条目（折叠内容） */}
              {!collapsed && (
                <div className="border-t border-border">
                  {perms.map((perm, idx) => {
                    const isConfirming = revoking === perm.id;
                    return (
                      <div key={perm.id} className={`group flex items-center gap-3 px-4 py-3 transition-all duration-150 ${
                        idx > 0 ? 'border-t border-border' : ''
                      } ${selectedIds.has(perm.id) ? 'bg-brand/[0.02]' : 'hover:bg-muted/50'}`}>
                        <input type="checkbox" checked={selectedIds.has(perm.id)} onChange={() => onToggle(perm.id)}
                          className="rounded border-border text-brand focus:ring-brand/30 shrink-0 ml-7" />
                        <div className="flex-1 min-w-0">
                          <span className="text-sm text-foreground">
                            {perm.resource === '*' ? '所有操作' : perm.resource}
                          </span>
                        </div>
                        <span className="text-xs text-muted-foreground shrink-0">{formatTime(perm.grantedAt)}</span>
                        <div className="shrink-0 w-16 text-right">
                          {isConfirming ? (
                            <div className="inline-flex items-center gap-1.5">
                              <button onClick={() => onRevoke(perm.id)}
                                className="px-2.5 py-1 text-xs font-medium rounded-lg bg-danger text-white hover:bg-danger transition-colors">
                                确认
                              </button>
                              <button onClick={onCancel}
                                className="px-2 py-1 text-xs text-muted-foreground hover:bg-accent rounded-lg transition-colors">
                                取消
                              </button>
                            </div>
                          ) : (
                            <button onClick={() => onRevoke(perm.id)}
                              className="px-2.5 py-1 text-xs font-medium rounded-lg text-muted-foreground
                                opacity-0 group-hover:opacity-100 hover:text-danger hover:bg-danger/10 transition-all">
                              撤销
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 审计日志 Tab ───

/** 工具名称美化 */
const TOOL_DISPLAY: Record<string, { label: string; Icon: LucideIcon }> = {
  bash: { label: 'Shell', Icon: Terminal },
  read: { label: 'Read', Icon: FileText },
  write: { label: 'Write', Icon: FilePen },
  edit: { label: 'Edit', Icon: FilePen },
  grep: { label: 'Grep', Icon: Search },
  find: { label: 'Find', Icon: Search },
  ls: { label: 'List', Icon: ListChecks },
  web_search: { label: 'Search', Icon: Globe },
  web_fetch: { label: 'Fetch', Icon: Compass },
  image: { label: 'Image', Icon: ImageIcon },
  pdf: { label: 'PDF', Icon: FileText },
};

function AuditTab({ logs, filter, hasMore, loading, onFilterChange, onSearch, onLoadMore, formatTime, formatDuration }: {
  logs: AuditLogEntry[]; filter: { toolName: string; status: string }; hasMore: boolean; loading: boolean;
  onFilterChange: (f: { toolName: string; status: string }) => void;
  onSearch: () => void; onLoadMore: () => void;
  formatTime: (s: string) => string; formatDuration: (ms: number) => string;
}) {
  // 按状态统计
  const statusCounts = { all: logs.length, success: 0, error: 0, denied: 0, timeout: 0 };
  for (const l of logs) {
    if (l.status in statusCounts) (statusCounts as any)[l.status]++;
  }

  return (
    <div className="w-full px-6 py-6 space-y-5">
      {/* 状态过滤标签 + 搜索 */}
      <div className="flex items-center gap-3">
        <div className="flex gap-1.5 flex-1">
          {([
            { key: '', label: '全部', count: statusCounts.all },
            { key: 'success', label: '成功', count: statusCounts.success },
            { key: 'denied', label: '拒绝', count: statusCounts.denied },
            { key: 'error', label: '错误', count: statusCounts.error },
          ] as { key: string; label: string; count: number }[]).map(({ key, label, count }) => {
            const active = filter.status === key;
            const sCfg = key ? STATUS_CONFIG[key] : null;
            return (
              <button
                key={key}
                onClick={() => { onFilterChange({ ...filter, status: active ? '' : key }); setTimeout(onSearch, 0); }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  active
                    ? 'bg-foreground text-background'
                    : count > 0
                      ? 'bg-card border border-border text-muted-foreground hover:border-border'
                      : 'bg-card border border-border text-muted-foreground'
                }`}
              >
                {sCfg && <sCfg.Icon className="w-3 h-3" strokeWidth={1.5} aria-hidden="true" />}
                {label}
                {count > 0 && (
                  <span className={`px-1.5 py-0.5 rounded text-xs ${active ? 'bg-card/20' : 'bg-accent text-muted-foreground'}`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* 搜索框 */}
        <div className="relative w-56">
          <Search className="w-3.5 h-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" strokeWidth={1.5} aria-hidden="true" />
          <input
            value={filter.toolName}
            onChange={(e) => onFilterChange({ ...filter, toolName: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
            placeholder="搜索工具..."
            className="w-full pl-8 pr-3 py-1.5 text-xs border border-border rounded-lg bg-card
              focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/40
              placeholder:text-muted-foreground transition-all"
          />
        </div>
      </div>

      {logs.length === 0 ? (
        <EmptyState Icon={FileText} title="暂无审计日志" desc="Agent 执行工具调用后将在此处记录" />
      ) : (
        <div className="bg-card rounded-2xl border border-border/60 overflow-hidden">
          {/* 表头 */}
          <div className="grid grid-cols-[1fr_100px_80px_110px] gap-3 px-5 py-2.5 bg-muted/80 border-b border-border
            text-xs font-medium text-muted-foreground uppercase tracking-wider">
            <span>工具调用</span>
            <span className="text-center">状态</span>
            <span className="text-right">耗时</span>
            <span className="text-right">时间</span>
          </div>

          {/* 日志行 */}
          {logs.map((entry, idx) => {
            const sCfg: StatusEntry = STATUS_CONFIG[entry.status] ?? { label: entry.status, Icon: Shield, color: 'text-muted-foreground' };
            const toolInfo = TOOL_DISPLAY[entry.toolName];
            const statusBg = entry.status === 'success' ? 'bg-success/10' : entry.status === 'error' ? 'bg-danger/10' : entry.status === 'denied' ? 'bg-warning/10' : 'bg-muted';
            return (
              <div key={entry.id} className={`grid grid-cols-[1fr_100px_80px_110px] gap-3 items-center
                px-5 py-3 hover:bg-muted/50 transition-colors ${idx > 0 ? 'border-t border-border' : ''}`}>
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shrink-0">
                    {(() => {
                      const ToolIcon = toolInfo?.Icon ?? Star;
                      return <ToolIcon className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />;
                    })()}
                  </div>
                  <div className="min-w-0">
                    <span className="text-sm font-medium text-foreground">{toolInfo?.label ?? entry.toolName}</span>
                    {toolInfo && toolInfo.label !== entry.toolName && (
                      <span className="text-xs text-muted-foreground ml-1.5 font-mono">{entry.toolName}</span>
                    )}
                  </div>
                </div>
                <div className="flex justify-center">
                  <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium ${statusBg} ${sCfg.color}`}>
                    <sCfg.Icon className="w-3 h-3" strokeWidth={1.5} aria-hidden="true" />
                    {sCfg.label}
                  </span>
                </div>
                <span className="text-xs text-muted-foreground text-right font-mono tabular-nums">{formatDuration(entry.durationMs)}</span>
                <span className="text-xs text-muted-foreground text-right">{formatTime(entry.createdAt)}</span>
              </div>
            );
          })}
        </div>
      )}

      {hasMore && (
        <div className="text-center">
          <button onClick={onLoadMore} disabled={loading}
            className="px-6 py-2.5 text-sm font-medium text-muted-foreground bg-card border border-border
              rounded-xl hover:bg-muted disabled:opacity-50 transition-colors">
            {loading ? '加载中...' : '加载更多'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── 安全防护 Tab ───

const GUARD_FEATURES: { title: string; desc: string; color: string; bg: string; Icon: LucideIcon }[] = [
  { title: '危险命令检测', desc: '自动拦截 rm -rf、DROP TABLE、sudo 等 11 种危险操作模式', color: 'text-danger', bg: 'bg-danger/10', Icon: AlertTriangle },
  { title: '受限路径保护', desc: '禁止访问 /etc、~/.ssh、/System 等 8 类系统敏感路径', color: 'text-purple-600 dark:text-purple-300', bg: 'bg-purple-50 dark:bg-purple-950/40', Icon: KeyRound },
  { title: '消息发送确认', desc: '邮件、Slack、微信等 7 种消息类工具强制用户确认', color: 'text-warning', bg: 'bg-warning/10', Icon: ShieldAlert },
  { title: '循环检测与熔断', desc: '重复/乒乓/无进展 3 种模式检测，阈值 30 次自动熔断', color: 'text-success', bg: 'bg-success/10', Icon: ShieldX },
];

const GUARD_PROTECTIONS: { id: string; Icon: LucideIcon; iconColor: string; iconBg: string; title: string; tag: string; tagStyle: string; desc: string }[] = [
  {
    id: 'env',
    Icon: ShieldCheck,
    iconColor: 'text-warning',
    iconBg: 'bg-warning/10',
    title: '电脑环境安全防护',
    tag: '主动防御',
    tagStyle: 'border-warning/30 text-warning bg-warning/10',
    desc: '当智能体调用各类工具时，系统会进行全过程的安全管控。识别并拦截可能破坏系统、窃取数据、尝试提权的高风险行为，保障您的电脑环境安全。',
  },
  {
    id: 'info',
    Icon: KeyRound,
    iconColor: 'text-brand',
    iconBg: 'bg-brand/10',
    title: '用户信息安全保护',
    tag: '智能识别',
    tagStyle: 'border-success/30 text-success bg-success/10',
    desc: '对输入给智能体的任务、提示词进行智能安全识别，自动检测是否包含个人隐私、敏感密钥、账号凭证等高风险信息，保障用户信息安全。',
  },
  {
    id: 'skill',
    Icon: Wrench,
    iconColor: 'text-teal-500',
    iconBg: 'bg-teal-50',
    title: 'Skill 技能安全扫描',
    tag: '多层检测',
    tagStyle: 'border-teal-200 text-teal-600 bg-teal-50',
    desc: '所有 Skill 在安装和接入前，系统都会进行多层安全检测，包括来源可信度、代码审查、权限评估等，确保所有接入的技能纯净无害。',
  },
];

/** 权限模式配置 */
const PERMISSION_MODES: { key: 'default' | 'strict' | 'permissive'; label: string; desc: string; Icon: LucideIcon; color: string; bg: string; ring: string }[] = [
  {
    key: 'default',
    label: '标准模式',
    desc: '工具执行前需要用户确认授权，提供安全与效率的平衡',
    Icon: ShieldCheck,
    color: 'text-brand', bg: 'bg-brand/10', ring: 'ring-brand/30',
  },
  {
    key: 'strict',
    label: '严格模式',
    desc: '未明确授权的操作自动拒绝，适合生产环境和无人值守场景',
    Icon: ShieldX,
    color: 'text-danger', bg: 'bg-danger/10', ring: 'ring-danger/40',
  },
  {
    key: 'permissive',
    label: '宽松模式',
    desc: '工作区内的文件修改和命令执行自动放行，适合开发测试',
    Icon: ZapIcon,
    color: 'text-warning', bg: 'bg-warning/10', ring: 'ring-warning/50',
  },
];

function GuardTab() {
  const enabledMap: Record<string, boolean> = { env: true, info: true, skill: true };
  const [permissionMode, setPermissionMode] = useState<'default' | 'strict' | 'permissive'>('default');
  const [saving, setSaving] = useState(false);

  // 加载全局权限模式
  useEffect(() => {
    get<{ config: { permissionMode?: string } }>('/config')
      .then((data) => {
        const mode = data.config?.permissionMode;
        if (mode === 'default' || mode === 'strict' || mode === 'permissive') {
          setPermissionMode(mode);
        }
      })
      .catch(() => {});
  }, []);

  const handleModeChange = async (mode: 'default' | 'strict' | 'permissive') => {
    setPermissionMode(mode);
    setSaving(true);
    try {
      await put('/config', { permissionMode: mode });
    } catch { /* 静默失败 */ }
    setSaving(false);
  };

  return (
    <div className="w-full px-6 py-6 space-y-5">
      {/* 权限模式选择 */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Sliders className="w-5 h-5 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
          <h3 className="text-sm font-bold text-foreground">权限模式</h3>
          {saving && <span className="text-xs text-muted-foreground animate-pulse">保存中...</span>}
        </div>
        <div className="grid grid-cols-3 gap-3">
          {PERMISSION_MODES.map((m) => {
            const active = permissionMode === m.key;
            return (
              <button
                key={m.key}
                onClick={() => handleModeChange(m.key)}
                className={`relative p-4 rounded-xl border text-left transition-all ${
                  active
                    ? `border-transparent ring-2 ${m.ring} ${m.bg}`
                    : 'border-border/60 bg-card hover:border-border'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-8 h-8 rounded-lg ${m.bg} flex items-center justify-center`}>
                    <m.Icon className={`w-4 h-4 ${m.color}`} strokeWidth={1.5} aria-hidden="true" />
                  </div>
                  <span className={`text-sm font-semibold ${active ? m.color : 'text-foreground'}`}>{m.label}</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">{m.desc}</p>
                {active && (
                  <div className="absolute top-2.5 right-2.5">
                    <CheckCircle2 className={`w-5 h-5 ${m.color}`} strokeWidth={1.5} aria-hidden="true" />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 防护开关卡片 */}
      <div className="space-y-3">
        {GUARD_PROTECTIONS.map((item) => {
          const enabled = enabledMap[item.id] ?? true;
          return (
            <div key={item.id} className="bg-card rounded-2xl border border-border/60 p-5 hover:border-border transition-all">
              <div className="flex items-start gap-4">
                <div className={`w-11 h-11 rounded-xl ${item.iconBg} flex items-center justify-center shrink-0`}>
                  <item.Icon className={`w-5 h-5 ${item.iconColor}`} strokeWidth={1.5} aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <h3 className="text-sm font-bold text-foreground">{item.title}</h3>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${item.tagStyle}`}>
                      <Check className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
                      {item.tag}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">{item.desc}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0 pt-0.5">
                  <div className={`relative w-11 h-6 rounded-full bg-brand cursor-default`}>
                    <span className="absolute top-0.5 left-[22px] w-5 h-5 bg-card rounded-full shadow-sm" />
                  </div>
                  <span className={`inline-flex items-center gap-1 text-xs font-medium ${enabled ? 'text-brand' : 'text-muted-foreground'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-brand' : 'bg-border'}`} />
                    {enabled ? '保护中' : '已关闭'}
                  </span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* 安全策略 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {GUARD_FEATURES.map((f) => (
          <div key={f.title} className="bg-card rounded-xl border border-border/60 p-4 hover:border-border transition-colors">
            <div className="flex items-center gap-2.5 mb-2.5">
              <div className={`w-8 h-8 rounded-lg ${f.bg} flex items-center justify-center shrink-0`}>
                <f.Icon className={`w-4 h-4 ${f.color}`} strokeWidth={1.5} aria-hidden="true" />
              </div>
              <span className="text-sm font-semibold text-foreground">{f.title}</span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>

      {/* 底部安全提示 */}
      <div className="flex items-center justify-center gap-2 pt-2 text-muted-foreground">
        <ShieldCheck className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
        <span className="text-sm">您的每一次操作都在系统严格保护之下</span>
      </div>
    </div>
  );
}
