/**
 * CheckpointRevertDialog — 撤销 checkpoint 二次确认弹窗
 *
 * Checkpoint 撤销是破坏性操作（会覆盖当前文件 / 删除 agent 创建的新文件），
 * 必须二次确认。复用 DestructiveConfirmDialog 的视觉规范。
 */

import type { CheckpointRecord } from '../hooks/useCheckpoints';

interface Props {
  record: CheckpointRecord;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function formatTs(ms: number): string {
  return new Date(ms).toLocaleString('zh-CN', { hour12: false });
}

export default function CheckpointRevertDialog({ record, busy, onConfirm, onCancel }: Props) {
  const filesAddedByTool = record.files.filter((f) => !f.existedBefore);
  const filesModifiedByTool = record.files.filter((f) => f.existedBefore);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={busy ? undefined : onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-[520px] mx-4 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-amber-50 flex items-center justify-center">
            <svg
              className="w-5 h-5 text-amber-600"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={1.5}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-800">撤销改动确认</h3>
            <p className="text-xs text-slate-400">即将还原 / 删除以下文件</p>
          </div>
        </div>

        {/* Content */}
        <div className="px-5 pb-4">
          <div className="bg-slate-50 rounded-lg p-3 mb-3 text-xs text-slate-600 space-y-1">
            <div className="flex justify-between">
              <span className="text-slate-400">工具</span>
              <span className="font-mono">{record.toolName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">时间</span>
              <span>{formatTs(record.createdAt)}</span>
            </div>
            {record.agentId && (
              <div className="flex justify-between">
                <span className="text-slate-400">Agent</span>
                <span className="font-mono truncate ml-2 max-w-[280px]">{record.agentId}</span>
              </div>
            )}
          </div>

          {filesModifiedByTool.length > 0 && (
            <div className="mb-3">
              <div className="text-xs text-slate-500 mb-1">
                将还原 {filesModifiedByTool.length} 个被修改的文件
              </div>
              <ul className="space-y-1 max-h-32 overflow-auto">
                {filesModifiedByTool.map((f) => (
                  <li
                    key={f.path}
                    className="text-xs font-mono text-slate-700 bg-blue-50/40 rounded px-2 py-1 truncate"
                    title={f.path}
                  >
                    ↩ {f.path}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {filesAddedByTool.length > 0 && (
            <div className="mb-3">
              <div className="text-xs text-slate-500 mb-1">
                将删除 {filesAddedByTool.length} 个 agent 新建的文件
              </div>
              <ul className="space-y-1 max-h-32 overflow-auto">
                {filesAddedByTool.map((f) => (
                  <li
                    key={f.path}
                    className="text-xs font-mono text-slate-700 bg-red-50/40 rounded px-2 py-1 truncate"
                    title={f.path}
                  >
                    ✕ {f.path}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-amber-600 bg-amber-50/60 rounded px-3 py-2">
            ⚠ 此操作不可逆。撤销后当前文件内容将被覆盖，新建的文件会被删除。
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 px-4 py-2 text-sm font-medium bg-amber-500 hover:bg-amber-600 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? '撤销中…' : '确认撤销'}
          </button>
        </div>
      </div>
    </div>
  );
}
