/**
 * CheckpointPage — 撤销改动 Tab
 *
 * 列出最近 N 条 checkpoint，让用户一键撤销 agent 的破坏性工具调用
 * （write / edit）。后端通过 /checkpoint REST API 提供数据。
 *
 * UI 风格对齐 EvolutionPage / TasksPage 等：单列卡片、面向非程序员用户。
 */

import { useState } from 'react';
import { useCheckpoints, type CheckpointRecord } from '../hooks/useCheckpoints';
import CheckpointList from '../components/CheckpointList';
import CheckpointRevertDialog from '../components/CheckpointRevertDialog';

export default function CheckpointPage() {
  const { list, loading, error, refresh, revert } = useCheckpoints(50);
  const [pending, setPending] = useState<CheckpointRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; msg: string } | null>(null);

  const handleConfirm = async () => {
    if (!pending) return;
    setBusy(true);
    const result = await revert(pending.toolInvocationId);
    setBusy(false);
    setPending(null);
    if (result.ok) {
      setToast({
        kind: 'ok',
        msg: `已撤销 ${result.restored ?? 0} 个文件`,
      });
    } else {
      setToast({ kind: 'err', msg: result.error ?? '撤销失败' });
    }
    // 4 秒后自动消失
    setTimeout(() => setToast(null), 4000);
  };

  return (
    <div className="flex-1 overflow-auto bg-slate-50">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-slate-800">撤销改动</h1>
            <p className="text-sm text-slate-500 mt-1">
              Agent 修改 / 创建文件前会自动备份，遇到问题可一键撤销最近 7 天的改动。
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="text-xs px-3 py-1.5 border border-slate-200 hover:bg-slate-100 rounded-md text-slate-600 transition-colors disabled:opacity-50"
          >
            {loading ? '刷新中…' : '刷新'}
          </button>
        </div>

        {/* Error */}
        {error && !loading && (
          <div className="mb-4 px-4 py-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            加载失败：{error}
          </div>
        )}

        {/* List */}
        {!loading && (
          <CheckpointList list={list} onRequestRevert={setPending} />
        )}

        {loading && list.length === 0 && (
          <div className="text-center py-16 text-slate-400 text-sm">加载中…</div>
        )}
      </div>

      {/* 二次确认弹窗 */}
      {pending && (
        <CheckpointRevertDialog
          record={pending}
          busy={busy}
          onConfirm={handleConfirm}
          onCancel={() => {
            if (!busy) setPending(null);
          }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div
          className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-in slide-in-from-bottom-2 ${
            toast.kind === 'ok'
              ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
              : 'bg-red-50 text-red-700 border border-red-200'
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}
