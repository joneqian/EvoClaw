/**
 * DestructiveConfirmDialog — 破坏性操作确认对话框
 *
 * 参考 Claude Code 的危险操作确认模式 + 现有 PermissionDialog 样式。
 * 当 Agent 执行 isDestructive=true 的工具时弹出。
 */

interface DestructiveConfirmDialogProps {
  toolName: string;
  args: Record<string, unknown>;
  onConfirm: () => void;
  onDeny: () => void;
}

/** 格式化工具参数为可读文本 */
function formatArgs(args: Record<string, unknown>): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return '(无参数)';
  return entries
    .slice(0, 5) // 最多显示 5 个参数
    .map(([k, v]) => {
      const val = typeof v === 'string' ? v : JSON.stringify(v);
      return `${k}: ${val.length > 80 ? val.slice(0, 80) + '...' : val}`;
    })
    .join('\n');
}

export default function DestructiveConfirmDialog({
  toolName,
  args,
  onConfirm,
  onDeny,
}: DestructiveConfirmDialogProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={onDeny}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-[420px] mx-4 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-red-50 flex items-center justify-center">
            <svg className="w-5 h-5 text-red-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z" />
            </svg>
          </div>
          <div>
            <h3 className="text-base font-semibold text-slate-800">操作确认</h3>
            <p className="text-xs text-slate-400">此操作不可逆</p>
          </div>
        </div>

        {/* Content */}
        <div className="px-5 pb-4">
          <p className="text-sm text-slate-600 mb-3">即将执行不可逆操作：</p>
          <div className="bg-slate-50 rounded-lg p-3 mb-3">
            <div className="text-xs text-slate-400 mb-1">工具</div>
            <div className="text-sm font-medium text-slate-700">{toolName}</div>
            <div className="text-xs text-slate-400 mt-2 mb-1">参数</div>
            <pre className="text-xs text-slate-600 whitespace-pre-wrap break-all font-mono">
              {formatArgs(args)}
            </pre>
          </div>
          <p className="text-sm text-amber-600">
            确认后操作将立即执行，无法撤回。
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={onDeny}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors"
          >
            取消
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-red-500 hover:bg-red-600 rounded-xl transition-colors"
          >
            确认执行
          </button>
        </div>
      </div>
    </div>
  );
}
