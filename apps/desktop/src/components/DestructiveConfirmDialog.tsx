/**
 * DestructiveConfirmDialog — 破坏性操作确认对话框
 *
 * 参考 Claude Code 的危险操作确认模式 + 现有 PermissionDialog 样式。
 * 当 Agent 执行 isDestructive=true 的工具时弹出。
 */

import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface DestructiveConfirmDialogProps {
  toolName: string;
  args: Record<string, unknown>;
  onConfirm: () => void;
  onDeny: () => void;
}

/** 格式化工具参数为可读文本 */
function formatArgs(args: Record<string, unknown>, emptyLabel: string): string {
  const entries = Object.entries(args);
  if (entries.length === 0) return emptyLabel;
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
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={onDeny}
    >
      <div
        className="bg-card rounded-2xl shadow-2xl w-full max-w-[420px] mx-4 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-danger/10 flex items-center justify-center">
            <AlertTriangle className="w-5 h-5 text-danger" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground">{t('destructive.title')}</h3>
            <p className="text-xs text-muted-foreground">{t('destructive.subtitle')}</p>
          </div>
        </div>

        {/* Content */}
        <div className="px-5 pb-4">
          <p className="text-sm text-muted-foreground mb-3">{t('destructive.intro')}</p>
          <div className="bg-muted rounded-lg p-3 mb-3">
            <div className="text-xs text-muted-foreground mb-1">{t('destructive.tool')}</div>
            <div className="text-sm font-medium text-foreground">{toolName}</div>
            <div className="text-xs text-muted-foreground mt-2 mb-1">{t('destructive.args')}</div>
            <pre className="text-xs text-muted-foreground whitespace-pre-wrap break-all font-mono">
              {formatArgs(args, t('destructive.noArgs'))}
            </pre>
          </div>
          <p className="text-sm text-warning">
            {t('destructive.warning')}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            onClick={onDeny}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-muted-foreground bg-accent hover:bg-accent rounded-xl transition-colors"
          >
            {t('common.cancel')}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-danger hover:bg-danger rounded-xl transition-colors"
          >
            {t('destructive.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
