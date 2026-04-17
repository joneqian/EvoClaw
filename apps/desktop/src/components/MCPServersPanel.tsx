/**
 * MCP 服务器管理面板（Settings 的 MCP Tab 内容）
 *
 * 功能：
 * - 3s 轮询 GET /mcp 同步 server 状态
 * - error 状态 server 显示"重连"按钮 → POST /mcp/servers/:name/reconnect
 * - 展示 toolCount / error reason
 *
 * 当前为轮询方案（M4.1）；后续 A2 运行时断线恢复会改为 SSE 推送。
 */

import { useEffect, useState, useCallback, useRef } from 'react';
import { get, post } from '../lib/api';

/** MCP 服务器状态（对齐后端 McpManager.getStates() 返回结构） */
interface McpServerState {
  name: string;
  status: 'stopped' | 'starting' | 'running' | 'error';
  toolCount: number;
  error?: string;
}

interface McpStatesResponse {
  servers: McpServerState[];
}

interface ReconnectResponse {
  success: boolean;
  state?: McpServerState;
}

const POLL_INTERVAL_MS = 3000;

/** 状态徽章配色 */
const STATUS_CONFIG: Record<McpServerState['status'], { label: string; className: string }> = {
  running: { label: '运行中', className: 'bg-emerald-100 text-emerald-700 border-emerald-200' },
  starting: { label: '启动中', className: 'bg-blue-100 text-blue-700 border-blue-200' },
  stopped: { label: '已停止', className: 'bg-slate-100 text-slate-600 border-slate-200' },
  error: { label: '错误', className: 'bg-rose-100 text-rose-700 border-rose-200' },
};

export default function MCPServersPanel() {
  const [servers, setServers] = useState<McpServerState[]>([]);
  const [loading, setLoading] = useState(true);
  const [reconnecting, setReconnecting] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const mountedRef = useRef(true);

  const fetchStates = useCallback(async () => {
    try {
      const data = await get<McpStatesResponse>('/mcp');
      if (mountedRef.current) {
        setServers(data.servers ?? []);
        setLoading(false);
      }
    } catch (err) {
      if (mountedRef.current) {
        setLoading(false);
        // 不弹 toast，避免轮询失败时一直刷屏
        // eslint-disable-next-line no-console
        console.warn('[mcp-panel] 拉取状态失败:', err);
      }
    }
  }, []);

  // 挂载 + 轮询
  useEffect(() => {
    mountedRef.current = true;
    fetchStates();
    const timer = setInterval(fetchStates, POLL_INTERVAL_MS);
    return () => {
      mountedRef.current = false;
      clearInterval(timer);
    };
  }, [fetchStates]);

  // Toast 自动消失
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleReconnect = useCallback(async (name: string) => {
    setReconnecting((prev) => new Set(prev).add(name));
    try {
      const res = await post<ReconnectResponse>(`/mcp/servers/${encodeURIComponent(name)}/reconnect`);
      if (res.success) {
        setToast({ message: `"${name}" 重连成功`, type: 'success' });
      } else {
        setToast({ message: `"${name}" 重连失败，已达最大尝试次数`, type: 'error' });
      }
      // 立即刷新一次状态
      await fetchStates();
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : '重连请求失败', type: 'error' });
    } finally {
      setReconnecting((prev) => {
        const next = new Set(prev);
        next.delete(name);
        return next;
      });
    }
  }, [fetchStates]);

  if (loading) {
    return <div className="text-sm text-slate-400">加载中...</div>;
  }

  if (servers.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 text-center">
        <p className="text-sm text-slate-500">暂无 MCP 服务器</p>
        <p className="text-xs text-slate-400 mt-1">
          在项目根目录的 <code className="px-1 py-0.5 bg-slate-100 rounded">.mcp.json</code> 或
          Agent 工作区配置 MCP 服务器。
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
        {servers.map((srv) => {
          const cfg = STATUS_CONFIG[srv.status];
          const isReconnecting = reconnecting.has(srv.name);
          const canReconnect = srv.status === 'error' || srv.status === 'stopped';

          return (
            <div key={srv.name} className="px-4 py-3 flex items-center justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-slate-900 truncate">{srv.name}</span>
                  <span className={`inline-flex items-center px-2 py-0.5 text-[11px] rounded-full border ${cfg.className}`}>
                    {cfg.label}
                  </span>
                  {srv.status === 'running' && (
                    <span className="text-xs text-slate-400">{srv.toolCount} 个工具</span>
                  )}
                </div>
                {srv.error && (
                  <p className="mt-1 text-xs text-rose-600 line-clamp-2" title={srv.error}>
                    {srv.error}
                  </p>
                )}
              </div>
              {canReconnect && (
                <button
                  onClick={() => handleReconnect(srv.name)}
                  disabled={isReconnecting}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg border border-slate-200
                    text-slate-700 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed
                    transition-colors"
                >
                  {isReconnecting ? '重连中...' : '重连'}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {toast && (
        <div className={`fixed bottom-4 right-4 px-4 py-2 rounded-lg shadow-lg text-sm ${
          toast.type === 'success' ? 'bg-green-500 text-white' : 'bg-red-500 text-white'
        }`}>
          {toast.message}
        </div>
      )}
    </>
  );
}
