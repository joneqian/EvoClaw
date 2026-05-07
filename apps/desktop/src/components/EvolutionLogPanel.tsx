/**
 * M7.1 — Skill 进化日志面板
 *
 * 左列：进化决策列表（时间 / decision / skill / reasoning 摘要 / 回滚标记）
 * 右列：选中决策详情（before/after 内容并排 + 回滚按钮）
 */

import { useState, useEffect, useCallback } from 'react';
import ReactDiffViewer, { DiffMethod } from 'react-diff-viewer-continued';
import { get, post } from '../lib/api';

/** 大于此长度的 SKILL.md 默认折叠 diff，避免渲染卡顿（仍可点开） */
const DIFF_LARGE_THRESHOLD = 50 * 1024; // 50KB

type Decision = 'refine' | 'create' | 'skip';

type TriggerSource = 'cron' | 'inline';

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
  triggerSource: TriggerSource;
}

interface EvolutionLogDetail extends EvolutionLogListItem {
  evidenceSummary: string | null;
  previousContent: string | null;
  newContent: string | null;
  /** P1-B: 仅 trigger_source='inline' 可能填充 */
  conversationalFeedback?: string | null;
}

function triggerLabel(source: TriggerSource): string {
  return source === 'inline' ? '自我修复' : '定时';
}

function triggerBadgeClass(source: TriggerSource): string {
  return source === 'inline'
    ? 'bg-violet-100 text-violet-700'
    : 'bg-slate-100 text-slate-600';
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

interface InlineStats {
  windowDays: number;
  total: number;
  errorCount: number;
  byDecision: { refine: number; create: number; skip: number };
  topSkills: Array<{ skillName: string; count: number }>;
  byDate: Array<{ date: string; count: number }>;
}

export default function EvolutionLogPanel() {
  const [entries, setEntries] = useState<EvolutionLogListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<EvolutionLogDetail | null>(null);
  const [rollbackInFlight, setRollbackInFlight] = useState(false);
  const [inlineStats, setInlineStats] = useState<InlineStats | null>(null);

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
    get<InlineStats>('/skill-evolution/inline-stats?days=30')
      .then(setInlineStats)
      .catch(err => {
        // 拉失败不影响列表展示
        // eslint-disable-next-line no-console
        console.warn('[inline-stats] failed:', err);
      });
  }, []);

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

  // P1-B 触发率观测：用 server endpoint 数据替换 client 端聚合（精确，不受 100 条限制）
  const inlineSuccessful = inlineStats
    ? inlineStats.byDecision.refine + inlineStats.byDecision.create - inlineStats.errorCount
    : 0;
  const inlineSuccessRate = inlineStats && inlineStats.total > 0
    ? Math.round((Math.max(0, inlineSuccessful) / inlineStats.total) * 100)
    : null;

  return (
    <div className="flex gap-4 h-full">
      {/* 左列：列表 */}
      <div className="w-[360px] shrink-0 overflow-y-auto">
        {inlineStats && inlineStats.total > 0 && (
          <div className="mb-3 p-2.5 rounded-lg border border-violet-200 bg-violet-50/50">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-violet-700">
                自我修复 · 近 {inlineStats.windowDays} 天
              </span>
              <span className="text-[10px] text-violet-500">
                共 {inlineStats.total} · 成功率 {inlineSuccessRate ?? '—'}%
              </span>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-violet-600">
              <span>refine {inlineStats.byDecision.refine}</span>
              <span>create {inlineStats.byDecision.create}</span>
              <span>skip {inlineStats.byDecision.skip}</span>
              {inlineStats.errorCount > 0 && (
                <span className="text-rose-600">err {inlineStats.errorCount}</span>
              )}
            </div>
            {inlineStats.topSkills.length > 0 && (
              <div className="mt-1.5 text-[10px] text-violet-500 truncate">
                热门：{inlineStats.topSkills.map(s => `${s.skillName}×${s.count}`).join('，')}
              </div>
            )}
          </div>
        )}
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
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-semibold ${decisionColor(e.decision, e.rolledBack === 1)}`}>
                    {decisionLabel(e.decision)}
                  </span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${triggerBadgeClass(e.triggerSource)}`}>
                    {triggerLabel(e.triggerSource)}
                  </span>
                </div>
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
                <div className="text-xs text-slate-500 mt-1 flex items-center gap-2 flex-wrap">
                  <span>{new Date(detail.evolvedAt).toLocaleString()}</span>
                  <span>·</span>
                  <span>{decisionLabel(detail.decision)}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded ${triggerBadgeClass(detail.triggerSource)}`}>
                    {triggerLabel(detail.triggerSource)}
                  </span>
                  {detail.modelUsed && <span>· {detail.modelUsed}</span>}
                  {detail.durationMs != null && <span>· {Math.round(detail.durationMs)}ms</span>}
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
            {detail.triggerSource === 'inline' && detail.conversationalFeedback && (
              <div className="mt-3 p-2 rounded bg-violet-50 border border-violet-200 text-xs text-violet-800">
                <strong className="text-violet-600">用户反馈原文：</strong>
                <span className="whitespace-pre-wrap">{detail.conversationalFeedback}</span>
              </div>
            )}
          </div>

          {(detail.previousContent || detail.newContent) && (
            <ContentDiffSection
              previousContent={detail.previousContent}
              newContent={detail.newContent}
              previousHash={detail.previousHash}
              newHash={detail.newHash}
              decision={detail.decision}
            />
          )}

          {/* M7-Tier1 PR1: HTML diff 区在 ContentDiffSection 里独立渲染 */}
          {/* （raw before/after 文本已替换为 ReactDiffViewer + 大文件折叠兜底） */}
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

// ─── M7-Tier1 PR1: HTML diff 子组件 ─────────────────────────────────────────

interface ContentDiffSectionProps {
  previousContent: string | null;
  newContent: string | null;
  previousHash: string | null;
  newHash: string | null;
  decision: Decision;
}

/**
 * SKILL.md 变更 diff 渲染。
 * - decision='refine'：unified diff（带 split 切换）
 * - decision='create'：仅显示 newContent（previous 必为 null）
 * - 大文件（> 50KB）默认折叠 + 显示 raw before/after，避免 ReactDiffViewer 重渲染卡顿
 */
function ContentDiffSection({ previousContent, newContent, previousHash, newHash, decision }: ContentDiffSectionProps) {
  const [splitView, setSplitView] = useState(false);
  const [forceShowDiff, setForceShowDiff] = useState(false);

  const oldText = previousContent ?? '';
  const newText = newContent ?? '';
  const isLarge = oldText.length > DIFF_LARGE_THRESHOLD || newText.length > DIFF_LARGE_THRESHOLD;
  const showDiff = !isLarge || forceShowDiff;

  // create 决策没有 previous，只展示 new 全量 + 语法高亮
  if (decision === 'create') {
    return (
      <div>
        <h4 className="text-sm font-semibold text-slate-800 mb-2">
          新建 SKILL.md 内容（new_hash: <code className="font-mono text-xs">{newHash?.slice(0, 8) ?? '—'}</code>）
        </h4>
        <pre className="text-xs p-3 rounded-lg bg-emerald-50 border border-emerald-100 overflow-x-auto max-h-[480px] whitespace-pre-wrap">
          {newContent ?? '（无）'}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-slate-800">
          SKILL.md 变更
          <span className="ml-2 text-xs font-normal text-slate-400">
            <code className="font-mono">{previousHash?.slice(0, 8) ?? '—'}</code>
            {' → '}
            <code className="font-mono">{newHash?.slice(0, 8) ?? '—'}</code>
          </span>
        </h4>
        {showDiff && (
          <button
            onClick={() => setSplitView(v => !v)}
            className="text-xs px-2 py-0.5 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
            title="切换并排 / 行内 diff 视图"
          >
            {splitView ? '行内 diff' : '并排 diff'}
          </button>
        )}
      </div>

      {showDiff ? (
        <div className="border border-slate-200 rounded-lg overflow-hidden text-xs max-h-[480px] overflow-y-auto">
          <ReactDiffViewer
            oldValue={oldText}
            newValue={newText}
            splitView={splitView}
            compareMethod={DiffMethod.LINES}
            useDarkTheme={false}
            hideLineNumbers={false}
            showDiffOnly={true}
            extraLinesSurroundingDiff={2}
            leftTitle="改动前"
            rightTitle="改动后"
          />
        </div>
      ) : (
        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
          <p className="mb-2">
            <strong>大文件</strong>（previous {Math.round(oldText.length / 1024)} KB / new {Math.round(newText.length / 1024)} KB），diff 已折叠以避免渲染卡顿。
          </p>
          <button
            onClick={() => setForceShowDiff(true)}
            className="px-2 py-0.5 rounded bg-white border border-amber-300 text-amber-700 hover:bg-amber-100"
          >
            仍要展开 diff
          </button>
        </div>
      )}
    </div>
  );
}
