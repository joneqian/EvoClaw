/**
 * CheckpointList — 最近 checkpoint 列表
 *
 * 单条卡片展示：工具名 + 时间 + 文件清单 + 撤销按钮 / 已撤销徽标。
 * 点击撤销按钮触发外部 onRequestRevert，由父级弹 CheckpointRevertDialog 二次确认。
 */

import { RotateCcw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { CheckpointRecord } from '../hooks/useCheckpoints';

interface Props {
  list: CheckpointRecord[];
  onRequestRevert: (record: CheckpointRecord) => void;
}

function formatTs(ms: number, locale: string, t: (key: string, opts?: Record<string, unknown>) => string): string {
  const date = new Date(ms);
  const diffMs = Date.now() - ms;
  if (diffMs < 60_000) return t('checkpoint.timeJustNow');
  if (diffMs < 60 * 60_000) return t('checkpoint.timeMinutesAgo', { count: Math.floor(diffMs / 60_000) });
  if (diffMs < 24 * 60 * 60_000) return t('checkpoint.timeHoursAgo', { count: Math.floor(diffMs / 3_600_000) });
  return date.toLocaleString(locale, { hour12: false });
}

const TOOL_LABEL_KEYS: Record<string, string> = {
  write: 'tool.write',
  edit: 'tool.edit',
  apply_patch: 'tool.applyPatch',
};

function toolLabel(name: string, t: (key: string) => string): string {
  const key = TOOL_LABEL_KEYS[name];
  return key ? t(key) : name;
}

export default function CheckpointList({ list, onRequestRevert }: Props) {
  const { t, i18n } = useTranslation();
  if (list.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground text-sm">
        <RotateCcw className="w-12 h-12 mx-auto mb-3 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
        <p>{t('checkpoint.noCheckpoints')}</p>
        <p className="text-xs mt-1 text-muted-foreground">{t('checkpoint.noCheckpointsHint')}</p>
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
            className={`bg-card border rounded-xl px-4 py-3 transition-colors ${
              reverted ? 'border-border opacity-60' : 'border-border hover:border-warning/40'
            }`}
          >
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-foreground">{toolLabel(r.toolName, t)}</span>
                  <span className="text-xs text-muted-foreground">{formatTs(r.createdAt, i18n.language, t)}</span>
                  {reverted && (
                    <span className="text-xs px-1.5 py-0.5 bg-accent text-muted-foreground rounded">
                      {t('checkpointList.reverted')}
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {editedFiles > 0 && <span>{t('checkpointList.filesEdited', { count: editedFiles })}</span>}
                  {editedFiles > 0 && newFiles > 0 && <span className="mx-1">·</span>}
                  {newFiles > 0 && <span>{t('checkpointList.filesAdded', { count: newFiles })}</span>}
                </div>
              </div>
              {!reverted && (
                <button
                  type="button"
                  onClick={() => onRequestRevert(r)}
                  className="text-xs px-3 py-1.5 bg-warning/10 hover:bg-warning/15 text-warning rounded-md font-medium transition-colors flex-shrink-0"
                >
                  {t('checkpointList.revert')}
                </button>
              )}
            </div>

            {/* 文件清单（折叠展开 first 3） */}
            <ul className="space-y-0.5 max-h-24 overflow-y-auto">
              {r.files.slice(0, 5).map((f) => (
                <li
                  key={f.path}
                  className="text-xs font-mono text-muted-foreground truncate"
                  title={f.path}
                >
                  {f.existedBefore ? '↩' : '✕'} {f.path}
                </li>
              ))}
              {r.files.length > 5 && (
                <li className="text-xs text-muted-foreground">{t('checkpointList.moreFiles', { count: r.files.length - 5 })}</li>
              )}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}
