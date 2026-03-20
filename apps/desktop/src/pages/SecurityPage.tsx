import { useState, useEffect, useCallback } from 'react';
import { useAgentStore } from '../stores/agent-store';
import AgentSelect from '../components/AgentSelect';
import { get, del, post } from '../lib/api';
import { syncPermissionsToRust } from '../lib/api';
import { invoke } from '@tauri-apps/api/core';

/** 权限类别显示名称 */
const CATEGORY_LABELS: Record<string, string> = {
  file_read: '文件读取',
  file_write: '文件写入',
  network: '网络访问',
  shell: '命令执行',
  browser: '浏览器',
  mcp: 'MCP 工具',
  skill: '技能调用',
};

/** 权限类别颜色 */
const CATEGORY_COLORS: Record<string, string> = {
  file_read: 'bg-blue-100 text-blue-700',
  file_write: 'bg-orange-100 text-orange-700',
  network: 'bg-purple-100 text-purple-700',
  shell: 'bg-red-100 text-red-700',
  browser: 'bg-cyan-100 text-cyan-700',
  mcp: 'bg-indigo-100 text-indigo-700',
  skill: 'bg-green-100 text-green-700',
};

/** 作用域颜色 */
const SCOPE_STYLES: Record<string, { label: string; color: string }> = {
  once: { label: '仅本次', color: 'bg-blue-100 text-blue-700' },
  session: { label: '本次会话', color: 'bg-purple-100 text-purple-700' },
  always: { label: '始终允许', color: 'bg-green-100 text-green-700' },
  deny: { label: '始终拒绝', color: 'bg-red-100 text-red-700' },
};

/** 审计日志状态颜色 */
const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  success: { label: '成功', color: 'bg-green-100 text-green-700' },
  error: { label: '错误', color: 'bg-red-100 text-red-700' },
  denied: { label: '拒绝', color: 'bg-yellow-100 text-yellow-700' },
  timeout: { label: '超时', color: 'bg-orange-100 text-orange-700' },
};

/** 权限记录 */
interface PermissionRecord {
  id: string;
  category: string;
  resource: string;
  scope: string;
  grantedAt: string;
}

/** 审计日志记录 */
interface AuditLogEntry {
  id: string;
  toolName: string;
  status: string;
  durationMs: number;
  createdAt: string;
}

/** 权限统计 */
interface PermissionStats {
  total: number;
  byCategory: Record<string, number>;
  byScope: Record<string, number>;
}

/** 分类标签组件 */
function CategoryBadge({ category }: { category: string }) {
  const label = CATEGORY_LABELS[category] ?? category;
  const color = CATEGORY_COLORS[category] ?? 'bg-slate-100 text-slate-600';
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${color}`}>{label}</span>;
}

/** 作用域标签组件 */
function ScopeBadge({ scope }: { scope: string }) {
  const style = SCOPE_STYLES[scope] ?? { label: scope, color: 'bg-slate-100 text-slate-600' };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${style.color}`}>{style.label}</span>;
}

/** 状态标签组件 */
function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? { label: status, color: 'bg-slate-100 text-slate-600' };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${style.color}`}>{style.label}</span>;
}

/** Tab 类型 */
type TabKey = 'permissions' | 'audit' | 'guard';

/** 安全设置页面 */
export default function SecurityPage() {
  const { agents } = useAgentStore();

  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabKey>('permissions');
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

  /** 显示 toast */
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 2000);
  }, []);

  /** 初始化: 默认选中第一个 agent */
  useEffect(() => {
    if (agents.length > 0 && !selectedAgentId) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  /** 加载权限列表 + 统计 */
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
    } catch {
      setPermissions([]);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  /** 加载审计日志 */
  const fetchAuditLogs = useCallback(
    async (agentId: string, offset = 0, append = false) => {
      if (!agentId) return;
      setLoading(true);
      try {
        const params = new URLSearchParams({
          limit: String(PAGE_SIZE),
          offset: String(offset),
        });
        if (auditFilter.toolName) params.set('toolName', auditFilter.toolName);
        if (auditFilter.status) params.set('status', auditFilter.status);

        const data = await get<{ entries: AuditLogEntry[]; total: number }>(
          `/security/${agentId}/audit-log?${params}`,
        );
        const logs = data.entries ?? [];
        setAuditLogs((prev) => (append ? [...prev, ...logs] : logs));
        setHasMore(offset + logs.length < (data.total ?? 0));
        setAuditOffset(offset + logs.length);
      } catch {
        if (!append) setAuditLogs([]);
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    },
    [auditFilter],
  );

  /** 切换 agent 或 tab 时重新加载 */
  useEffect(() => {
    if (!selectedAgentId) return;
    if (activeTab === 'permissions') {
      fetchPermissions(selectedAgentId);
      setSelectedIds(new Set());
    } else if (activeTab === 'audit') {
      setAuditOffset(0);
      fetchAuditLogs(selectedAgentId, 0);
    }
  }, [selectedAgentId, activeTab, fetchPermissions, fetchAuditLogs]);

  /** 撤销权限 */
  const handleRevoke = useCallback(
    async (permissionId: string) => {
      if (revoking !== permissionId) {
        setRevoking(permissionId);
        return;
      }
      try {
        const revokedPerm = permissions.find(p => p.id === permissionId);
        await del(`/security/${selectedAgentId}/permissions/${permissionId}`);
        setPermissions((prev) => prev.filter((p) => p.id !== permissionId));
        setSelectedIds(prev => { const next = new Set(prev); next.delete(permissionId); return next; });
        if (revokedPerm) {
          invoke('revoke_permission', {
            agentId: selectedAgentId,
            category: revokedPerm.category,
          }).catch(() => {});
        }
        showToast('权限已撤销');
      } catch {
        showToast('撤销失败', 'error');
      } finally {
        setRevoking(null);
      }
    },
    [selectedAgentId, revoking, permissions, showToast],
  );

  /** 批量撤销 */
  const handleBulkRevoke = useCallback(async (mode: 'selected' | 'session' | 'always') => {
    if (bulkConfirm !== mode) {
      setBulkConfirm(mode);
      return;
    }
    try {
      if (mode === 'selected') {
        await post(`/security/${selectedAgentId}/permissions/bulk-revoke`, {
          ids: Array.from(selectedIds),
        });
      } else {
        await post(`/security/${selectedAgentId}/permissions/bulk-revoke`, {
          scope: mode,
        });
      }
      await fetchPermissions(selectedAgentId);
      setSelectedIds(new Set());
      // 同步到 Rust 层
      syncPermissionsToRust().catch(() => {});
      showToast('批量撤销完成');
    } catch {
      showToast('批量撤销失败', 'error');
    } finally {
      setBulkConfirm(null);
    }
  }, [selectedAgentId, selectedIds, bulkConfirm, fetchPermissions, showToast]);

  /** 取消确认 */
  const cancelAction = useCallback(() => {
    setRevoking(null);
    setBulkConfirm(null);
  }, []);

  /** 多选切换 */
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  /** 全选/取消全选 */
  const toggleSelectAll = useCallback(() => {
    if (selectedIds.size === permissions.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(permissions.map(p => p.id)));
    }
  }, [selectedIds.size, permissions]);

  /** 加载更多审计日志 */
  const handleLoadMore = useCallback(() => {
    if (selectedAgentId) {
      fetchAuditLogs(selectedAgentId, auditOffset, true);
    }
  }, [selectedAgentId, auditOffset, fetchAuditLogs]);

  /** 格式化时间 */
  const formatTime = (iso: string) => {
    try {
      const d = (iso.endsWith('Z') || iso.includes('+') || iso.includes('T'))
        ? new Date(iso) : new Date(iso + 'Z');
      return d.toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  };

  /** 格式化耗时 */
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="h-full flex flex-col">
      {/* 顶栏 */}
      <div className="px-6 py-4 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">安全设置</h2>
            <p className="text-sm text-slate-400">管理 Agent 权限与审计日志</p>
          </div>

          {/* Agent 选择器 */}
          <AgentSelect
            agents={agents}
            value={selectedAgentId}
            onChange={setSelectedAgentId}
          />
        </div>

        {/* Tab 切换 */}
        <div className="flex gap-1">
          {([
            ['permissions', '已授权权限'],
            ['audit', '审计日志'],
            ['guard', '安全防护'],
          ] as [TabKey, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                activeTab === key
                  ? 'bg-brand/10 text-brand-active'
                  : 'text-slate-500 hover:bg-slate-100'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedAgentId ? (
          <div className="text-center text-slate-400 mt-20">
            <p className="text-lg">请先创建一个 Agent</p>
            <p className="text-sm mt-1">在 Agent 管理页面创建后即可查看安全设置</p>
          </div>
        ) : loading && (activeTab === 'permissions' ? permissions.length === 0 : auditLogs.length === 0) ? (
          <div className="text-center text-slate-400 mt-20">
            <p className="text-sm">加载中...</p>
          </div>
        ) : activeTab === 'permissions' ? (
          /* ─── 已授权权限 ─── */
          <div className="max-w-3xl mx-auto">
            {/* 权限统计面板 */}
            {stats && stats.total > 0 && (
              <div className="mb-6 p-4 bg-white rounded-xl border border-slate-200">
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm font-medium text-slate-700">权限概览</span>
                  <span className="px-2 py-0.5 rounded bg-slate-100 text-xs text-slate-600">
                    共 {stats.total} 条
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(stats.byCategory).map(([cat, count]) => (
                    <span key={cat} className="flex items-center gap-1.5">
                      <CategoryBadge category={cat} />
                      <span className="text-xs text-slate-500">{count}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* 批量操作栏 */}
            {permissions.length > 0 && (
              <div className="flex items-center gap-2 mb-4">
                <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedIds.size === permissions.length && permissions.length > 0}
                    onChange={toggleSelectAll}
                    className="rounded border-slate-300"
                  />
                  全选
                </label>
                {selectedIds.size > 0 && (
                  <button
                    onClick={() => handleBulkRevoke('selected')}
                    className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                      bulkConfirm === 'selected'
                        ? 'bg-red-500 text-white'
                        : 'border border-red-200 text-red-500 hover:bg-red-50'
                    }`}
                  >
                    {bulkConfirm === 'selected' ? `确认撤销 ${selectedIds.size} 条` : `撤销选中 (${selectedIds.size})`}
                  </button>
                )}
                <button
                  onClick={() => handleBulkRevoke('session')}
                  className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                    bulkConfirm === 'session'
                      ? 'bg-red-500 text-white'
                      : 'border border-purple-200 text-purple-500 hover:bg-purple-50'
                  }`}
                >
                  {bulkConfirm === 'session' ? '确认撤销' : '撤销所有 session'}
                </button>
                <button
                  onClick={() => handleBulkRevoke('always')}
                  className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                    bulkConfirm === 'always'
                      ? 'bg-red-500 text-white'
                      : 'border border-green-200 text-green-600 hover:bg-green-50'
                  }`}
                >
                  {bulkConfirm === 'always' ? '确认撤销' : '撤销所有 always'}
                </button>
                {bulkConfirm && (
                  <button
                    onClick={cancelAction}
                    className="px-3 py-1 text-xs rounded-lg bg-slate-200 text-slate-600 hover:bg-slate-300"
                  >
                    取消
                  </button>
                )}
              </div>
            )}

            {permissions.length === 0 ? (
              <div className="text-center text-slate-400 mt-20">
                <p className="text-lg">暂无已授权权限</p>
                <p className="text-sm mt-1">Agent 请求权限后将在此处显示</p>
              </div>
            ) : (
              <div className="space-y-3">
                {permissions.map((perm) => (
                  <div
                    key={perm.id}
                    className="bg-white rounded-lg border border-slate-200 p-4 flex items-center gap-4"
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(perm.id)}
                      onChange={() => toggleSelect(perm.id)}
                      className="rounded border-slate-300 shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <CategoryBadge category={perm.category} />
                        <ScopeBadge scope={perm.scope} />
                      </div>
                      <p className="text-sm text-slate-800 truncate font-mono">{perm.resource}</p>
                      <p className="text-xs text-slate-400 mt-1">
                        授权于 {formatTime(perm.grantedAt)}
                      </p>
                    </div>

                    <div className="shrink-0">
                      {revoking === perm.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleRevoke(perm.id)}
                            className="px-2.5 py-1.5 text-xs rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
                          >
                            确认撤销
                          </button>
                          <button
                            onClick={cancelAction}
                            className="px-2.5 py-1.5 text-xs rounded-lg bg-slate-200 text-slate-600 hover:bg-slate-300 transition-colors"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => handleRevoke(perm.id)}
                          className="px-3 py-1.5 text-xs font-medium rounded-lg transition-colors
                            border border-red-200 text-red-500 hover:bg-red-50"
                        >
                          撤销
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : activeTab === 'audit' ? (
          /* ─── 审计日志 ─── */
          <div className="max-w-3xl mx-auto">
            {/* 过滤栏 */}
            <div className="flex items-center gap-3 mb-4">
              <input
                value={auditFilter.toolName}
                onChange={(e) => {
                  setAuditFilter(prev => ({ ...prev, toolName: e.target.value }));
                  setAuditOffset(0);
                }}
                placeholder="工具名称筛选..."
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white
                  focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand
                  placeholder:text-slate-400"
              />
              <select
                value={auditFilter.status}
                onChange={(e) => {
                  setAuditFilter(prev => ({ ...prev, status: e.target.value }));
                  setAuditOffset(0);
                }}
                className="px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white
                  focus:outline-none focus:ring-2 focus:ring-brand/30"
              >
                <option value="">全部状态</option>
                <option value="success">成功</option>
                <option value="error">错误</option>
                <option value="denied">拒绝</option>
                <option value="timeout">超时</option>
              </select>
              <button
                onClick={() => {
                  setAuditOffset(0);
                  if (selectedAgentId) fetchAuditLogs(selectedAgentId, 0);
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-brand rounded-lg hover:bg-brand-hover transition-colors"
              >
                搜索
              </button>
            </div>

            {auditLogs.length === 0 ? (
              <div className="text-center text-slate-400 mt-20">
                <p className="text-lg">暂无审计日志</p>
                <p className="text-sm mt-1">Agent 执行工具调用后将在此处记录</p>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-xs text-slate-400 mb-2">审计日志记录</p>
                {auditLogs.map((log) => (
                  <div
                    key={log.id}
                    className="bg-white rounded-lg border border-slate-200 p-4 flex items-center gap-4"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm font-medium text-slate-900">{log.toolName}</p>
                        <StatusBadge status={log.status} />
                      </div>
                      <div className="flex items-center gap-3 text-xs text-slate-400">
                        <span>耗时 {formatDuration(log.durationMs)}</span>
                        <span>{formatTime(log.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                ))}

                {/* 加载更多 */}
                {hasMore && (
                  <div className="text-center pt-2">
                    <button
                      onClick={handleLoadMore}
                      disabled={loading}
                      className="px-6 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 disabled:opacity-50 transition-colors"
                    >
                      {loading ? '加载中...' : '加载更多'}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          /* ─── 安全防护 ─── */
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="text-base font-semibold text-slate-900 mb-2">双层防御架构</h3>
              <p className="text-sm text-slate-500 mb-4">
                EvoClaw 采用 Rust + Node.js 双层权限检查，确保 Agent 操作的安全性。
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-orange-50 border border-orange-200">
                  <p className="text-sm font-medium text-orange-800 mb-1">Rust 层</p>
                  <p className="text-xs text-orange-600">凭证访问权限检查（Keychain 操作前置拦截）</p>
                </div>
                <div className="p-4 rounded-lg bg-blue-50 border border-blue-200">
                  <p className="text-sm font-medium text-blue-800 mb-1">Node.js 层</p>
                  <p className="text-xs text-blue-600">工具级权限拦截 + 危险命令检测 + 审计日志</p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="text-base font-semibold text-slate-900 mb-2">安全策略</h3>
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                    <span className="w-2 h-2 rounded-full bg-red-500" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-slate-800">危险命令检测</p>
                    <p className="text-xs text-slate-500">自动拦截 rm -rf、DROP TABLE、sudo 等危险操作</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                    <span className="w-2 h-2 rounded-full bg-purple-500" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-slate-800">受限路径保护</p>
                    <p className="text-xs text-slate-500">禁止访问 /etc、~/.ssh、/System 等敏感路径</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                    <span className="w-2 h-2 rounded-full bg-amber-500" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-slate-800">消息发送确认</p>
                    <p className="text-xs text-slate-500">邮件、Slack、微信等消息类工具强制用户确认</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 w-5 h-5 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                    <span className="w-2 h-2 rounded-full bg-green-500" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-slate-800">循环检测与熔断</p>
                    <p className="text-xs text-slate-500">重复调用检测（阈值 30 次），防止 Agent 陷入无限循环</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Toast 通知 */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 px-4 py-2.5 rounded-lg text-sm font-medium shadow-lg transition-all ${
            toast.type === 'success'
              ? 'bg-brand text-white'
              : 'bg-red-500 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
