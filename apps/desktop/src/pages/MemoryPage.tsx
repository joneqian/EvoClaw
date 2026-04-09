import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  useMemoryStore,
  type MemoryUnit,
  type SearchResult,
  type MemoryFeedbackType,
  type KnowledgeRelation,
  type SessionSummary,
} from '../stores/memory-store';
import { useAgentStore } from '../stores/agent-store';
import AgentSelect from '../components/AgentSelect';
import { formatDate } from '../lib/date';

/** 计算新鲜度天数（用于黄/红徽章和后端 staleness tag 阈值一致：1 天/7 天） */
function daysSinceUpdated(updatedAt: string): number {
  return (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24);
}

/** 新鲜度徽章 — Sprint 15.12 Phase C.6 */
function StalenessBadge({ updatedAt }: { updatedAt: string }) {
  const days = daysSinceUpdated(updatedAt);
  if (days <= 1) return null;
  if (days > 7) {
    return (
      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700" title="超过 7 天未更新，建议验证">
        ⚠ {Math.floor(days)}d
      </span>
    );
  }
  return (
    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-100 text-yellow-700" title={`${Math.floor(days)} 天未更新`}>
      {Math.floor(days)}d
    </span>
  );
}

/** 分类显示名称和颜色 */
const CATEGORIES: Record<string, { name: string; color: string }> = {
  profile: { name: '个人信息', color: 'bg-blue-100 text-blue-700' },
  preference: { name: '偏好习惯', color: 'bg-purple-100 text-purple-700' },
  entity: { name: '实体知识', color: 'bg-green-100 text-green-700' },
  event: { name: '事件经历', color: 'bg-yellow-100 text-yellow-700' },
  case: { name: '问题案例', color: 'bg-orange-100 text-orange-700' },
  pattern: { name: '行为模式', color: 'bg-pink-100 text-pink-700' },
  tool: { name: '工具使用', color: 'bg-cyan-100 text-cyan-700' },
  skill: { name: '技能知识', color: 'bg-indigo-100 text-indigo-700' },
  correction: { name: '纠正反馈', color: 'bg-red-100 text-red-700' },
};

const ALL_CATEGORIES = Object.keys(CATEGORIES);

/** 分类标签 */
function CategoryBadge({ category }: { category: string }) {
  const cat = CATEGORIES[category];
  if (!cat) return <span className="px-1.5 py-0.5 rounded text-[10px] bg-slate-100 text-slate-500">{category}</span>;
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${cat.color}`}>{cat.name}</span>;
}

/** 置信度圆点 — 列表项主要信号（用户反馈会立刻降低这个值） */
function ConfidenceDot({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? 'bg-green-400' : pct >= 40 ? 'bg-yellow-400' : 'bg-slate-300';
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] text-slate-400"
      title={`置信度 ${pct}%`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      信 {pct}%
    </span>
  );
}

/** 热度圆点 — 仅搜索结果使用（搜索结果没有 confidence 字段，显示 activation） */
function HotnessDot({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 70 ? 'bg-green-400' : pct >= 40 ? 'bg-yellow-400' : 'bg-slate-300';
  return (
    <span
      className="inline-flex items-center gap-1 text-[10px] text-slate-400"
      title={`激活度（热度）${pct}%`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${color}`} />
      热 {pct}%
    </span>
  );
}

/** 紧凑列表行 */
function MemoryRow({
  unit,
  active,
  selected,
  onSelect,
  onToggleCheck,
}: {
  unit: MemoryUnit;
  active: boolean;
  selected: boolean;
  onSelect: () => void;
  onToggleCheck: () => void;
}) {
  const isPinned = unit.visibility === 'pinned';
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-l-2 transition-colors ${
        active
          ? 'bg-brand/5 border-brand'
          : 'border-transparent hover:bg-slate-50'
      }`}
      onClick={onSelect}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={(e) => { e.stopPropagation(); onToggleCheck(); }}
        onClick={(e) => e.stopPropagation()}
        className="shrink-0 w-3.5 h-3.5 rounded border-slate-300 text-brand focus:ring-brand/30"
      />
      <div className="flex-1 min-w-0">
        <p className="text-[13px] text-slate-800 truncate leading-tight">
          {isPinned && <span className="text-brand mr-1">*</span>}
          {unit.l0Index}
        </p>
        <div className="flex items-center gap-1.5 mt-0.5">
          <CategoryBadge category={unit.category} />
          <ConfidenceDot value={unit.confidence} />
          <span className="text-[10px] text-slate-300">{unit.accessCount}次</span>
          <StalenessBadge updatedAt={unit.updatedAt} />
        </div>
      </div>
    </div>
  );
}

/** 搜索结果行 */
function SearchRow({
  result,
  active,
  onSelect,
}: {
  result: SearchResult;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`px-3 py-2 cursor-pointer border-l-2 transition-colors ${
        active ? 'bg-brand/5 border-brand' : 'border-transparent hover:bg-slate-50'
      }`}
      onClick={onSelect}
    >
      <p className="text-[13px] text-slate-800 truncate leading-tight">{result.l0Index}</p>
      <div className="flex items-center gap-1.5 mt-0.5">
        <CategoryBadge category={result.category} />
        <span className="text-[10px] text-slate-400">{Math.round(result.finalScore * 100)}% 匹配</span>
        <HotnessDot value={result.activation} />
      </div>
    </div>
  );
}

/** 编辑弹层 — Sprint 15.12 Phase C.5（L0 灰显锁死，仅可改 L1/L2） */
function EditDialog({
  unit,
  agentId,
  onClose,
}: {
  unit: MemoryUnit;
  agentId: string;
  onClose: () => void;
}) {
  const { updateMemory } = useMemoryStore();
  const [l1, setL1] = useState(unit.l1Overview);
  const [l2, setL2] = useState(unit.l2Content);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = useCallback(async () => {
    if (l1 === unit.l1Overview && l2 === unit.l2Content) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const partial: { l1Overview?: string; l2Content?: string } = {};
      if (l1 !== unit.l1Overview) partial.l1Overview = l1;
      if (l2 !== unit.l2Content) partial.l2Content = l2;
      await updateMemory(agentId, unit.id, partial);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
      setSaving(false);
    }
  }, [l1, l2, unit, agentId, updateMemory, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">编辑记忆</h3>
          <p className="text-[11px] text-slate-400 mt-0.5">L0 摘要为检索锚点，不可编辑</p>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          <div>
            <label className="block text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1">L0 摘要（锁定）</label>
            <input
              type="text"
              value={unit.l0Index}
              disabled
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md bg-slate-50 text-slate-400 cursor-not-allowed"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1">L1 概述</label>
            <textarea
              value={l1}
              onChange={(e) => setL1(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand/30 focus:border-brand resize-y"
              placeholder="结构化概览"
            />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1">L2 详情</label>
            <textarea
              value={l2}
              onChange={(e) => setL2(e.target.value)}
              rows={6}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand/30 focus:border-brand resize-y"
              placeholder="完整内容"
            />
          </div>
          {error && (
            <p className="text-xs text-red-500">{error}</p>
          )}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200">
          <button
            onClick={onClose}
            disabled={saving}
            className="px-3 py-1.5 text-xs rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-3 py-1.5 text-xs rounded-md bg-brand text-white hover:bg-brand/90 transition-colors disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 反馈弹层 — Sprint 15.12 Phase C.5 */
function FeedbackDialog({
  unit,
  agentId,
  onClose,
}: {
  unit: MemoryUnit;
  agentId: string;
  onClose: () => void;
}) {
  const { flagMemory } = useMemoryStore();
  const [type, setType] = useState<MemoryFeedbackType>('inaccurate');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const TYPE_LABELS: Record<MemoryFeedbackType, string> = {
    inaccurate: '不准确（事实错误）',
    sensitive: '涉及隐私（不应保留）',
    outdated: '过时（信息已变化）',
  };

  const handleSubmit = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      await flagMemory(agentId, unit.id, type, note.trim() || undefined);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
      setSubmitting(false);
    }
  }, [type, note, agentId, unit.id, flagMemory, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900">反馈这条记忆</h3>
          <p className="text-[11px] text-slate-400 mt-0.5 truncate">{unit.l0Index}</p>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1.5">问题类型</label>
            <div className="space-y-1.5">
              {(Object.entries(TYPE_LABELS) as [MemoryFeedbackType, string][]).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 px-3 py-1.5 rounded-md cursor-pointer hover:bg-slate-50">
                  <input
                    type="radio"
                    name="feedback-type"
                    value={key}
                    checked={type === key}
                    onChange={() => setType(key)}
                    className="text-brand focus:ring-brand/30"
                  />
                  <span className="text-sm text-slate-700">{label}</span>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1">备注（可选）</label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand/30 focus:border-brand resize-y"
              placeholder="补充说明，例如哪里不对、应该是什么"
            />
          </div>
          <p className="text-[11px] text-slate-400">
            提交后该记忆的置信度会自动降低 0.15，下次召回排序会下降。
          </p>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-slate-200">
          <button
            onClick={onClose}
            disabled={submitting}
            className="px-3 py-1.5 text-xs rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-3 py-1.5 text-xs rounded-md bg-orange-500 text-white hover:bg-orange-600 transition-colors disabled:opacity-50"
          >
            {submitting ? '提交中…' : '提交反馈'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** 右侧详情面板 */
function DetailPanel({
  unit,
  agentId,
}: {
  unit: MemoryUnit | null;
  agentId: string;
}) {
  const { pinMemory, unpinMemory, deleteMemory } = useMemoryStore();
  const [deleting, setDeleting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // 切换选中时重置弹层和删除状态
  useEffect(() => {
    setDeleting(false);
    setEditing(false);
    setFeedbackOpen(false);
  }, [unit?.id]);

  if (!unit) {
    return (
      <div className="h-full flex items-center justify-center text-slate-300">
        <p className="text-sm">选择一条记忆查看详情</p>
      </div>
    );
  }

  const isPinned = unit.visibility === 'pinned';

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex-1 overflow-y-auto p-5">
        {/* L0 摘要 + 元信息 */}
        <div className="mb-4">
          <h3 className="text-base font-semibold text-slate-900 leading-snug">{unit.l0Index}</h3>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <CategoryBadge category={unit.category} />
            <StalenessBadge updatedAt={unit.updatedAt} />
            <span className="text-xs text-slate-400">置信度 {Math.round(unit.confidence * 100)}%</span>
            <span className="text-xs text-slate-400">激活度 {Math.round(unit.activation * 100)}%</span>
            <span className="text-xs text-slate-400">访问 {unit.accessCount} 次</span>
          </div>
        </div>

        {/* L1 概述 */}
        {unit.l1Overview && (
          <div className="mb-4">
            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1">概述</p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{unit.l1Overview}</p>
          </div>
        )}

        {/* L2 详细内容 */}
        {unit.l2Content && (
          <div className="mb-4">
            <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1">详细内容</p>
            <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{unit.l2Content}</p>
          </div>
        )}

        {/* 时间信息 */}
        <div className="border-t border-slate-100 pt-3 mt-4">
          <div className="flex gap-4 text-xs text-slate-400">
            <span>创建 {formatDate(unit.createdAt)}</span>
            <span>更新 {formatDate(unit.updatedAt)}</span>
            {unit.archivedAt && <span className="text-orange-400">已归档 {formatDate(unit.archivedAt)}</span>}
          </div>
        </div>
      </div>

      {/* 操作栏 */}
      <div className="flex items-center gap-2 px-5 py-3 border-t border-slate-100 bg-white shrink-0">
        <button
          onClick={() => setEditing(true)}
          className="px-3 py-1.5 text-xs rounded-md bg-brand/10 text-brand hover:bg-brand/20 transition-colors"
        >
          编辑
        </button>
        <button
          onClick={() => setFeedbackOpen(true)}
          className="px-3 py-1.5 text-xs rounded-md bg-orange-50 text-orange-600 hover:bg-orange-100 transition-colors"
        >
          反馈
        </button>
        <button
          onClick={() => isPinned ? unpinMemory(agentId, unit.id) : pinMemory(agentId, unit.id)}
          className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
            isPinned
              ? 'bg-brand/10 text-brand hover:bg-brand/20'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          {isPinned ? '取消置顶' : '置顶'}
        </button>
        <div className="flex-1" />
        {deleting ? (
          <>
            <button
              onClick={() => { deleteMemory(agentId, unit.id); setDeleting(false); }}
              className="px-3 py-1.5 text-xs rounded-md bg-red-500 text-white hover:bg-red-600 transition-colors"
            >
              确认删除
            </button>
            <button
              onClick={() => setDeleting(false)}
              className="px-3 py-1.5 text-xs rounded-md bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
            >
              取消
            </button>
          </>
        ) : (
          <button
            onClick={() => setDeleting(true)}
            className="px-3 py-1.5 text-xs rounded-md text-red-500 hover:bg-red-50 transition-colors"
          >
            删除
          </button>
        )}
      </div>

      {editing && <EditDialog unit={unit} agentId={agentId} onClose={() => setEditing(false)} />}
      {feedbackOpen && <FeedbackDialog unit={unit} agentId={agentId} onClose={() => setFeedbackOpen(false)} />}
    </div>
  );
}

/** 搜索结果详情面板 */
function SearchDetailPanel({ result }: { result: SearchResult | null }) {
  if (!result) {
    return (
      <div className="h-full flex items-center justify-center text-slate-300">
        <p className="text-sm">选择一条结果查看详情</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <h3 className="text-base font-semibold text-slate-900 leading-snug mb-2">{result.l0Index}</h3>
      <div className="flex items-center gap-2 mb-4">
        <CategoryBadge category={result.category} />
        <span className="text-xs text-slate-400">匹配度 {Math.round(result.finalScore * 100)}%</span>
        <span className="text-xs text-slate-400">激活度 {Math.round(result.activation * 100)}%</span>
      </div>

      {result.l1Overview && (
        <div className="mb-4">
          <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1">概述</p>
          <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{result.l1Overview}</p>
        </div>
      )}

      {result.l2Content && (
        <div className="mb-4">
          <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide mb-1">详细内容</p>
          <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">{result.l2Content}</p>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────
// Sprint 15.12 Phase D — 三个新 Tab 视图
// ─────────────────────────────────────────────────────────────────

/** Phase D Tab 类型 */
type MemoryTab = 'memories' | 'graph' | 'consolidations' | 'summaries';

/** 知识图谱 Tab — 表格视图（不引入 force graph 库） */
function KnowledgeGraphTab({ agentId }: { agentId: string }) {
  const { knowledgeRelations, fetchKnowledgeGraph, loading } = useMemoryStore();

  useEffect(() => {
    if (agentId) fetchKnowledgeGraph(agentId);
  }, [agentId, fetchKnowledgeGraph]);

  if (!agentId) {
    return <div className="text-center text-slate-300 mt-16"><p className="text-sm">请先选择 Agent</p></div>;
  }
  if (loading) {
    return <div className="text-center text-slate-300 mt-16"><p className="text-xs">加载中…</p></div>;
  }
  if (knowledgeRelations.length === 0) {
    return (
      <div className="text-center text-slate-300 mt-16 px-4">
        <p className="text-sm">暂无知识图谱关系</p>
        <p className="text-xs mt-1">Agent 在对话中提取实体关系后会显示在这里</p>
      </div>
    );
  }

  // 按 subject 分组，让同一实体的关系聚在一起
  const grouped = knowledgeRelations.reduce<Record<string, KnowledgeRelation[]>>((acc, r) => {
    if (!acc[r.subjectId]) acc[r.subjectId] = [];
    acc[r.subjectId].push(r);
    return acc;
  }, {});

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mb-3 text-xs text-slate-400">
        共 {knowledgeRelations.length} 条关系，{Object.keys(grouped).length} 个实体
      </div>
      <div className="space-y-4">
        {Object.entries(grouped).map(([subject, rels]) => (
          <div key={subject} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
            <div className="px-3 py-2 bg-slate-50 border-b border-slate-100">
              <span className="text-xs font-medium text-slate-700">{subject}</span>
              <span className="ml-2 text-[10px] text-slate-400">{rels.length} 条关系</span>
            </div>
            <table className="w-full text-xs">
              <tbody>
                {rels.map((r) => (
                  <tr key={r.id} className="border-t border-slate-100 first:border-t-0">
                    <td className="px-3 py-1.5 text-slate-500 w-20">{r.relation}</td>
                    <td className="px-3 py-1.5 text-slate-700">{r.objectId}</td>
                    <td className="px-3 py-1.5 text-right text-[10px] text-slate-300 w-16">{Math.round(r.confidence * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 整理历史 Tab — AutoDream 运行时间线 */
function ConsolidationsTab({ agentId }: { agentId: string }) {
  const { consolidations, fetchConsolidations, loading } = useMemoryStore();

  useEffect(() => {
    if (agentId) fetchConsolidations(agentId);
  }, [agentId, fetchConsolidations]);

  if (!agentId) {
    return <div className="text-center text-slate-300 mt-16"><p className="text-sm">请先选择 Agent</p></div>;
  }
  if (loading) {
    return <div className="text-center text-slate-300 mt-16"><p className="text-xs">加载中…</p></div>;
  }
  if (consolidations.length === 0) {
    return (
      <div className="text-center text-slate-300 mt-16 px-4">
        <p className="text-sm">暂无整合历史</p>
        <p className="text-xs mt-1">AutoDream 在 24h + 5 个新会话后自动触发</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mb-3 text-xs text-slate-400">
        共 {consolidations.length} 次 AutoDream 运行
      </div>
      <div className="space-y-2">
        {consolidations.map((run) => {
          const duration = run.completedAt
            ? Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
            : null;
          const statusColor =
            run.status === 'completed' ? 'bg-green-100 text-green-700' :
            run.status === 'failed' ? 'bg-red-100 text-red-700' :
            'bg-yellow-100 text-yellow-700';
          return (
            <div key={run.id} className="bg-white rounded-lg border border-slate-200 p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${statusColor}`}>{run.status}</span>
                  <span className="text-xs text-slate-500">{formatDate(run.startedAt)}</span>
                  {duration !== null && <span className="text-[10px] text-slate-400">耗时 {duration}s</span>}
                </div>
              </div>
              <div className="flex gap-4 text-xs">
                <span className="text-slate-600">合并 <strong>{run.memoriesMerged}</strong></span>
                <span className="text-slate-600">裁剪 <strong>{run.memoriesPruned}</strong></span>
                <span className="text-slate-600">新建 <strong>{run.memoriesCreated}</strong></span>
              </div>
              {run.errorMessage && (
                <p className="mt-2 text-[11px] text-red-500 bg-red-50 p-2 rounded">{run.errorMessage}</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 会话摘要 Tab — 列表 + markdown 展开 */
function SessionSummariesTab({ agentId }: { agentId: string }) {
  const { sessionSummaries, fetchSessionSummaries, loading } = useMemoryStore();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    if (agentId) fetchSessionSummaries(agentId);
  }, [agentId, fetchSessionSummaries]);

  if (!agentId) {
    return <div className="text-center text-slate-300 mt-16"><p className="text-sm">请先选择 Agent</p></div>;
  }
  if (loading) {
    return <div className="text-center text-slate-300 mt-16"><p className="text-xs">加载中…</p></div>;
  }
  if (sessionSummaries.length === 0) {
    return (
      <div className="text-center text-slate-300 mt-16 px-4">
        <p className="text-sm">暂无会话摘要</p>
        <p className="text-xs mt-1">单个会话累计 ≥10K tokens 后自动生成</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-5">
      <div className="mb-3 text-xs text-slate-400">
        共 {sessionSummaries.length} 条会话摘要
      </div>
      <div className="space-y-2">
        {sessionSummaries.map((s: SessionSummary) => {
          const isExpanded = expandedId === s.id;
          return (
            <div key={s.id} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
              <button
                onClick={() => setExpandedId(isExpanded ? null : s.id)}
                className="w-full px-3 py-2 flex items-center justify-between hover:bg-slate-50 transition-colors"
              >
                <div className="flex-1 min-w-0 text-left">
                  <p className="text-xs font-mono text-slate-700 truncate">{s.sessionKey}</p>
                  <div className="flex gap-3 mt-0.5 text-[10px] text-slate-400">
                    <span>{formatDate(s.updatedAt)}</span>
                    <span>{s.tokenCountAt.toLocaleString()} tokens</span>
                    <span>{s.turnCountAt} 轮</span>
                    <span>{s.toolCallCountAt} 工具调用</span>
                  </div>
                </div>
                <span className="text-slate-300 ml-2">{isExpanded ? '▾' : '▸'}</span>
              </button>
              {isExpanded && (
                <div className="px-4 py-3 border-t border-slate-100 prose prose-sm prose-slate max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{s.summaryMarkdown}</ReactMarkdown>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 记忆管理页面 — 主从分栏布局 */
export default function MemoryPage() {
  const { agents } = useAgentStore();
  const {
    units,
    searchResults,
    loading,
    fetchUnits,
    searchMemories,
    deleteMemories,
    clearSearch,
  } = useMemoryStore();

  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchMode, setIsSearchMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [activeUnitId, setActiveUnitId] = useState<string | null>(null);
  const [activeSearchIdx, setActiveSearchIdx] = useState<number>(-1);
  /** Sprint 15.12 Phase D — 顶部 Tab 切换 */
  const [activeTab, setActiveTab] = useState<MemoryTab>('memories');

  const activeUnit = units.find(u => u.id === activeUnitId) ?? null;
  const activeSearchResult = activeSearchIdx >= 0 ? searchResults[activeSearchIdx] ?? null : null;

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => prev.size === units.length ? new Set() : new Set(units.map(u => u.id)));
  }, [units]);

  const handleBatchDelete = useCallback(async () => {
    if (!batchDeleting) { setBatchDeleting(true); return; }
    if (selectedIds.size === 0) return;
    await deleteMemories(selectedAgentId, [...selectedIds]);
    setSelectedIds(new Set());
    setBatchDeleting(false);
    setActiveUnitId(null);
  }, [selectedAgentId, selectedIds, batchDeleting, deleteMemories]);

  useEffect(() => {
    if (agents.length > 0 && !selectedAgentId) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  useEffect(() => {
    if (!selectedAgentId) return;
    const cat = activeCategory === 'all' ? undefined : activeCategory;
    fetchUnits(selectedAgentId, cat);
    setIsSearchMode(false);
    clearSearch();
    setSearchQuery('');
    setSelectedIds(new Set());
    setBatchDeleting(false);
    setActiveUnitId(null);
    setActiveSearchIdx(-1);
  }, [selectedAgentId, activeCategory, fetchUnits, clearSearch]);

  const handleSearch = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedAgentId || !searchQuery.trim()) return;
      setIsSearchMode(true);
      setActiveSearchIdx(-1);
      await searchMemories(selectedAgentId, searchQuery.trim());
    },
    [selectedAgentId, searchQuery, searchMemories],
  );

  const handleClearSearch = useCallback(() => {
    setIsSearchMode(false);
    setSearchQuery('');
    clearSearch();
    setActiveSearchIdx(-1);
  }, [clearSearch]);

  const TAB_LABELS: Record<MemoryTab, string> = {
    memories: '记忆',
    graph: '知识图谱',
    consolidations: '整理历史',
    summaries: '会话摘要',
  };

  return (
    <div className="h-full flex flex-col">
      {/* 顶栏: 第 1 行 — 标题 + 搜索 + Agent */}
      <div className="px-4 pt-3 pb-2 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-3 mb-2">
          <h2 className="text-sm font-bold text-slate-900 shrink-0">记忆管理</h2>
          {activeTab === 'memories' ? (
            <form onSubmit={handleSearch} className="flex-1 flex gap-1.5">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索记忆..."
                className="flex-1 px-2.5 py-1.5 text-xs border border-slate-200 rounded-md focus:outline-none focus:ring-1 focus:ring-brand/30 focus:border-brand"
              />
              <button
                type="submit"
                disabled={!selectedAgentId || !searchQuery.trim()}
                className="px-3 py-1.5 text-xs font-medium text-white bg-brand rounded-md hover:bg-brand-active disabled:opacity-50 transition-colors"
              >
                搜索
              </button>
              {isSearchMode && (
                <button
                  type="button"
                  onClick={handleClearSearch}
                  className="px-2.5 py-1.5 text-xs text-slate-500 bg-slate-100 rounded-md hover:bg-slate-200 transition-colors"
                >
                  清除
                </button>
              )}
            </form>
          ) : (
            <div className="flex-1" />
          )}
          <AgentSelect agents={agents} value={selectedAgentId} onChange={setSelectedAgentId} />
        </div>

        {/* Sprint 15.12 Phase D — Tab 切换 */}
        <div className="flex gap-1 border-b border-slate-100 -mx-4 px-4 mb-2">
          {(Object.keys(TAB_LABELS) as MemoryTab[]).map((key) => (
            <button
              key={key}
              onClick={() => setActiveTab(key)}
              className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
                activeTab === key
                  ? 'border-brand text-brand'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {TAB_LABELS[key]}
            </button>
          ))}
        </div>

        {/* 第 2 行 — 分类标签 + 批量操作（仅 memories tab）*/}
        {activeTab === 'memories' && (
        <div className="flex items-center justify-between">
          {!isSearchMode ? (
            <div className="flex gap-1.5 flex-wrap">
              <button
                onClick={() => setActiveCategory('all')}
                className={`px-2.5 py-1 text-xs rounded-full font-medium transition-colors ${
                  activeCategory === 'all' ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                全部
              </button>
              {ALL_CATEGORIES.map((key) => (
                <button
                  key={key}
                  onClick={() => setActiveCategory(key)}
                  className={`px-2.5 py-1 text-xs rounded-full font-medium transition-colors ${
                    activeCategory === key ? 'bg-brand text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {CATEGORIES[key].name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400">搜索结果: {searchResults.length} 条</p>
          )}

          {!isSearchMode && units.length > 0 && (
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={toggleSelectAll}
                className="text-xs text-slate-500 hover:text-brand transition-colors"
              >
                {selectedIds.size === units.length ? '取消全选' : '全选'}
              </button>
              {selectedIds.size > 0 && (
                batchDeleting ? (
                  <div className="flex gap-1.5">
                    <button onClick={handleBatchDelete} className="px-2.5 py-1 text-xs rounded bg-red-500 text-white hover:bg-red-600">
                      确认删除 {selectedIds.size} 条
                    </button>
                    <button onClick={() => setBatchDeleting(false)} className="px-2.5 py-1 text-xs rounded bg-slate-200 text-slate-600 hover:bg-slate-300">
                      取消
                    </button>
                  </div>
                ) : (
                  <button onClick={handleBatchDelete} className="text-xs text-red-500 hover:text-red-600">
                    删除 {selectedIds.size} 条
                  </button>
                )
              )}
            </div>
          )}
        </div>
        )}
      </div>

      {/* 主体 — Sprint 15.12 Phase D 按 activeTab 切换 */}
      {activeTab === 'memories' ? (
        <div className="flex-1 flex overflow-hidden">
          {/* 左列表 */}
          <div className="w-2/5 min-w-[280px] max-w-[420px] border-r border-slate-200 overflow-y-auto bg-white">
            {!selectedAgentId ? (
              <div className="text-center text-slate-300 mt-16 px-4">
                <p className="text-sm">请先创建一个 Agent</p>
              </div>
            ) : loading ? (
              <div className="text-center text-slate-300 mt-16">
                <p className="text-xs">加载中...</p>
              </div>
            ) : isSearchMode ? (
              searchResults.length === 0 ? (
                <div className="text-center text-slate-300 mt-16">
                  <p className="text-xs">未找到匹配的记忆</p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {searchResults.map((result, idx) => (
                    <SearchRow
                      key={result.memoryId}
                      result={result}
                      active={activeSearchIdx === idx}
                      onSelect={() => setActiveSearchIdx(idx)}
                    />
                  ))}
                </div>
              )
            ) : units.length === 0 ? (
              <div className="text-center text-slate-300 mt-16 px-4">
                <p className="text-sm">暂无记忆</p>
                <p className="text-xs mt-1">与 Agent 对话后将自动积累</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {units.map((unit) => (
                  <MemoryRow
                    key={unit.id}
                    unit={unit}
                    active={activeUnitId === unit.id}
                    selected={selectedIds.has(unit.id)}
                    onSelect={() => setActiveUnitId(unit.id)}
                    onToggleCheck={() => toggleSelect(unit.id)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* 右详情 */}
          <div className="flex-1 bg-slate-50">
            {isSearchMode ? (
              <SearchDetailPanel result={activeSearchResult} />
            ) : (
              <DetailPanel unit={activeUnit} agentId={selectedAgentId} />
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 bg-slate-50 overflow-hidden">
          {activeTab === 'graph' && <KnowledgeGraphTab agentId={selectedAgentId} />}
          {activeTab === 'consolidations' && <ConsolidationsTab agentId={selectedAgentId} />}
          {activeTab === 'summaries' && <SessionSummariesTab agentId={selectedAgentId} />}
        </div>
      )}
    </div>
  );
}
