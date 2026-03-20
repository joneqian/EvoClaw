import { useState, useEffect, useCallback } from 'react';
import { useAgentStore } from '../stores/agent-store';
import AgentSelect from '../components/AgentSelect';
import { get, del, post } from '../lib/api';
import { syncPermissionsToRust } from '../lib/api';
import { invoke } from '@tauri-apps/api/core';

// ─── 配置 ───

const CATEGORY_CONFIG: Record<string, { label: string; icon: string; color: string; bg: string; dot: string }> = {
  file_read:  { label: '文件读取', icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z', color: 'text-blue-600', bg: 'bg-blue-50', dot: 'bg-blue-500' },
  file_write: { label: '文件修改', icon: 'M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10', color: 'text-orange-600', bg: 'bg-orange-50', dot: 'bg-orange-500' },
  network:    { label: '网络访问', icon: 'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418', color: 'text-purple-600', bg: 'bg-purple-50', dot: 'bg-purple-500' },
  shell:      { label: '命令执行', icon: 'M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z', color: 'text-red-600', bg: 'bg-red-50', dot: 'bg-red-500' },
  browser:    { label: '浏览器',   icon: 'M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3', color: 'text-cyan-600', bg: 'bg-cyan-50', dot: 'bg-cyan-500' },
  mcp:        { label: 'MCP 工具', icon: 'M11.42 15.17l-5.658 3.286a1.125 1.125 0 01-1.674-1.087l1.058-6.3L.343 6.37a1.125 1.125 0 01.638-1.92l6.328-.924L10.14.706a1.125 1.125 0 012.02 0l2.83 5.82 6.328.924a1.125 1.125 0 01.638 1.92l-4.797 4.7 1.058 6.3a1.125 1.125 0 01-1.674 1.087L12 15.17z', color: 'text-indigo-600', bg: 'bg-indigo-50', dot: 'bg-indigo-500' },
  skill:      { label: '技能调用', icon: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z', color: 'text-green-600', bg: 'bg-green-50', dot: 'bg-green-500' },
};

const STATUS_CONFIG: Record<string, { label: string; icon: string; color: string }> = {
  success: { label: '成功', icon: 'M4.5 12.75l6 6 9-13.5', color: 'text-emerald-500' },
  error:   { label: '错误', icon: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z', color: 'text-red-500' },
  denied:  { label: '拒绝', icon: 'M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636', color: 'text-amber-500' },
  timeout: { label: '超时', icon: 'M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z', color: 'text-orange-500' },
};

// ─── 类型 ───

interface PermissionRecord { id: string; category: string; resource: string; scope: string; grantedAt: string; }
interface AuditLogEntry { id: string; toolName: string; status: string; durationMs: number; createdAt: string; }
interface PermissionStats { total: number; byCategory: Record<string, number>; byScope: Record<string, number>; }
type TabKey = 'permissions' | 'audit' | 'guard';

// ─── 小图标组件 ───

function Icon({ d, className = 'w-4 h-4' }: { d: string; className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d={d} />
    </svg>
  );
}

// ─── Tab 配置 ───

const TABS: { key: TabKey; label: string; icon: string }[] = [
  { key: 'guard', label: '安全防护', icon: 'M12 9v3.75m0-10.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.75c0 5.592 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.75h-.152c-3.196 0-6.1-1.249-8.25-3.286zM12 15.75h.007v.008H12v-.008z' },
  { key: 'permissions', label: '已授权权限', icon: 'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z' },
  { key: 'audit', label: '审计日志', icon: 'M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z' },
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
    <div className="h-full flex flex-col bg-slate-50/50">
      {/* ─── 顶栏 ─── */}
      <div className="px-6 pt-5 pb-4 bg-white border-b border-slate-200/60">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand/20 to-brand/5 flex items-center justify-center">
              <Icon d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" className="w-5 h-5 text-brand" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">安全中心</h2>
              <p className="text-xs text-slate-400 mt-0.5">管理 Agent 权限、审计日志与安全策略</p>
            </div>
          </div>
          <AgentSelect agents={agents} value={selectedAgentId} onChange={setSelectedAgentId} />
        </div>

        {/* Tab */}
        <div className="flex gap-1 bg-slate-100/80 p-1 rounded-xl">
          {TABS.map(({ key, label, icon }) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`flex items-center gap-1.5 flex-1 justify-center px-3 py-2 text-sm font-medium rounded-lg transition-all duration-150 ${
                activeTab === key
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon d={icon} className="w-4 h-4" />
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ─── 内容 ─── */}
      <div className="flex-1 overflow-y-auto">
        {!selectedAgentId ? (
          <EmptyState icon="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" title="请先创建一个 Agent" desc="在专家中心创建后即可管理安全设置" />
        ) : loading && (activeTab === 'permissions' ? !permissions.length : !auditLogs.length) ? (
          <div className="flex items-center justify-center h-64"><span className="w-6 h-6 border-2 border-slate-200 border-t-brand rounded-full animate-spin" /></div>
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
        <div className={`fixed bottom-6 right-6 flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium shadow-lg shadow-slate-900/10 transition-all ${
          toast.type === 'success' ? 'bg-slate-900 text-white' : 'bg-red-500 text-white'
        }`}>
          <Icon d={toast.type === 'success' ? 'M4.5 12.75l6 6 9-13.5' : 'M6 18L18 6M6 6l12 12'} className="w-4 h-4" />
          {toast.message}
        </div>
      )}
    </div>
  );
}

// ─── 空状态 ───

function EmptyState({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center px-6">
      <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
        <Icon d={icon} className="w-8 h-8 text-slate-300" />
      </div>
      <p className="text-base font-medium text-slate-500">{title}</p>
      <p className="text-sm text-slate-400 mt-1">{desc}</p>
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
  if (!permissions.length) {
    return <EmptyState icon="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" title="暂无已授权权限" desc="Agent 请求权限后将在此处显示" />;
  }

  return (
    <div className="w-full px-6 py-6 space-y-5">
      {/* 统计卡片 — 始终显示所有类别 */}
      <div className="grid grid-cols-4 lg:grid-cols-8 gap-2">
        <div className="bg-white rounded-xl border border-slate-200/60 p-3 text-center">
          <p className="text-xl font-bold text-slate-900">{stats?.total ?? 0}</p>
          <p className="text-xs text-slate-400 mt-0.5">全部</p>
        </div>
        {Object.entries(CATEGORY_CONFIG).map(([cat, cfg]) => (
          <div key={cat} className={`rounded-xl border border-slate-200/60 p-3 text-center ${cfg.bg}`}>
            <p className={`text-xl font-bold ${stats?.byCategory[cat] ? cfg.color : 'text-slate-300'}`}>
              {stats?.byCategory[cat] ?? 0}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">{cfg.label}</p>
          </div>
        ))}
      </div>

      {/* 操作栏 */}
      {permissions.length > 0 && (
        <div className="flex items-center gap-3 bg-white rounded-xl border border-slate-200/60 px-4 py-2.5">
          <label className="flex items-center gap-2 text-xs text-slate-500 cursor-pointer select-none">
            <input type="checkbox" checked={selectedIds.size === permissions.length && permissions.length > 0} onChange={onToggleAll}
              className="rounded border-slate-300 text-brand focus:ring-brand/30" />
            {selectedIds.size > 0 ? `已选 ${selectedIds.size} 项` : '全选'}
          </label>
          {selectedIds.size > 0 && (
            <>
              <div className="w-px h-4 bg-slate-200" />
              <button
                onClick={() => onBulkRevoke('selected')}
                className={`px-3 py-1 text-xs font-medium rounded-lg transition-all ${
                  bulkConfirm === 'selected' ? 'bg-red-500 text-white' : 'text-red-500 hover:bg-red-50'
                }`}
              >
                {bulkConfirm === 'selected' ? `确认撤销 ${selectedIds.size} 条` : `撤销选中`}
              </button>
              {bulkConfirm === 'selected' && (
                <button onClick={onCancel} className="text-xs text-slate-400 hover:text-slate-600 transition-colors">取消</button>
              )}
            </>
          )}
        </div>
      )}

      {/* 权限列表 */}
      <div className="space-y-2">
        {permissions.map((perm) => {
          const cfg = CATEGORY_CONFIG[perm.category] ?? { label: perm.category, icon: '', color: 'text-slate-600', bg: 'bg-slate-50', dot: 'bg-slate-400' };
          const isConfirming = revoking === perm.id;
          return (
            <div key={perm.id} className={`group bg-white rounded-xl border transition-all duration-150 ${
              selectedIds.has(perm.id) ? 'border-brand/30 bg-brand/[0.02]' : 'border-slate-200/60 hover:border-slate-300'
            }`}>
              <div className="flex items-center gap-4 px-4 py-3.5">
                <input type="checkbox" checked={selectedIds.has(perm.id)} onChange={() => onToggle(perm.id)}
                  className="rounded border-slate-300 text-brand focus:ring-brand/30 shrink-0" />
                <div className={`w-9 h-9 rounded-lg ${cfg.bg} flex items-center justify-center shrink-0`}>
                  {cfg.icon && <Icon d={cfg.icon} className={`w-4.5 h-4.5 ${cfg.color}`} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${cfg.color}`}>{cfg.label}</span>
                    <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700">已允许</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="text-xs text-slate-500 font-mono truncate">{perm.resource}</code>
                    <span className="text-xs text-slate-300">|</span>
                    <span className="text-xs text-slate-400 shrink-0">{formatTime(perm.grantedAt)}</span>
                  </div>
                </div>
                <div className="shrink-0">
                  {isConfirming ? (
                    <div className="flex items-center gap-1.5">
                      <button onClick={() => onRevoke(perm.id)}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors">
                        确认
                      </button>
                      <button onClick={onCancel}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg text-slate-500 hover:bg-slate-100 transition-colors">
                        取消
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => onRevoke(perm.id)}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg text-slate-400
                        opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 transition-all">
                      撤销
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 审计日志 Tab ───

function AuditTab({ logs, filter, hasMore, loading, onFilterChange, onSearch, onLoadMore, formatTime, formatDuration }: {
  logs: AuditLogEntry[]; filter: { toolName: string; status: string }; hasMore: boolean; loading: boolean;
  onFilterChange: (f: { toolName: string; status: string }) => void;
  onSearch: () => void; onLoadMore: () => void;
  formatTime: (s: string) => string; formatDuration: (ms: number) => string;
}) {
  return (
    <div className="w-full px-6 py-6 space-y-4">
      {/* 过滤栏 */}
      <div className="flex items-center gap-2 bg-white rounded-xl border border-slate-200/60 p-3">
        <div className="relative flex-1">
          <Icon d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={filter.toolName}
            onChange={(e) => onFilterChange({ ...filter, toolName: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
            placeholder="搜索工具名称..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50
              focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/40 focus:bg-white
              placeholder:text-slate-400 transition-all"
          />
        </div>
        <select
          value={filter.status}
          onChange={(e) => onFilterChange({ ...filter, status: e.target.value })}
          className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-700
            focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand/40 transition-all"
        >
          <option value="">全部状态</option>
          <option value="success">成功</option>
          <option value="error">错误</option>
          <option value="denied">拒绝</option>
          <option value="timeout">超时</option>
        </select>
        <button onClick={onSearch}
          className="px-4 py-2 text-sm font-medium text-white bg-brand rounded-lg hover:bg-brand-hover transition-colors shadow-sm">
          筛选
        </button>
      </div>

      {logs.length === 0 ? (
        <EmptyState icon="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" title="暂无审计日志" desc="Agent 执行工具调用后将在此处记录" />
      ) : (
        <>
          {/* 表头 */}
          <div className="grid grid-cols-[1fr_80px_80px_100px] gap-4 px-4 text-xs font-medium text-slate-400 uppercase tracking-wider">
            <span>工具</span><span className="text-center">状态</span><span className="text-right">耗时</span><span className="text-right">时间</span>
          </div>

          {/* 日志列表 */}
          <div className="space-y-1">
            {logs.map((entry) => {
              const sCfg = STATUS_CONFIG[entry.status] ?? { label: entry.status, icon: '', color: 'text-slate-400' };
              return (
                <div key={entry.id} className="grid grid-cols-[1fr_80px_80px_100px] gap-4 items-center
                  bg-white rounded-xl border border-slate-200/60 px-4 py-3 hover:border-slate-300 transition-colors">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                      <Icon d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                    <span className="text-sm font-medium text-slate-800 truncate">{entry.toolName}</span>
                  </div>
                  <div className="flex justify-center">
                    <div className="flex items-center gap-1">
                      <Icon d={sCfg.icon} className={`w-3.5 h-3.5 ${sCfg.color}`} />
                      <span className={`text-xs font-medium ${sCfg.color}`}>{sCfg.label}</span>
                    </div>
                  </div>
                  <span className="text-xs text-slate-500 text-right font-mono">{formatDuration(entry.durationMs)}</span>
                  <span className="text-xs text-slate-400 text-right">{formatTime(entry.createdAt)}</span>
                </div>
              );
            })}
          </div>

          {hasMore && (
            <div className="text-center pt-2">
              <button onClick={onLoadMore} disabled={loading}
                className="px-6 py-2.5 text-sm font-medium text-slate-600 bg-white border border-slate-200
                  rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-colors">
                {loading ? '加载中...' : '加载更多'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── 安全防护 Tab ───

const GUARD_FEATURES = [
  { title: '危险命令检测', desc: '自动拦截 rm -rf、DROP TABLE、sudo 等 11 种危险操作模式', color: 'text-red-600', bg: 'bg-red-50', icon: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z' },
  { title: '受限路径保护', desc: '禁止访问 /etc、~/.ssh、/System 等 8 类系统敏感路径', color: 'text-purple-600', bg: 'bg-purple-50', icon: 'M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z' },
  { title: '消息发送确认', desc: '邮件、Slack、微信等 7 种消息类工具强制用户确认', color: 'text-amber-600', bg: 'bg-amber-50', icon: 'M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75' },
  { title: '循环检测与熔断', desc: '重复/乒乓/无进展 3 种模式检测，阈值 30 次自动熔断', color: 'text-emerald-600', bg: 'bg-emerald-50', icon: 'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99' },
];

const GUARD_PROTECTIONS = [
  {
    id: 'env',
    icon: 'M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z',
    iconColor: 'text-orange-500',
    iconBg: 'bg-orange-50',
    title: '电脑环境安全防护',
    tag: '主动防御',
    tagStyle: 'border-orange-200 text-orange-600 bg-orange-50',
    desc: '当智能体调用各类工具时，系统会进行全过程的安全管控。识别并拦截可能破坏系统、窃取数据、尝试提权的高风险行为，保障您的电脑环境安全。',
  },
  {
    id: 'info',
    icon: 'M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z',
    iconColor: 'text-brand',
    iconBg: 'bg-brand/10',
    title: '用户信息安全保护',
    tag: '智能识别',
    tagStyle: 'border-green-200 text-green-600 bg-green-50',
    desc: '对输入给智能体的任务、提示词进行智能安全识别，自动检测是否包含个人隐私、敏感密钥、账号凭证等高风险信息，保障用户信息安全。',
  },
  {
    id: 'skill',
    icon: 'M19.5 12c0-1.232-.046-2.453-.138-3.662a4.006 4.006 0 00-3.7-3.7 48.678 48.678 0 00-7.324 0 4.006 4.006 0 00-3.7 3.7c-.017.22-.032.441-.046.662M19.5 12l3-3m-3 3l-3-3m-12 3c0 1.232.046 2.453.138 3.662a4.006 4.006 0 003.7 3.7 48.656 48.656 0 007.324 0 4.006 4.006 0 003.7-3.7c.017-.22.032-.441.046-.662M4.5 12l3 3m-3-3l-3 3',
    iconColor: 'text-teal-500',
    iconBg: 'bg-teal-50',
    title: 'Skill 技能安全扫描',
    tag: '多层检测',
    tagStyle: 'border-teal-200 text-teal-600 bg-teal-50',
    desc: '所有 Skill 在安装和接入前，系统都会进行多层安全检测，包括来源可信度、代码审查、权限评估等，确保所有接入的技能纯净无害。',
  },
];

function GuardTab() {
  const enabledMap: Record<string, boolean> = { env: true, info: true, skill: true };

  return (
    <div className="w-full px-6 py-6 space-y-5">
      {/* 防护开关卡片 */}
      <div className="space-y-3">
        {GUARD_PROTECTIONS.map((item) => {
          const enabled = enabledMap[item.id] ?? true;
          return (
            <div key={item.id} className="bg-white rounded-2xl border border-slate-200/60 p-5 hover:border-slate-300 transition-all">
              <div className="flex items-start gap-4">
                <div className={`w-11 h-11 rounded-xl ${item.iconBg} flex items-center justify-center shrink-0`}>
                  <Icon d={item.icon} className={`w-5.5 h-5.5 ${item.iconColor}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <h3 className="text-sm font-bold text-slate-800">{item.title}</h3>
                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full border ${item.tagStyle}`}>
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75" />
                      </svg>
                      {item.tag}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 leading-relaxed">{item.desc}</p>
                </div>
                <div className="flex flex-col items-end gap-1.5 shrink-0 pt-0.5">
                  <div className={`relative w-11 h-6 rounded-full bg-brand cursor-default`}>
                    <span className="absolute top-0.5 left-[22px] w-5 h-5 bg-white rounded-full shadow-sm" />
                  </div>
                  <span className={`inline-flex items-center gap-1 text-xs font-medium ${enabled ? 'text-brand' : 'text-slate-400'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${enabled ? 'bg-brand' : 'bg-slate-300'}`} />
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
          <div key={f.title} className="bg-white rounded-xl border border-slate-200/60 p-4 hover:border-slate-300 transition-colors">
            <div className="flex items-center gap-2.5 mb-2.5">
              <div className={`w-8 h-8 rounded-lg ${f.bg} flex items-center justify-center shrink-0`}>
                <Icon d={f.icon} className={`w-4 h-4 ${f.color}`} />
              </div>
              <span className="text-sm font-semibold text-slate-800">{f.title}</span>
            </div>
            <p className="text-xs text-slate-500 leading-relaxed">{f.desc}</p>
          </div>
        ))}
      </div>

      {/* 底部安全提示 */}
      <div className="flex items-center justify-center gap-2 pt-2 text-slate-400">
        <Icon d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" className="w-4 h-4" />
        <span className="text-sm">您的每一次操作都在系统严格保护之下</span>
      </div>
    </div>
  );
}
