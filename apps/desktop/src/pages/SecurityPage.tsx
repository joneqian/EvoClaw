import { useState, useEffect, useCallback } from 'react';
import { useAgentStore } from '../stores/agent-store';
import AgentSelect from '../components/AgentSelect';
import { get, del } from '../lib/api';

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
type TabKey = 'permissions' | 'audit';

/** 安全设置页面 */
export default function SecurityPage() {
  const { agents } = useAgentStore();

  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabKey>('permissions');
  const [permissions, setPermissions] = useState<PermissionRecord[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [auditOffset, setAuditOffset] = useState(0);
  const [revoking, setRevoking] = useState<string | null>(null);
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

  /** 加载权限列表 */
  const fetchPermissions = useCallback(async (agentId: string) => {
    if (!agentId) return;
    setLoading(true);
    try {
      const data = await get<{ permissions: PermissionRecord[] }>(
        `/agents/${agentId}/permissions`,
      );
      setPermissions(data.permissions ?? []);
    } catch {
      setPermissions([]);
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
        const data = await get<{ logs: AuditLogEntry[]; total: number }>(
          `/agents/${agentId}/audit-log?limit=${PAGE_SIZE}&offset=${offset}`,
        );
        const logs = data.logs ?? [];
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
    [],
  );

  /** 切换 agent 或 tab 时重新加载 */
  useEffect(() => {
    if (!selectedAgentId) return;
    if (activeTab === 'permissions') {
      fetchPermissions(selectedAgentId);
    } else {
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
        await del(`/agents/${selectedAgentId}/permissions/${permissionId}`);
        setPermissions((prev) => prev.filter((p) => p.id !== permissionId));
        showToast('权限已撤销');
      } catch {
        showToast('撤销失败', 'error');
      } finally {
        setRevoking(null);
      }
    },
    [selectedAgentId, revoking, showToast],
  );

  /** 取消撤销确认 */
  const cancelRevoke = useCallback(() => {
    setRevoking(null);
  }, []);

  /** 加载更多审计日志 */
  const handleLoadMore = useCallback(() => {
    if (selectedAgentId) {
      fetchAuditLogs(selectedAgentId, auditOffset, true);
    }
  }, [selectedAgentId, auditOffset, fetchAuditLogs]);

  /** 格式化时间 */
  const formatTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('zh-CN', {
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
          <button
            onClick={() => setActiveTab('permissions')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === 'permissions'
                ? 'bg-brand/10 text-brand-active'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            已授权权限
          </button>
          <button
            onClick={() => setActiveTab('audit')}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              activeTab === 'audit'
                ? 'bg-brand/10 text-brand-active'
                : 'text-slate-500 hover:bg-slate-100'
            }`}
          >
            审计日志
          </button>
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
          /* 已授权权限列表 */
          permissions.length === 0 ? (
            <div className="text-center text-slate-400 mt-20">
              <p className="text-lg">暂无已授权权限</p>
              <p className="text-sm mt-1">Agent 请求权限后将在此处显示</p>
            </div>
          ) : (
            <div className="space-y-3 max-w-3xl mx-auto">
              <p className="text-xs text-slate-400 mb-2">
                共 {permissions.length} 条权限记录
              </p>
              {permissions.map((perm) => (
                <div
                  key={perm.id}
                  className="bg-white rounded-lg border border-slate-200 p-4 flex items-center gap-4"
                >
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
                          onClick={cancelRevoke}
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
          )
        ) : /* 审计日志列表 */
        auditLogs.length === 0 ? (
          <div className="text-center text-slate-400 mt-20">
            <p className="text-lg">暂无审计日志</p>
            <p className="text-sm mt-1">Agent 执行工具调用后将在此处记录</p>
          </div>
        ) : (
          <div className="space-y-3 max-w-3xl mx-auto">
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
