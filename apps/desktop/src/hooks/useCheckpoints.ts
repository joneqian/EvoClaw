/**
 * useCheckpoints — 拉取最近 N 条 checkpoint + 撤销动作
 *
 * 对应后端 /checkpoint REST API（见 packages/core/src/routes/checkpoint.ts）：
 *   GET  /checkpoint/recent?limit=N
 *   POST /checkpoint/:id/revert
 *
 * 加 30s 自动刷新让 Files 页打开期间能看到 agent 新产生的 checkpoint。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { get, post } from '../lib/api';

export interface CheckpointFileRef {
  path: string;
  existedBefore: boolean;
  shaBefore: string;
}

export interface CheckpointRecord {
  toolInvocationId: string;
  toolName: string;
  agentId: string | null;
  sessionKey: string | null;
  files: CheckpointFileRef[];
  createdAt: number;
  revertedAt: number | null;
}

interface RecentResponse {
  success: boolean;
  data: CheckpointRecord[];
}

interface RevertResponse {
  success: boolean;
  restored?: number;
  error?: string;
}

interface UseCheckpointsResult {
  list: CheckpointRecord[];
  loading: boolean;
  error: string | null;
  /** 立即刷新（手动触发） */
  refresh: () => Promise<void>;
  /** 撤销单条 checkpoint，成功后自动刷新列表 */
  revert: (toolInvocationId: string) => Promise<{ ok: boolean; restored?: number; error?: string }>;
}

const DEFAULT_LIMIT = 50;
const AUTO_REFRESH_MS = 30_000;

export function useCheckpoints(limit: number = DEFAULT_LIMIT): UseCheckpointsResult {
  const [list, setList] = useState<CheckpointRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 防多次并发请求覆盖：保留最新 abort
  const inflight = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    inflight.current?.abort();
    const ac = new AbortController();
    inflight.current = ac;
    setLoading(true);
    setError(null);
    try {
      const res = await get<RecentResponse>(`/checkpoint/recent?limit=${limit}`);
      if (ac.signal.aborted) return;
      if (res.success) {
        setList(res.data);
      } else {
        setError('加载失败');
      }
    } catch (err) {
      if (ac.signal.aborted) return;
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!ac.signal.aborted) setLoading(false);
    }
  }, [limit]);

  const revert = useCallback(
    async (toolInvocationId: string) => {
      try {
        const res = await post<RevertResponse>(
          `/checkpoint/${encodeURIComponent(toolInvocationId)}/revert`,
        );
        if (res.success) {
          await refresh();
          return { ok: true, restored: res.restored };
        }
        return { ok: false, error: res.error ?? '撤销失败' };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
    [refresh],
  );

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      void refresh();
    }, AUTO_REFRESH_MS);
    return () => {
      clearInterval(timer);
      inflight.current?.abort();
    };
  }, [refresh]);

  return { list, loading, error, refresh, revert };
}
