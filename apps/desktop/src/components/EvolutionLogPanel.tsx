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

/** M7-Tier3 PR-T3-1b: trigger_source 增 ab-promote / ab-rollback / curator-* 系列；
 *  保持向前兼容 — 后端可能写未知 source，前端都按"其他"渲染 */
type TriggerSource = 'cron' | 'inline' | 'ab-promote' | 'ab-rollback' | 'ab-inconclusive' | string;

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
  /** M7-Tier3 PR-T3-2a: dryRun 模式产物 */
  pendingApproval: number;
  approvalDecidedAt: string | null;
  approvalDecidedBy: string | null;
}

interface EvolutionLogDetail extends EvolutionLogListItem {
  evidenceSummary: string | null;
  previousContent: string | null;
  newContent: string | null;
  /** P1-B: 仅 trigger_source='inline' 可能填充 */
  conversationalFeedback?: string | null;
}

type ListFilter = 'all' | 'pending';

function triggerLabel(source: TriggerSource): string {
  switch (source) {
    case 'inline': return '自我修复';
    case 'cron': return '定时';
    case 'ab-promote': return 'A-B 升级';
    case 'ab-rollback': return 'A-B 回滚';
    case 'ab-inconclusive': return 'A-B 不显著';
    default: return source.startsWith('curator-') ? 'Curator' : source;
  }
}

function triggerBadgeClass(source: TriggerSource): string {
  switch (source) {
    case 'inline': return 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-300';
    case 'cron': return 'bg-accent text-muted-foreground';
    case 'ab-promote': return 'bg-success/15 text-success';
    case 'ab-rollback': return 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300';
    case 'ab-inconclusive': return 'bg-warning/15 text-warning';
    default: return 'bg-accent text-muted-foreground';
  }
}

function decisionColor(decision: Decision, rolledBack: boolean): string {
  if (rolledBack) return 'text-muted-foreground line-through';
  switch (decision) {
    case 'refine': return 'text-info';
    case 'create': return 'text-success';
    case 'skip':   return 'text-muted-foreground';
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

/** M7-Tier3 PR-T3-1c/2b: A-B 测试进度（canary 字段 PR-T3-2b 引入） */
interface AbActiveTest {
  id: number;
  skillName: string;
  status: string;
  variantAHash: string;
  variantBHash: string;
  startedAt: string;
  minCallsPerVariant: number;
  maxTestDays: number;
  outcomeCounts: { A: number; B: number };
  progress: number;
  /** M7-Tier3 PR-T3-2b: canary 模式标识（兼容旧后端：缺字段时按 0 处理） */
  isCanary?: number;
  canaryRatioB?: number | null;
}

interface AbHistoryEntry {
  id: number;
  skillName: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  decisionReason: string | null;
  pValue: number | null;
  effectSize: number | null;
}

interface AbStatusResponse {
  active: AbActiveTest[];
  history: AbHistoryEntry[];
}

function abStatusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case 'promoted':     return { label: '✅ 升级', cls: 'bg-success/15 text-success' };
    case 'rolled_back':  return { label: '↩ 回滚', cls: 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300' };
    case 'inconclusive': return { label: '— 不显著', cls: 'bg-warning/15 text-warning' };
    default:             return { label: status, cls: 'bg-accent text-muted-foreground' };
  }
}

function daysRemaining(startedAt: string, maxTestDays: number): number {
  const elapsedMs = Date.now() - new Date(startedAt).getTime();
  const remainingMs = maxTestDays * 86400_000 - elapsedMs;
  return Math.max(0, Math.ceil(remainingMs / 86400_000));
}

export default function EvolutionLogPanel() {
  const [entries, setEntries] = useState<EvolutionLogListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<EvolutionLogDetail | null>(null);
  const [rollbackInFlight, setRollbackInFlight] = useState(false);
  const [inlineStats, setInlineStats] = useState<InlineStats | null>(null);
  const [abStatus, setAbStatus] = useState<AbStatusResponse | null>(null);
  /** M7-Tier3 PR-T3-2a: 列表过滤 + 待审计数 + 应用/拒绝行内态 */
  const [filter, setFilter] = useState<ListFilter>('all');
  const [pendingCount, setPendingCount] = useState<number>(0);
  const [approvalInFlight, setApprovalInFlight] = useState<'apply' | 'reject' | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const url = filter === 'pending'
        ? '/skill-evolution/log?limit=100&pending=1'
        : '/skill-evolution/log?limit=100';
      const data = await get<{ entries: EvolutionLogListItem[] }>(url);
      setEntries(data.entries);
      if (data.entries.length > 0 && selectedId == null) {
        setSelectedId(data.entries[0].id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [filter, selectedId]);

  useEffect(() => { loadList(); }, [loadList]);

  // M7-Tier3 PR-T3-2a: 拉待审数量（用于过滤 chip 上的徽章数字）
  const loadPendingCount = useCallback(() => {
    get<{ count: number }>('/skill-evolution/log/pending-count')
      .then(d => setPendingCount(d.count))
      .catch(err => {
        // eslint-disable-next-line no-console
        console.warn('[pending-count] failed:', err);
      });
  }, []);
  useEffect(() => { loadPendingCount(); }, [loadPendingCount]);

  useEffect(() => {
    get<InlineStats>('/skill-evolution/inline-stats?days=30')
      .then(setInlineStats)
      .catch(err => {
        // 拉失败不影响列表展示
        // eslint-disable-next-line no-console
        console.warn('[inline-stats] failed:', err);
      });
  }, []);

  // M7-Tier3 PR-T3-1c: 拉 A-B 状态
  const loadAbStatus = useCallback(() => {
    get<AbStatusResponse>('/skill-evolution/ab-status')
      .then(setAbStatus)
      .catch(err => {
        // eslint-disable-next-line no-console
        console.warn('[ab-status] failed:', err);
      });
  }, []);
  useEffect(() => { loadAbStatus(); }, [loadAbStatus]);

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      return;
    }
    get<{ entry: EvolutionLogDetail }>(`/skill-evolution/log/${selectedId}`)
      .then(d => setDetail(d.entry))
      .catch(err => setError(err instanceof Error ? err.message : String(err)));
  }, [selectedId]);

  /** M7-Tier3 PR-T3-2a: 应用一条 dryRun 待审决策 */
  const handleApply = async () => {
    if (!detail) return;
    if (!window.confirm(`确认应用 ${detail.skillName} 的这次 ${detail.decision === 'create' ? '新建' : '改进'}？SKILL.md 将被写入。`)) {
      return;
    }
    setApprovalInFlight('apply');
    try {
      await post(`/skill-evolution/log/${detail.id}/apply`);
      await loadList();
      loadPendingCount();
      const d = await get<{ entry: EvolutionLogDetail }>(`/skill-evolution/log/${detail.id}`);
      setDetail(d.entry);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // 409 防覆盖错误友好提示
      if (msg.includes('SKILL.md changed since')) {
        setError('应用失败：SKILL.md 在 dryRun 期间被手动修改过。请先拒绝此决策，然后让 evolver 基于最新内容重新决策。');
      } else {
        setError(msg);
      }
    } finally {
      setApprovalInFlight(null);
    }
  };

  /** M7-Tier3 PR-T3-2a: 拒绝一条 dryRun 待审决策 */
  const handleReject = async () => {
    if (!detail) return;
    if (!window.confirm(`确认拒绝 ${detail.skillName} 的这次决策？SKILL.md 不会被改动。`)) {
      return;
    }
    setApprovalInFlight('reject');
    try {
      await post(`/skill-evolution/log/${detail.id}/reject`);
      await loadList();
      loadPendingCount();
      const d = await get<{ entry: EvolutionLogDetail }>(`/skill-evolution/log/${detail.id}`);
      setDetail(d.entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApprovalInFlight(null);
    }
  };

  const handleRollback = async () => {
    if (!detail) return;
    if (!window.confirm(`确定要回滚 ${detail.skillName} 的这次改进吗？SKILL.md 将恢复到改动前版本。`)) {
      return;
    }
    setRollbackInFlight(true);
    try {
      await post(`/skill-evolution/log/${detail.id}/rollback`);
      await loadList();
      loadAbStatus();
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
    return <div className="p-4 text-rose-600 dark:text-rose-300 text-sm">加载失败: {error}</div>;
  }
  if (loading && entries.length === 0) {
    return <div className="p-4 text-muted-foreground text-sm">加载中...</div>;
  }
  if (!loading && entries.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground text-sm">
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
          <div className="mb-3 p-2.5 rounded-lg border border-violet-200 dark:border-violet-800/60 bg-violet-50 dark:bg-violet-950/40/50">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold text-violet-700 dark:text-violet-300">
                自我修复 · 近 {inlineStats.windowDays} 天
              </span>
              <span className="text-[10px] text-violet-500">
                共 {inlineStats.total} · 成功率 {inlineSuccessRate ?? '—'}%
              </span>
            </div>
            <div className="flex items-center gap-3 text-[10px] text-violet-600 dark:text-violet-300">
              <span>refine {inlineStats.byDecision.refine}</span>
              <span>create {inlineStats.byDecision.create}</span>
              <span>skip {inlineStats.byDecision.skip}</span>
              {inlineStats.errorCount > 0 && (
                <span className="text-rose-600 dark:text-rose-300">err {inlineStats.errorCount}</span>
              )}
            </div>
            {inlineStats.topSkills.length > 0 && (
              <div className="mt-1.5 text-[10px] text-violet-500 truncate">
                热门：{inlineStats.topSkills.map(s => `${s.skillName}×${s.count}`).join('，')}
              </div>
            )}
          </div>
        )}
        <AbStatusCard status={abStatus} />
        {/* M7-Tier3 PR-T3-2a: 过滤 chip — 全部 / 待审核（带徽章） */}
        <div className="flex items-center gap-1 mb-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-2 py-0.5 text-xs rounded-full border ${
              filter === 'all'
                ? 'bg-brand text-white border-brand'
                : 'bg-card text-muted-foreground border-border hover:bg-muted'
            }`}
          >全部</button>
          <button
            onClick={() => setFilter('pending')}
            className={`px-2 py-0.5 text-xs rounded-full border inline-flex items-center gap-1 ${
              filter === 'pending'
                ? 'bg-info text-white border-info'
                : 'bg-card text-muted-foreground border-border hover:bg-muted'
            }`}
          >
            待审核
            {pendingCount > 0 && (
              <span className={`px-1.5 py-0 text-[10px] rounded-full ${
                filter === 'pending' ? 'bg-card/20 text-white' : 'bg-info/15 text-info'
              }`}>{pendingCount}</span>
            )}
          </button>
        </div>
        <div className="text-xs text-muted-foreground mb-2">{entries.length} 条记录（最近 100 条）</div>
        {entries.map(e => {
          const active = e.id === selectedId;
          const canRollback = e.decision === 'refine' && e.rolledBack === 0 && !e.errorMessage;
          return (
            <button
              key={e.id}
              onClick={() => setSelectedId(e.id)}
              className={`w-full text-left p-3 mb-2 rounded-lg border transition-colors ${active ? 'border-brand bg-brand/5' : 'border-border bg-card hover:bg-muted'}`}
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
                <span className="text-xs text-muted-foreground">
                  {new Date(e.evolvedAt).toLocaleString()}
                </span>
              </div>
              <div className="font-semibold text-sm text-foreground mt-1 truncate">{e.skillName}</div>
              {e.reasoning && (
                <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{e.reasoning}</div>
              )}
              <div className="flex items-center gap-2 mt-2 text-xs">
                {e.pendingApproval === 1 && <span className="px-1.5 py-0.5 rounded bg-info/15 text-info text-[10px]">待审核</span>}
                {e.approvalDecidedBy === 'manual-apply' && <span className="text-success">✅ 已应用</span>}
                {e.approvalDecidedBy === 'manual-reject' && <span className="text-muted-foreground">⊘ 已拒绝</span>}
                {e.errorMessage && <span className="text-rose-600 dark:text-rose-300">❌ 失败</span>}
                {e.rolledBack === 1 && e.approvalDecidedBy !== 'manual-reject' && <span className="text-warning">↩ 已回滚</span>}
                {canRollback && <span className="text-muted-foreground">可回滚</span>}
                <span className="text-muted-foreground">证据 {e.evidenceCount} 条</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* 右列：详情 */}
      {detail ? (
        <div className="flex-1 overflow-y-auto space-y-4">
          <div className="p-4 rounded-lg bg-muted border border-border">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-foreground">{detail.skillName}</h3>
                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
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
              {/* M7-Tier3 PR-T3-2a: dryRun 待审决策的应用/拒绝按钮（优先于回滚 UI） */}
              {detail.pendingApproval === 1 && !detail.errorMessage && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleApply}
                    disabled={approvalInFlight !== null}
                    className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-success text-white hover:bg-success disabled:opacity-50"
                  >
                    {approvalInFlight === 'apply' ? '应用中…' : '✅ 应用'}
                  </button>
                  <button
                    onClick={handleReject}
                    disabled={approvalInFlight !== null}
                    className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-accent text-foreground hover:bg-border disabled:opacity-50"
                  >
                    {approvalInFlight === 'reject' ? '拒绝中…' : '⊘ 拒绝'}
                  </button>
                </div>
              )}
              {detail.approvalDecidedBy === 'manual-apply' && (
                <span className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-success/15 text-success">
                  ✅ 已应用 {detail.approvalDecidedAt ? `· ${new Date(detail.approvalDecidedAt).toLocaleString()}` : ''}
                </span>
              )}
              {detail.approvalDecidedBy === 'manual-reject' && (
                <span className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-accent text-muted-foreground">
                  ⊘ 已拒绝 {detail.approvalDecidedAt ? `· ${new Date(detail.approvalDecidedAt).toLocaleString()}` : ''}
                </span>
              )}
              {detail.pendingApproval === 0 && detail.approvalDecidedBy !== 'manual-apply' && detail.approvalDecidedBy !== 'manual-reject' && detail.decision === 'refine' && detail.rolledBack === 0 && !detail.errorMessage && (
                <button
                  onClick={handleRollback}
                  disabled={rollbackInFlight}
                  className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-warning text-white hover:bg-warning disabled:opacity-50"
                >
                  {rollbackInFlight ? '回滚中...' : '↩ 回滚此改动'}
                </button>
              )}
              {detail.rolledBack === 1 && detail.approvalDecidedBy !== 'manual-reject' && (
                <span className="px-3 py-1.5 text-sm font-semibold rounded-lg bg-warning/15 text-warning">
                  ↩ 已回滚
                </span>
              )}
            </div>
            {detail.reasoning && (
              <div className="mt-3 text-sm text-foreground whitespace-pre-wrap">
                <strong className="text-muted-foreground">LLM 理由：</strong>{detail.reasoning}
              </div>
            )}
            {detail.errorMessage && (
              <div className="mt-3 p-2 rounded bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800/60 text-xs text-rose-700 dark:text-rose-300 whitespace-pre-wrap">
                <strong>错误：</strong>{detail.errorMessage}
              </div>
            )}
            {detail.triggerSource === 'inline' && detail.conversationalFeedback && (
              <div className="mt-3 p-2 rounded bg-violet-50 dark:bg-violet-950/40 border border-violet-200 dark:border-violet-800/60 text-xs text-violet-800">
                <strong className="text-violet-600 dark:text-violet-300">用户反馈原文：</strong>
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
            <details className="p-3 rounded-lg bg-card border border-border">
              <summary className="cursor-pointer text-xs text-muted-foreground">Patches 列表</summary>
              <pre className="mt-2 text-xs whitespace-pre-wrap">{detail.patchesApplied}</pre>
            </details>
          )}

          {detail.evidenceSummary && (
            <details className="p-3 rounded-lg bg-card border border-border">
              <summary className="cursor-pointer text-xs text-muted-foreground">证据摘要</summary>
              <pre className="mt-2 text-xs whitespace-pre-wrap">{detail.evidenceSummary}</pre>
            </details>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ─── M7-Tier3 PR-T3-1c: A-B 测试状态卡片 ────────────────────────────────────

function AbStatusCard({ status }: { status: AbStatusResponse | null }) {
  if (!status) return null;
  const hasContent = status.active.length > 0 || status.history.length > 0;
  if (!hasContent) return null;

  return (
    <div className="mb-3 p-2.5 rounded-lg border border-sky-200 dark:border-sky-800/60 bg-sky-50 dark:bg-sky-950/40/50 space-y-2">
      <div className="text-xs font-semibold text-sky-700 dark:text-sky-300">A-B 对照实验</div>

      {status.active.length > 0 && (
        <div className="space-y-1.5">
          {status.active.map(test => {
            const isCanary = test.isCanary === 1;
            const canaryPct = test.canaryRatioB != null ? Math.round(test.canaryRatioB * 100) : 10;
            return (
              <div key={test.id} className="text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground truncate flex items-center gap-1">
                    {isCanary && (
                      <span className="px-1 py-0 rounded bg-warning/15 text-warning text-[10px]" title={`Canary ${canaryPct}%`}>
                        🐤 {canaryPct}%
                      </span>
                    )}
                    {test.skillName}
                  </span>
                  <span className="text-sky-600 dark:text-sky-300 shrink-0 ml-2">
                    剩 {daysRemaining(test.startedAt, test.maxTestDays)} 天
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <div className="flex-1 h-1.5 rounded-full bg-accent overflow-hidden">
                    <div
                      className={`h-full transition-all ${isCanary ? 'bg-warning' : 'bg-sky-500'}`}
                      style={{ width: `${Math.round(test.progress * 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums">
                    A {test.outcomeCounts.A} / B {test.outcomeCounts.B}
                    <span className="text-muted-foreground"> · 目标 {test.minCallsPerVariant}</span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {status.history.length > 0 && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-sky-600 dark:text-sky-300 hover:text-sky-700 dark:text-sky-300">
            最近 {status.history.length} 次决策
          </summary>
          <div className="mt-1.5 space-y-1">
            {status.history.map(h => {
              const badge = abStatusBadge(h.status);
              return (
                <div key={h.id} className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] ${badge.cls}`}>
                        {badge.label}
                      </span>
                      <span className="text-foreground truncate">{h.skillName}</span>
                    </div>
                    {h.decisionReason && (
                      <div className="text-muted-foreground truncate mt-0.5" title={h.decisionReason}>
                        {h.decisionReason}
                      </div>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground shrink-0 text-right tabular-nums">
                    {h.pValue != null && <div>p={h.pValue.toFixed(3)}</div>}
                    {h.effectSize != null && <div>Δ={(h.effectSize * 100).toFixed(0)}%</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </details>
      )}
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
        <h4 className="text-sm font-semibold text-foreground mb-2">
          新建 SKILL.md 内容（new_hash: <code className="font-mono text-xs">{newHash?.slice(0, 8) ?? '—'}</code>）
        </h4>
        <pre className="text-xs p-3 rounded-lg bg-success/10 border border-success/20 overflow-x-auto max-h-[480px] whitespace-pre-wrap">
          {newContent ?? '（无）'}
        </pre>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-foreground">
          SKILL.md 变更
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            <code className="font-mono">{previousHash?.slice(0, 8) ?? '—'}</code>
            {' → '}
            <code className="font-mono">{newHash?.slice(0, 8) ?? '—'}</code>
          </span>
        </h4>
        {showDiff && (
          <button
            onClick={() => setSplitView(v => !v)}
            className="text-xs px-2 py-0.5 rounded border border-border text-muted-foreground hover:bg-muted"
            title="切换并排 / 行内 diff 视图"
          >
            {splitView ? '行内 diff' : '并排 diff'}
          </button>
        )}
      </div>

      {showDiff ? (
        <div className="border border-border rounded-lg overflow-hidden text-xs max-h-[480px] overflow-y-auto">
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
        <div className="p-3 rounded-lg bg-warning/10 border border-warning/30 text-xs text-warning">
          <p className="mb-2">
            <strong>大文件</strong>（previous {Math.round(oldText.length / 1024)} KB / new {Math.round(newText.length / 1024)} KB），diff 已折叠以避免渲染卡顿。
          </p>
          <button
            onClick={() => setForceShowDiff(true)}
            className="px-2 py-0.5 rounded bg-card border border-warning/40 text-warning hover:bg-warning/15"
          >
            仍要展开 diff
          </button>
        </div>
      )}
    </div>
  );
}
