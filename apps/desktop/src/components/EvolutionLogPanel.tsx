/**
 * M7.1 — Skill 进化日志面板
 *
 * 左列：进化决策列表（时间 / decision / skill / reasoning 摘要 / 回滚标记）
 * 右列：选中决策详情（before/after 内容并排 + 回滚按钮）
 */

import { useState, useEffect, useCallback } from 'react';
import { get, post } from '../lib/api';

type Decision = 'refine' | 'create' | 'skip';

interface EvolutionLogListItem {
  id: number;
  skillName: string;
  evolvedAt: string;
  decision: Decision;
  reasoning: string | null;
  evidenceCount: number;
  patchesApplied: string | null;
  previousHash: string | null;
  newHash: string | null;
  modelUsed: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  rolledBack: number;
}

interface EvolutionLogDetail extends EvolutionLogListItem {
  evidenceSummary: string | null;
  previousContent: string | null;
  newContent: string | null;
}

function decisionColor(decision: Decision, rolledBack: boolean): string {
  if (rolledBack) return 'text-slate-400 line-through';
  switch (decision) {
    case 'refine': return 'text-blue-600';
    case 'create': return 'text-emerald-600';
    case 'skip':   return 'text-slate-500';
  }
}

function decisionLabel(decision: Decision): string {
  switch (decision) {
    case 'refine': return '改进';
    case 'create': return '新建';
    case 'skip':   return '跳过';
  }
}

export default function EvolutionLogPanel() {
  const [entries, setEntries] = useState<EvolutionLogListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<EvolutionLogDetail | null>(null);
  const [rollbackInFlight, setRollbackInFlight] = useState(false);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await get<{ entries: EvolutionLogListItem[] }>('/skill-evolution/log?limit=100');
      setEntries(data.entries);
      if (data.entries.length > 0 && selectedId == null) {
        setSelectedId(data.entries[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [selectedId]);

  useEffect(() => { loadList(); }, [loadList]);

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      return;
    }
    get<{ entry: EvolutionLogDetail }>(`/skill-evolution/log/${selectedId}`)
      .then(d => setDetail(d.entry))
      .catch(err => setError(err instanceof Error ? err.message : String(err)));
  }, [selectedId]);

  const handleRollback = async () => {
    if (!detail) return;
    if (!window.confirm(`确定要回滚 ${detail.skillName} 的这次改进吗？SKILL.md 将恢复到改动前版本。`)) {
      return;
    }
    setRollbackInFlight(true);
    try {
      await post(`/skill-evolution/log/${detail.id}/rollback`);
      await loadList();
      // 重新拉取详情（会看到 rolledBack=1）
      const d = await get<{ entry: EvolutionLogDetail }>(`/skill-evolution/log/${detail.id}`);
      setDetail(d.entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRollbackInFlight(false);
    }
  };

  if (error) {
    return <div className="p-4 text-rose-600 text-sm">加载失败: {error}</div>;
  }
  if (loading && entries.length === 0) {
    return <div className="p-4 text-slate-500 text-sm">加载中...</div>;
  }
  if (!loading && entries.length === 0) {
    return (
      <div className="p-8 text-center text-slate-500 text-sm">
        尚无进化记录（当 security.skillEvolver.enabled=true 时，后台 Cron 会写入决策日志）
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-full">
      {/* 左列：列表 */}
      <div className="w-[360px] shrink-0 overflow-y-auto">
        <div className="text-xs text-slate-500 mb-2">{entries.length} 条记录（最近 100 条）</div>
        {entries.map(e => {
          const active = e.id === selectedId;
          const canRollback = e.decision === 'refine' && e.rolledBack === 0 && !e.errorMessage;
          return (
            <button
              key={e.id}
              onClick={() => setSelectedId(e.id)}
              className={`w-full text-left p-3 mb-2 rounded-lg border transition-colors ${active ? 'border-brand bg-brand/5' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
            >
              <div className="flex items-center justify-between">
                <span className={`text-xs font-semibold ${decisionColor(e.decision, e.rolledBack === 1)}`}>
                  {decisionLabel(e.decision)}
                </span>
                <span className="text-xs text-slate-400">
                  {new Date(e.evolvedAt).toLocaleString()}
                </span>
              </div>
              <div className="font-semibold text-sm text-slate-800 mt-1 truncate">{e.skillName}</div>
              {e.reasoning && (
                <div className="text-xs text-slate-500 mt-1 line-clamp-2">{e.reasoning}</div>
              )}
              <div className="flex items-center gap-2 mt-2 text-xs">
                {e.errorMessage && <span className="text-rose-600">❌ 失败</span>}
                {e.rolledBack === 1 && <span className="text-amber-600">↩ 已回滚</span>}
                {canRollback && <span className="text-slate-400">可回滚</span>}
                <span className="text-slate-400">证据 {e.evidenceCount} 条</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* 右列：详情 */}
      {detail ? (
        <div className="flex-1 overflow-y-auto space-y-4">
          <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-slate-800">{detail.skillName}</h3>
                <div className="text-xs text-slate-500 mt-1">
                  {new Date(detail.evolvedAt).toLocaleString()} · {decisionLabel(detail.decision)}
                  {detail.modelUsed && ` · ${detail.modelUsed}`}
                  {detail.durationMs != null && ` · ${Math.round(detail.durationMs)}ms`}
                </div>
              </div>
              {detail.decision === 'refine' && detail.rolledBack === 0 && !detail.errorMessage && (
                <button
                  onClick={handleRollback}
                  disabled={rollbackInFlight}
                  className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50"
                >
                  {rollbackInFlight ? '回滚中...' : '↩ 回滚此改动'}
                </button>
              )}
              {detail.rolledBack === 1 && (
                <span className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-amber-100 text-amber-700">
                  ↩ 已回滚
                </span>
              )}
            </div>
            {detail.reasoning && (
              <div className="mt-3 text-sm text-slate-700 whitespace-pre-wrap">
                <strong className="text-slate-600">LLM 理由：</strong>{detail.reasoning}
              </div>
            )}
            {detail.errorMessage && (
              <div className="mt-3 p-2 rounded bg-rose-50 border border-rose-200 text-xs text-rose-700 whitespace-pre-wrap">
                <strong>错误：</strong>{detail.errorMessage}
              </div>
            )}
          </div>

          {(detail.previousContent || detail.newContent) && (
            <div>
              <h4 className="text-sm font-semibold text-slate-800 mb-2">SKILL.md 变更</h4>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <div className="text-xs text-slate-500 mb-1">改动前（previous_hash: {detail.previousHash?.slice(0, 8)}…）</div>
                  <pre className="text-xs p-3 rounded-lg bg-rose-50 border border-rose-100 overflow-x-auto max-h-[400px] whitespace-pre-wrap">
                    {detail.previousContent ?? '（无，create 前不存在）'}
                  </pre>
                </div>
                <div>
                  <div className="text-xs text-slate-500 mb-1">改动后（new_hash: {detail.newHash?.slice(0, 8)}…）</div>
                  <pre className="text-xs p-3 rounded-lg bg-emerald-50 border border-emerald-100 overflow-x-auto max-h-[400px] whitespace-pre-wrap">
                    {detail.newContent ?? '（无）'}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {detail.patchesApplied && detail.decision === 'refine' && (
            <details className="p-3 rounded-lg bg-white border border-slate-200">
              <summary className="cursor-pointer text-xs text-slate-600">Patches 列表</summary>
              <pre className="mt-2 text-xs whitespace-pre-wrap">{detail.patchesApplied}</pre>
            </details>
          )}

          {detail.evidenceSummary && (
            <details className="p-3 rounded-lg bg-white border border-slate-200">
              <summary className="cursor-pointer text-xs text-slate-600">证据摘要</summary>
              <pre className="mt-2 text-xs whitespace-pre-wrap">{detail.evidenceSummary}</pre>
            </details>
          )}
        </div>
      ) : null}
    </div>
  );
}
