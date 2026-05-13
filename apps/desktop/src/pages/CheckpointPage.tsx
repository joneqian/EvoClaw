/**
 * CheckpointPage — 撤销改动 Tab
 *
 * 列出最近 N 条 checkpoint，让用户一键撤销 agent 的破坏性工具调用
 * （write / edit）。后端通过 /checkpoint REST API 提供数据。
 *
 * UI 风格对齐 EvolutionPage / TasksPage 等：单列卡片、面向非程序员用户。
 */

import { useState } from 'react';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useCheckpoints, type CheckpointRecord } from '../hooks/useCheckpoints';
import CheckpointList from '../components/CheckpointList';
import CheckpointRevertDialog from '../components/CheckpointRevertDialog';

export default function CheckpointPage() {
  const { t } = useTranslation();
  const { list, loading, error, refresh, revert } = useCheckpoints(50);
  const [pending, setPending] = useState<CheckpointRecord | null>(null);
  const [busy, setBusy] = useState(false);

  const handleConfirm = async () => {
    if (!pending) return;
    setBusy(true);
    const result = await revert(pending.toolInvocationId);
    setBusy(false);
    setPending(null);
    if (result.ok) {
      toast.success(t('checkpoint.revertSuccess', { count: result.restored ?? 0 }));
    } else {
      toast.error(result.error ?? t('checkpoint.revertFailed'));
    }
  };

  return (
    <div className="flex-1 overflow-auto bg-muted">
      <div className="max-w-3xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-foreground">{t('checkpoint.title')}</h1>
            <p className="text-sm text-muted-foreground mt-1">
              {t('checkpoint.desc')}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="text-xs px-3 py-1.5 border border-border hover:bg-accent rounded-md text-muted-foreground transition-colors disabled:opacity-50"
          >
            {loading ? t('common.refreshing') : t('common.refresh')}
          </button>
        </div>

        {/* Error */}
        {error && !loading && (
          <div className="mb-4 px-4 py-3 bg-danger/10 border border-danger/30 rounded-lg text-sm text-danger">
            {t('checkpoint.loadFailed', { error })}
          </div>
        )}

        {/* List */}
        {!loading && (
          <CheckpointList list={list} onRequestRevert={setPending} />
        )}

        {loading && list.length === 0 && (
          <div className="text-center py-16 text-muted-foreground text-sm">{t('common.loading')}</div>
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
    </div>
  );
}
