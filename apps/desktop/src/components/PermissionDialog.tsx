import { useCallback } from 'react';

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

export interface PermissionDialogProps {
  isOpen: boolean;
  agentName: string;
  agentEmoji: string;
  category: string;
  resource: string;
  reason?: string;
  onDecision: (scope: 'once' | 'always' | 'deny') => void;
  onClose: () => void;
}

export default function PermissionDialog({
  isOpen,
  agentName,
  agentEmoji,
  category,
  resource,
  reason,
  onDecision,
  onClose,
}: PermissionDialogProps) {
  /** 点击遮罩层 → 拒绝 */
  const handleOverlayClick = useCallback(() => {
    onDecision('deny');
    onClose();
  }, [onDecision, onClose]);

  /** 阻止对话框内部点击冒泡 */
  const handleDialogClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
  }, []);

  /** 处理决定 */
  const handleDecision = useCallback(
    (scope: 'once' | 'always' | 'deny') => {
      onDecision(scope);
      onClose();
    },
    [onDecision, onClose],
  );

  if (!isOpen) return null;

  const categoryLabel = CATEGORY_LABELS[category] ?? category;
  const categoryColor = CATEGORY_COLORS[category] ?? 'bg-gray-100 text-gray-700';

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
      onClick={handleOverlayClick}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={handleDialogClick}
      >
        {/* 头部 */}
        <div className="px-6 pt-6 pb-4">
          <div className="flex items-center gap-3 mb-4">
            <span className="text-3xl">{agentEmoji}</span>
            <div>
              <h3 className="text-base font-bold text-gray-900">
                {agentName}
              </h3>
              <p className="text-sm text-gray-500">请求权限</p>
            </div>
          </div>

          {/* 权限详情 */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-400 w-16 shrink-0">类别</span>
              <span className={`px-2.5 py-0.5 rounded text-xs font-medium ${categoryColor}`}>
                {categoryLabel}
              </span>
            </div>

            <div className="flex items-start gap-2">
              <span className="text-xs text-gray-400 w-16 shrink-0 mt-0.5">资源</span>
              <code className="flex-1 text-sm text-gray-800 bg-gray-50 px-3 py-2 rounded-lg break-all font-mono">
                {resource}
              </code>
            </div>

            {reason && (
              <div className="flex items-start gap-2">
                <span className="text-xs text-gray-400 w-16 shrink-0 mt-0.5">原因</span>
                <p className="flex-1 text-sm text-gray-600">{reason}</p>
              </div>
            )}
          </div>
        </div>

        {/* 操作按钮 */}
        <div className="px-6 pb-6 pt-2 flex gap-3">
          <button
            onClick={() => handleDecision('once')}
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors
              border border-blue-300 text-blue-600 hover:bg-blue-50"
          >
            仅本次
          </button>
          <button
            onClick={() => handleDecision('always')}
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors
              bg-green-500 text-white hover:bg-green-600"
          >
            始终允许
          </button>
          <button
            onClick={() => handleDecision('deny')}
            className="flex-1 px-4 py-2.5 text-sm font-medium rounded-lg transition-colors
              border border-red-300 text-red-600 hover:bg-red-50"
          >
            始终拒绝
          </button>
        </div>
      </div>
    </div>
  );
}
