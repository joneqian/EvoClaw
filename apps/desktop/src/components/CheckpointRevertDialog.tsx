/**
 * CheckpointRevertDialog — 撤销 checkpoint 二次确认弹窗
 *
 * Checkpoint 撤销是破坏性操作（会覆盖当前文件 / 删除 agent 创建的新文件），
 * 必须二次确认。复用 DestructiveConfirmDialog 的视觉规范。
 */

import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CheckpointRecord } from '../hooks/useCheckpoints';
import { useModalA11y } from '../hooks/useModalA11y';

interface Props {
  record: CheckpointRecord;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function formatTs(ms: number, locale: string): string {
  return new Date(ms).toLocaleString(locale, { hour12: false });
}

export default function CheckpointRevertDialog({ record, busy, onConfirm, onCancel }: Props) {
  const { t, i18n } = useTranslation();
  const filesAddedByTool = record.files.filter((f) => !f.existedBefore);
  const filesModifiedByTool = record.files.filter((f) => f.existedBefore);
  const ref = useModalA11y<HTMLDivElement>({
    isOpen: true,
    onClose: busy ? () => {} : onCancel,
  });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={busy ? undefined : onCancel}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkpoint-revert-title"
        aria-describedby="checkpoint-revert-desc"
        className="bg-card rounded-2xl shadow-2xl w-full max-w-[520px] mx-4 animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 pt-5 pb-3">
          <div className="flex-shrink-0 w-10 h-10 rounded-full bg-warning/10 flex items-center justify-center">
            <RotateCcw className="w-5 h-5 text-warning" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <div>
            <h3 id="checkpoint-revert-title" className="text-base font-semibold text-foreground">{t('checkpoint.revertConfirmTitle')}</h3>
            <p id="checkpoint-revert-desc" className="text-xs text-muted-foreground">{t('checkpoint.revertConfirmDesc')}</p>
          </div>
        </div>

        {/* Content */}
        <div className="px-5 pb-4">
          <div className="bg-muted rounded-lg p-3 mb-3 text-xs text-muted-foreground space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('destructive.tool')}</span>
              <span className="font-mono">{record.toolName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">{t('checkpoint.revertTime')}</span>
              <span>{formatTs(record.createdAt, i18n.language)}</span>
            </div>
            {record.agentId && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Agent</span>
                <span className="font-mono truncate ml-2 max-w-[280px]">{record.agentId}</span>
              </div>
            )}
          </div>

          {filesModifiedByTool.length > 0 && (
            <div className="mb-3">
              <div className="text-xs text-muted-foreground mb-1">
                {t('checkpoint.willRestore', { count: filesModifiedByTool.length })}
              </div>
              <ul className="space-y-1 max-h-32 overflow-auto">
                {filesModifiedByTool.map((f) => (
                  <li
                    key={f.path}
                    className="text-xs font-mono text-foreground bg-info/10/40 rounded px-2 py-1 truncate"
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
              <div className="text-xs text-muted-foreground mb-1">
                {t('checkpoint.willDelete', { count: filesAddedByTool.length })}
              </div>
              <ul className="space-y-1 max-h-32 overflow-auto">
                {filesAddedByTool.map((f) => (
                  <li
                    key={f.path}
                    className="text-xs font-mono text-foreground bg-danger/10/40 rounded px-2 py-1 truncate"
                    title={f.path}
                  >
                    ✕ {f.path}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="text-xs text-warning bg-warning/10/60 rounded px-3 py-2">
            {t('checkpoint.revertWarning')}
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-5 pb-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="flex-1 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors disabled:opacity-50"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="flex-1 px-4 py-2 text-sm font-medium bg-warning hover:bg-warning text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? t('checkpoint.reverting') : t('checkpoint.confirmRevert')}
          </button>
        </div>
      </div>
    </div>
  );
}
