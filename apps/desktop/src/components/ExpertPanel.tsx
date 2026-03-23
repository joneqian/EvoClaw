/**
 * ExpertPanel — 第二栏：专家列表 + 会话历史 (~240px)
 * 仅在对话路由 (/chat 或 /) 时显示
 */

import { useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../stores/chat-store';
import { useAgentStore } from '../stores/agent-store';
import AgentAvatar from './AgentAvatar';

interface RecentConversation {
  sessionKey: string;
  agentId: string;
  agentName: string;
  agentEmoji: string;
  title: string;
  lastAt: string;
  messageCount: number;
}

interface ExpertPanelProps {
  recents: RecentConversation[];
  recentsLoading: boolean;
  onRecentClick: (conv: RecentConversation) => void;
  onDeleteRecent: (conv: RecentConversation, e: React.MouseEvent) => void;
  onLoadMoreRecents: () => void;
  onCreateAgent: () => void;
  onDeleteAgent: (agentId: string, e: React.MouseEvent) => void;
}

function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}天前`;
  return new Date(dateStr).toLocaleDateString('zh-CN');
}

export default function ExpertPanel({
  recents,
  recentsLoading,
  onRecentClick,
  onDeleteRecent,
  onLoadMoreRecents,
  onCreateAgent,
  onDeleteAgent,
}: ExpertPanelProps) {
  const navigate = useNavigate();
  const { agents, fetchAgents } = useAgentStore();
  const { currentAgentId, newConversation, setCurrentAgent } = useChatStore();

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  // 自动选中第一个专家（页面加载时或删除后当前专家不存在时）
  useEffect(() => {
    if (agents.length === 0) {
      // 没有专家 → 清空选中，右侧显示空白
      if (currentAgentId) {
        setCurrentAgent(null);
      }
      return;
    }
    // 当前选中的专家不存在（被删除了），或者没有选中任何专家 → 选第一个
    const currentExists = agents.some(a => a.id === currentAgentId);
    if (!currentAgentId || !currentExists) {
      newConversation(agents[0].id);
    }
  }, [agents, currentAgentId, newConversation, setCurrentAgent]);

  const handleAgentClick = useCallback((agentId: string) => {
    newConversation(agentId);
    navigate('/chat');
  }, [newConversation, navigate]);

  return (
    <aside className="w-[240px] bg-[#fafafa] border-r border-slate-200/60 flex flex-col shrink-0 select-none overflow-hidden">
      {/* 拖拽区域占位 */}
      <div className="h-[80px] shrink-0" data-tauri-drag-region />

      {/* 我的专家 */}
      <div className="px-3 mb-1.5">
        <span className="text-xs font-semibold text-slate-400 tracking-wider">
          我的专家
        </span>
      </div>

      {/* 专家列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto px-2">
        {agents.length === 0 ? (
          <p className="px-2 py-3 text-xs text-slate-400">暂无专家</p>
        ) : (
          <div className="space-y-0.5">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className={`flex items-center rounded-lg transition-all duration-150 group ${
                  currentAgentId === agent.id
                    ? 'bg-brand/10 text-brand-active'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-800'
                }`}
              >
                <button
                  onClick={() => handleAgentClick(agent.id)}
                  className="flex-1 min-w-0 flex items-center gap-2.5 px-2.5 py-2 text-left"
                  title={agent.name}
                >
                  <AgentAvatar name={agent.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{agent.name}</p>
                    <p className="text-xs text-slate-400 truncate">{agent.id}</p>
                  </div>
                </button>
                <button
                  onClick={(e) => onDeleteAgent(agent.id, e)}
                  className="shrink-0 w-6 h-6 mr-1.5 flex items-center justify-center rounded
                    opacity-0 group-hover:opacity-100
                    text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                  title="删除专家"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 创建专家按钮 */}
        <button
          onClick={onCreateAgent}
          className="w-full flex items-center justify-center gap-1.5 px-2.5 py-2 mt-2 rounded-lg text-sm
            font-medium text-slate-800 border border-slate-300 hover:border-slate-400 hover:bg-slate-50 transition-colors"
        >
          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
          创建专家
        </button>
      </div>

      {/* 分割线 */}
      <div className="mx-3 my-3 border-t border-slate-300" />

      {/* 会话历史 */}
      <div className="px-3 mb-1.5">
        <span className="text-xs font-semibold text-slate-400 tracking-wider">
          会话历史
        </span>
      </div>

      <div
        className="flex-1 min-h-0 overflow-y-auto px-2 pb-3"
        onScroll={(e) => {
          const el = e.currentTarget;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) {
            onLoadMoreRecents();
          }
        }}
      >
        {recents.length === 0 ? (
          <p className="px-2.5 py-3 text-xs text-slate-400">暂无对话</p>
        ) : (
          <div className="space-y-0.5">
            {recents.map((conv) => (
              <div
                key={conv.sessionKey}
                className="flex items-center rounded-lg hover:bg-slate-100 transition-all duration-150 group"
              >
                <button
                  onClick={() => onRecentClick(conv)}
                  className="flex-1 min-w-0 text-left px-2.5 py-2"
                  title={`${conv.agentName} — ${conv.title}`}
                >
                  <div className="truncate leading-snug flex items-center gap-1.5">
                    <AgentAvatar name={conv.agentName} size="xs" className="shrink-0" />
                    <span className="text-slate-600 group-hover:text-slate-800 transition-colors truncate text-sm font-medium">
                      {conv.title}
                    </span>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5 pl-[26px] truncate">
                    {formatRelativeTime(conv.lastAt)}
                  </div>
                </button>
                <button
                  onClick={(e) => onDeleteRecent(conv, e)}
                  className="shrink-0 w-6 h-6 mr-1 flex items-center justify-center rounded
                    opacity-0 group-hover:opacity-100
                    text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all"
                  title="删除会话"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
            {recentsLoading && (
              <div className="py-2 flex justify-center">
                <span className="w-4 h-4 border-2 border-slate-300 border-t-brand rounded-full animate-spin" />
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
