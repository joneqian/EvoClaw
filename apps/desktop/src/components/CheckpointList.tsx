/**
 * CheckpointList — 最近 checkpoint 列表
 *
 * 单条卡片展示：工具名 + 时间 + 文件清单 + 撤销按钮 / 已撤销徽标。
 * 点击撤销按钮触发外部 onRequestRevert，由父级弹 CheckpointRevertDialog 二次确认。
 */

import type { CheckpointRecord } from '../hooks/useCheckpoints';

interface Props {
  list: CheckpointRecord[];
  onRequestRevert: (record: CheckpointRecord) => void;
}

function formatTs(ms: number): string {
  const date = new Date(ms);
  const diffMs = Date.now() - ms;
  if (diffMs < 60_000) return '刚刚';
  if (diffMs < 60 * 60_000) return `${Math.floor(diffMs / 60_000)} 分钟前`;
  if (diffMs < 24 * 60 * 60_000) return `${Math.floor(diffMs / 3_600_000)} 小时前`;
  return date.toLocaleString('zh-CN', { hour12: false });
}

const TOOL_LABELS: Record<string, string> = {
  write: '写入文件',
  edit: '编辑文件',
  apply_patch: '应用补丁',
};

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name;
}

export default function CheckpointList({ list, onRequestRevert }: Props) {
  if (list.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400 text-sm">
        <svg
          className="w-12 h-12 mx-auto mb-3 text-slate-300"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
        </svg>
        <p>还没有可撤销的改动</p>
        <p className="text-xs mt-1 text-slate-300">Agent 修改文件后会在这里出现</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2">
      {list.map((r) => {
        const reverted = r.revertedAt !== null;
        const totalFiles = r.files.length;
        const newFiles = r.files.filter((f) => !f.existedBefore).length;
        const editedFiles = totalFiles - newFiles;
        return (
          <li
            key={r.toolInvocationId}
            className={`bg-white border rounded-xl px-4 py-3 transition-colors ${
              reverted ? 'border-slate-200 opacity-60' : 'border-slate-200 hover:border-amber-300'
            }`}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-slate-800">{toolLabel(r.toolName)}</span>
                  <span className="text-xs text-slate-400">{formatTs(r.createdAt)}</span>
                  {reverted && (
                    <span className="text-xs px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded">
                      已撤销
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {editedFiles > 0 && <span>修改 {editedFiles} 个文件</span>}
                  {editedFiles > 0 && newFiles > 0 && <span className="mx-1">·</span>}
                  {newFiles > 0 && <span>新建 {newFiles} 个文件</span>}
                </div>
              </div>
              {!reverted && (
                <button
                  type="button"
                  onClick={() => onRequestRevert(r)}
                  className="text-xs px-3 py-1.5 bg-amber-50 hover:bg-amber-100 text-amber-700 rounded-md font-medium transition-colors flex-shrink-0"
                >
                  撤销
                </button>
              )}
            </div>

            {/* 文件清单（折叠展开 first 3） */}
            <ul className="space-y-0.5 max-h-24 overflow-y-auto">
              {r.files.slice(0, 5).map((f) => (
                <li
                  key={f.path}
                  className="text-xs font-mono text-slate-500 truncate"
                  title={f.path}
                >
                  {f.existedBefore ? '↩' : '✕'} {f.path}
                </li>
              ))}
              {r.files.length > 5 && (
                <li className="text-xs text-slate-400">…还有 {r.files.length - 5} 个</li>
              )}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
