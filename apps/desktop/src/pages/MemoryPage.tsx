import { useState, useEffect, useCallback } from 'react';
import { useMemoryStore, type MemoryUnit, type SearchResult } from '../stores/memory-store';
import { useAgentStore } from '../stores/agent-store';
import AgentSelect from '../components/AgentSelect';
import { formatDate } from '../lib/date';

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

/** 所有分类 key 列表 */
const ALL_CATEGORIES = Object.keys(CATEGORIES);

/** 分类标签组件 */
function CategoryBadge({ category }: { category: string }) {
  const cat = CATEGORIES[category];
  if (!cat) return <span className="px-2 py-0.5 rounded text-xs bg-slate-100 text-slate-600">{category}</span>;
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${cat.color}`}>{cat.name}</span>;
}

/** 激活度进度条 */
function ActivationBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-slate-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-brand rounded-full transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs text-slate-400 w-8 text-right">{pct}%</span>
    </div>
  );
}

/** 记忆卡片展开状态: closed → l1 → l2 */
type ExpandLevel = 'closed' | 'l1' | 'l2';

/** 记忆卡片组件 */
function MemoryCard({
  unit,
  agentId,
}: {
  unit: MemoryUnit;
  agentId: string;
}) {
  const { pinMemory, unpinMemory, deleteMemory } = useMemoryStore();
  const [expand, setExpand] = useState<ExpandLevel>('closed');
  const [deleting, setDeleting] = useState(false);

  const isPinned = unit.visibility === 'pinned';

  const handleClick = useCallback(() => {
    setExpand((prev) => {
      if (prev === 'closed') return 'l1';
      if (prev === 'l1') return 'l2';
      return 'closed';
    });
  }, []);

  const handlePin = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (isPinned) {
        await unpinMemory(agentId, unit.id);
      } else {
        await pinMemory(agentId, unit.id);
      }
    },
    [agentId, unit.id, isPinned, pinMemory, unpinMemory],
  );

  const handleDelete = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!deleting) {
        setDeleting(true);
        return;
      }
      await deleteMemory(agentId, unit.id);
    },
    [agentId, unit.id, deleting, deleteMemory],
  );

  const handleCancelDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(false);
  }, []);

  return (
    <div
      className="bg-white rounded-lg border border-slate-200 p-4 cursor-pointer hover:border-brand/40 transition-colors"
      onClick={handleClick}
    >
      {/* 头部: L0 摘要 + 分类 + 操作 */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900 truncate">{unit.l0Index}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <CategoryBadge category={unit.category} />
            <span className="text-xs text-slate-400">访问 {unit.accessCount} 次</span>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {/* 置顶按钮 */}
          <button
            onClick={handlePin}
            className={`p-1.5 rounded-md transition-colors ${
              isPinned
                ? 'text-brand hover:bg-brand/10'
                : 'text-slate-400 hover:bg-slate-100'
            }`}
            title={isPinned ? '取消置顶' : '置顶'}
          >
            <svg className="w-4 h-4" fill={isPinned ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
            </svg>
          </button>

          {/* 删除按钮 */}
          {deleting ? (
            <div className="flex items-center gap-1">
              <button
                onClick={handleDelete}
                className="px-2 py-1 text-xs rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
              >
                确认删除
              </button>
              <button
                onClick={handleCancelDelete}
                className="px-2 py-1 text-xs rounded bg-slate-200 text-slate-600 hover:bg-slate-300 transition-colors"
              >
                取消
              </button>
            </div>
          ) : (
            <button
              onClick={handleDelete}
              className="p-1.5 rounded-md text-slate-400 hover:bg-red-50 hover:text-red-500 transition-colors"
              title="删除"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 激活度 */}
      <div className="mt-3">
        <ActivationBar value={unit.activation} />
      </div>

      {/* L1 概述 (展开时显示) */}
      {(expand === 'l1' || expand === 'l2') && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-xs font-medium text-slate-500 mb-1">概述</p>
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{unit.l1Overview}</p>
        </div>
      )}

      {/* L2 详细内容 (完全展开时显示) */}
      {expand === 'l2' && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-xs font-medium text-slate-500 mb-1">详细内容</p>
          <p className="text-sm text-slate-600 whitespace-pre-wrap">{unit.l2Content}</p>
          <div className="flex items-center gap-3 mt-2 text-xs text-slate-400">
            <span>置信度: {Math.round(unit.confidence * 100)}%</span>
            <span>创建: {formatDate(unit.createdAt)}</span>
            <span>更新: {formatDate(unit.updatedAt)}</span>
          </div>
        </div>
      )}

      {/* 展开提示 */}
      <div className="mt-2 text-center">
        <span className="text-xs text-slate-300">
          {expand === 'closed' && '点击展开概述'}
          {expand === 'l1' && '点击查看详情'}
          {expand === 'l2' && '点击收起'}
        </span>
      </div>
    </div>
  );
}

/** 搜索结果卡片组件 */
function SearchResultCard({ result }: { result: SearchResult }) {
  const [showDetail, setShowDetail] = useState(false);

  return (
    <div
      className="bg-white rounded-lg border border-slate-200 p-4 cursor-pointer hover:border-brand/40 transition-colors"
      onClick={() => setShowDetail((v) => !v)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-900 truncate">{result.l0Index}</p>
          <div className="flex items-center gap-2 mt-1.5">
            <CategoryBadge category={result.category} />
            <span className="text-xs text-slate-400">
              匹配度: {Math.round(result.finalScore * 100)}%
            </span>
          </div>
        </div>
      </div>

      {/* 激活度 */}
      <div className="mt-3">
        <ActivationBar value={result.activation} />
      </div>

      {/* L1 概述 */}
      <div className="mt-3 pt-3 border-t border-slate-100">
        <p className="text-sm text-slate-700 whitespace-pre-wrap">{result.l1Overview}</p>
      </div>

      {/* L2 详细内容 */}
      {showDetail && result.l2Content && (
        <div className="mt-3 pt-3 border-t border-slate-100">
          <p className="text-xs font-medium text-slate-500 mb-1">详细内容</p>
          <p className="text-sm text-slate-600 whitespace-pre-wrap">{result.l2Content}</p>
        </div>
      )}
    </div>
  );
}

/** 记忆管理页面 */
export default function MemoryPage() {
  const { agents } = useAgentStore();
  const {
    units,
    searchResults,
    loading,
    fetchUnits,
    searchMemories,
    clearSearch,
  } = useMemoryStore();

  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchMode, setIsSearchMode] = useState(false);

  /** 初始化: 如果有 agent 则默认选中第一个 */
  useEffect(() => {
    if (agents.length > 0 && !selectedAgentId) {
      setSelectedAgentId(agents[0].id);
    }
  }, [agents, selectedAgentId]);

  /** 切换 agent 或分类时重新获取记忆 */
  useEffect(() => {
    if (!selectedAgentId) return;
    const cat = activeCategory === 'all' ? undefined : activeCategory;
    fetchUnits(selectedAgentId, cat);
    // 退出搜索模式
    setIsSearchMode(false);
    clearSearch();
    setSearchQuery('');
  }, [selectedAgentId, activeCategory, fetchUnits, clearSearch]);

  /** 执行搜索 */
  const handleSearch = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!selectedAgentId || !searchQuery.trim()) return;
      setIsSearchMode(true);
      await searchMemories(selectedAgentId, searchQuery.trim());
    },
    [selectedAgentId, searchQuery, searchMemories],
  );

  /** 清除搜索 */
  const handleClearSearch = useCallback(() => {
    setIsSearchMode(false);
    setSearchQuery('');
    clearSearch();
  }, [clearSearch]);

  return (
    <div className="h-full flex flex-col">
      {/* 顶栏 */}
      <div className="px-6 py-4 border-b border-slate-200 bg-white">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-slate-900">记忆管理</h2>

          {/* Agent 选择器 */}
          <AgentSelect
            agents={agents}
            value={selectedAgentId}
            onChange={setSelectedAgentId}
          />
        </div>

        {/* 搜索栏 */}
        <form onSubmit={handleSearch} className="flex gap-2 mb-4">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索记忆内容..."
            className="flex-1 px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand/30 focus:border-brand"
          />
          <button
            type="submit"
            disabled={!selectedAgentId || !searchQuery.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-brand rounded-lg hover:bg-brand-active disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            搜索
          </button>
          {isSearchMode && (
            <button
              type="button"
              onClick={handleClearSearch}
              className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
            >
              清除
            </button>
          )}
        </form>

        {/* 分类过滤标签 */}
        {!isSearchMode && (
          <div className="flex gap-1.5 flex-wrap">
            <button
              onClick={() => setActiveCategory('all')}
              className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                activeCategory === 'all'
                  ? 'bg-brand text-white'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              全部
            </button>
            {ALL_CATEGORIES.map((key) => (
              <button
                key={key}
                onClick={() => setActiveCategory(key)}
                className={`px-3 py-1 text-xs rounded-full font-medium transition-colors ${
                  activeCategory === key
                    ? 'bg-brand text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {CATEGORIES[key].name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 内容区域 */}
      <div className="flex-1 overflow-y-auto p-6">
        {!selectedAgentId ? (
          <div className="text-center text-slate-400 mt-20">
            <p className="text-lg">请先创建一个 Agent</p>
            <p className="text-sm mt-1">在 Agent 管理页面创建后即可查看记忆</p>
          </div>
        ) : loading ? (
          <div className="text-center text-slate-400 mt-20">
            <p className="text-sm">加载中...</p>
          </div>
        ) : isSearchMode ? (
          /* 搜索结果模式 */
          searchResults.length === 0 ? (
            <div className="text-center text-slate-400 mt-20">
              <p className="text-sm">未找到匹配的记忆</p>
            </div>
          ) : (
            <div className="space-y-3 max-w-3xl mx-auto">
              <p className="text-xs text-slate-400 mb-2">
                找到 {searchResults.length} 条相关记忆
              </p>
              {searchResults.map((result) => (
                <SearchResultCard key={result.memoryId} result={result} />
              ))}
            </div>
          )
        ) : /* 列表模式 */
        units.length === 0 ? (
          <div className="text-center text-slate-400 mt-20">
            <p className="text-lg">暂无记忆</p>
            <p className="text-sm mt-1">与 Agent 对话后将自动积累记忆</p>
          </div>
        ) : (
          <div className="space-y-3 max-w-3xl mx-auto">
            <p className="text-xs text-slate-400 mb-2">
              共 {units.length} 条记忆
            </p>
            {units.map((unit) => (
              <MemoryCard key={unit.id} unit={unit} agentId={selectedAgentId} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
