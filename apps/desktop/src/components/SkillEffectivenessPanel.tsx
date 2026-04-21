/**
 * M7 Phase 2 — Skill 效能面板
 *
 * 展示当前 Agent 近 N 天调用过的所有 Skill：
 * - 左列：每个 Skill 一张卡（调用次数 / 成功率进度条 / 平均耗时 / 👍 x / 👎 y）
 * - 右列：选中 Skill 的最近调用详情 + LLM 摘要 + 👍/👎 反馈按钮
 */

import { useState, useEffect, useCallback } from 'react';
import { get, post } from '../lib/api';

interface SkillAggregateStats {
  skillName: string;
  invocationCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  avgDurationMs: number | null;
  lastInvokedAt: string | null;
  positiveFeedbackCount: number;
  negativeFeedbackCount: number;
}

interface SkillUsageRow {
  id: number;
  skillName: string;
  agentId: string;
  sessionKey: string;
  invokedAt: string;
  triggerType: string;
  executionMode: string;
  toolCallsCount: number;
  success: number;
  durationMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  errorSummary: string | null;
  userFeedback: number | null;
  feedbackNote: string | null;
}

interface SkillUsageSummaryRow {
  id: number;
  skillName: string;
  sessionKey: string;
  summaryText: string;
  invocationCount: number;
  successRate: number;
  summarizedAt: string;
  modelUsed: string | null;
}

interface Props {
  agentId: string;
  days?: number;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function successRateColor(rate: number): string {
  if (rate >= 0.8) return 'bg-emerald-500';
  if (rate >= 0.5) return 'bg-amber-500';
  return 'bg-rose-500';
}

export default function SkillEffectivenessPanel({ agentId, days = 7 }: Props) {
  const [skills, setSkills] = useState<SkillAggregateStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [selected, setSelected] = useState<string | null>(null);
  const [recent, setRecent] = useState<SkillUsageRow[]>([]);
  const [summaries, setSummaries] = useState<SkillUsageSummaryRow[]>([]);

  const loadEffectiveness = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    setError('');
    try {
      const data = await get<{ skills: SkillAggregateStats[] }>(
        `/skill-usage/effectiveness?agentId=${encodeURIComponent(agentId)}&days=${days}`,
      );
      setSkills(data.skills);
      if (data.skills.length > 0 && !selected) {
        setSelected(data.skills[0].skillName);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [agentId, days, selected]);

  useEffect(() => {
    loadEffectiveness();
  }, [loadEffectiveness]);

  useEffect(() => {
    if (!selected) {
      setRecent([]);
      setSummaries([]);
      return;
    }
    Promise.all([
      get<{ invocations: SkillUsageRow[] }>(
        `/skill-usage/recent?skill=${encodeURIComponent(selected)}&agentId=${encodeURIComponent(agentId)}&limit=5`,
      ).then(d => setRecent(d.invocations)),
      get<{ summaries: SkillUsageSummaryRow[] }>(
        `/skill-usage/summaries?skill=${encodeURIComponent(selected)}&limit=3`,
      ).then(d => setSummaries(d.summaries)),
    ]).catch(err => setError(err instanceof Error ? err.message : String(err)));
  }, [selected, agentId]);

  const submitFeedback = async (id: number, feedback: 1 | -1) => {
    try {
      await post(`/skill-usage/${id}/feedback`, { feedback });
      // 刷新 recent + effectiveness（反馈计数变化）
      await Promise.all([
        get<{ invocations: SkillUsageRow[] }>(
          `/skill-usage/recent?skill=${encodeURIComponent(selected!)}&agentId=${encodeURIComponent(agentId)}&limit=5`,
        ).then(d => setRecent(d.invocations)),
        loadEffectiveness(),
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  if (error) {
    return <div className="p-4 text-rose-600 text-sm">加载失败: {error}</div>;
  }

  if (loading && skills.length === 0) {
    return <div className="p-4 text-slate-500 text-sm">加载中...</div>;
  }

  if (!loading && skills.length === 0) {
    return (
      <div className="p-8 text-center text-slate-500 text-sm">
        近 {days} 天内该 Agent 尚未调用过任何 Skill
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-full">
      {/* 左列：Skill 列表 */}
      <div className="w-[360px] shrink-0 overflow-y-auto">
        <div className="text-xs text-slate-500 mb-2">近 {days} 天 · {skills.length} 个 Skill</div>
        {skills.map(s => {
          const active = s.skillName === selected;
          return (
            <button
              key={s.skillName}
              onClick={() => setSelected(s.skillName)}
              className={`w-full text-left p-3 mb-2 rounded-lg border transition-colors ${active ? 'border-brand bg-brand/5' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
            >
              <div className="font-semibold text-sm text-slate-800">{s.skillName}</div>
              <div className="flex items-center gap-2 mt-1 text-xs text-slate-500">
                <span>{s.invocationCount} 次</span>
                <span>·</span>
                <span>{formatDuration(s.avgDurationMs)}</span>
                {(s.positiveFeedbackCount > 0 || s.negativeFeedbackCount > 0) && (
                  <>
                    <span>·</span>
                    <span>👍 {s.positiveFeedbackCount} 👎 {s.negativeFeedbackCount}</span>
                  </>
                )}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full ${successRateColor(s.successRate)}`}
                    style={{ width: `${Math.round(s.successRate * 100)}%` }}
                  />
                </div>
                <span className="text-xs text-slate-600 tabular-nums">
                  {Math.round(s.successRate * 100)}%
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* 右列：详情 */}
      {selected ? (
        <div className="flex-1 overflow-y-auto space-y-4">
          <div>
            <h3 className="font-semibold text-slate-800 mb-2">{selected} — 最近 5 次调用</h3>
            {recent.length === 0 ? (
              <div className="text-sm text-slate-500">暂无调用记录</div>
            ) : (
              <div className="space-y-2">
                {recent.map(r => (
                  <div key={r.id} className="p-3 border border-slate-200 rounded-lg bg-white">
                    <div className="flex items-center justify-between text-xs text-slate-500">
                      <span>{new Date(r.invokedAt).toLocaleString()}</span>
                      <div className="flex items-center gap-2">
                        <span className={r.success === 1 ? 'text-emerald-600' : 'text-rose-600'}>
                          {r.success === 1 ? '✓ 成功' : '✗ 失败'}
                        </span>
                        <span>·</span>
                        <span>{formatDuration(r.durationMs)}</span>
                        <span>·</span>
                        <span>{r.executionMode}</span>
                      </div>
                    </div>
                    {r.errorSummary && (
                      <div className="mt-1 text-xs text-rose-600">{r.errorSummary}</div>
                    )}
                    <div className="mt-2 flex items-center gap-3">
                      <button
                        onClick={() => submitFeedback(r.id, 1)}
                        disabled={r.userFeedback === 1}
                        className={`px-2 py-0.5 text-xs rounded ${r.userFeedback === 1 ? 'bg-emerald-100 text-emerald-700' : 'hover:bg-slate-100 text-slate-500'}`}
                      >
                        👍 {r.userFeedback === 1 ? '已反馈' : '有用'}
                      </button>
                      <button
                        onClick={() => submitFeedback(r.id, -1)}
                        disabled={r.userFeedback === -1}
                        className={`px-2 py-0.5 text-xs rounded ${r.userFeedback === -1 ? 'bg-rose-100 text-rose-700' : 'hover:bg-slate-100 text-slate-500'}`}
                      >
                        👎 {r.userFeedback === -1 ? '已反馈' : '有问题'}
                      </button>
                      {r.feedbackNote && (
                        <span className="text-xs text-slate-500 italic">备注: {r.feedbackNote}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {summaries.length > 0 && (
            <div>
              <h3 className="font-semibold text-slate-800 mb-2">历史 Session 摘要</h3>
              <div className="space-y-2">
                {summaries.map(s => (
                  <details key={s.id} className="p-3 border border-slate-200 rounded-lg bg-white">
                    <summary className="cursor-pointer text-xs text-slate-600 flex items-center gap-2">
                      <span>{new Date(s.summarizedAt).toLocaleString()}</span>
                      <span>·</span>
                      <span>{s.invocationCount} 次</span>
                      <span>·</span>
                      <span>{Math.round(s.successRate * 100)}%</span>
                      {s.modelUsed && <span className="text-slate-400">({s.modelUsed})</span>}
                    </summary>
                    <p className="mt-2 text-sm text-slate-700 whitespace-pre-wrap">{s.summaryText}</p>
                  </details>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
