import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAgentStore } from '../stores/agent-store';
import AgentAvatar from '../components/AgentAvatar';
import { useChatStore, type Conversation } from '../stores/chat-store';
import { get } from '../lib/api';
import { formatRelativeTime } from '../lib/date';

/** 工作区文件图标和标签 */
const FILE_LABELS: Record<string, { icon: string; label: string; desc: string }> = {
  'SOUL.md': { icon: '💎', label: '行为哲学', desc: '核心真理 + 角色人格' },
  'IDENTITY.md': { icon: '🪪', label: '身份配置', desc: '名称、气质、标志' },
  'AGENTS.md': { icon: '📋', label: '操作规程', desc: '通用准则 + 工作规范' },
  'BOOTSTRAP.md': { icon: '🌅', label: '首次对话引导', desc: '专家的"出生仪式"' },
  'TOOLS.md': { icon: '🔧', label: '环境笔记', desc: '环境特有的备忘信息' },
  'HEARTBEAT.md': { icon: '💓', label: '定时检查', desc: '周期性自动检查清单' },
};

export default function AgentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { agents, fetchAgents, fetchWorkspaceFiles, deleteAgent } = useAgentStore();
  const { enterConversation, newConversation } = useChatStore();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [workspaceFiles, setWorkspaceFiles] = useState<Record<string, string>>({});
  const [loadingConvs, setLoadingConvs] = useState(true);
  const [input, setInput] = useState('');
  const [showMenu, setShowMenu] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const agent = agents.find((a) => a.id === id);

  // 加载数据
  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  useEffect(() => {
    if (!id) return;
    // 加载会话列表
    get<{ conversations: Conversation[] }>(`/chat/${id}/conversations`)
      .then((res) => setConversations(res.conversations))
      .catch(() => {})
      .finally(() => setLoadingConvs(false));
    // 加载工作区文件
    fetchWorkspaceFiles(id)
      .then((files) => setWorkspaceFiles(files))
      .catch(() => {});
  }, [id, fetchWorkspaceFiles]);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
        setDeleteConfirm(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  /** 新建对话并进入 */
  const handleNewChat = useCallback(() => {
    if (!id) return;
    const msg = input.trim();
    newConversation(id);
    if (msg) {
      // 带着初始消息跳转，ChatView 会检测 pendingMessage
      sessionStorage.setItem('pending-message', msg);
    }
    navigate('/chat');
  }, [id, input, newConversation, navigate]);

  /** 进入已有会话 */
  const handleEnterConversation = useCallback((conv: Conversation) => {
    enterConversation(conv.agentId, conv.sessionKey);
    navigate('/chat');
  }, [enterConversation, navigate]);

  /** 删除 Agent */
  const handleDelete = useCallback(async () => {
    if (!id) return;
    try {
      await deleteAgent(id);
      navigate('/agents');
    } catch (err) {
      console.error('删除 Agent 失败:', err);
    }
  }, [id, deleteAgent, navigate]);

  if (!agent) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400">
        <p className="text-sm">专家不存在或正在加载...</p>
      </div>
    );
  }

  // 只显示可编辑的工作区文件
  const editableFiles = Object.entries(workspaceFiles).filter(
    ([name]) => FILE_LABELS[name]
  );

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-4xl mx-auto px-6 py-6">
        {/* 返回链接 */}
        <button
          onClick={() => navigate('/agents')}
          className="flex items-center gap-1 text-sm text-slate-500
            hover:text-slate-700 transition-colors mb-4"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
          所有专家
        </button>

        <div className="flex gap-8">
          {/* 左侧主内容 */}
          <div className="flex-1 min-w-0">
            {/* Agent 名称 + 操作 */}
            <div className="flex items-center gap-3 mb-6">
              <AgentAvatar name={agent.name} size="lg" />
              <h1 className="text-2xl font-bold text-slate-900 flex-1">{agent.name}</h1>
              {/* ⋯ 菜单 */}
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="5" r="1.5" />
                    <circle cx="12" cy="12" r="1.5" />
                    <circle cx="12" cy="19" r="1.5" />
                  </svg>
                </button>
                {showMenu && (
                  <div className="absolute right-0 top-full mt-1 w-40 bg-white
                    border border-slate-200 rounded-xl shadow-lg z-10 py-1 overflow-hidden"
                  >
                    <button
                      onClick={() => { navigate(`/agents/${id}/edit`); setShowMenu(false); }}
                      className="w-full text-left px-4 py-2 text-sm text-slate-700
                        hover:bg-slate-50 transition-colors"
                    >
                      编辑专家
                    </button>
                    {deleteConfirm ? (
                      <div className="px-4 py-2 space-y-1.5">
                        <p className="text-xs text-red-500">确认删除？所有对话和记忆都将被删除。</p>
                        <div className="flex gap-2">
                          <button
                            onClick={handleDelete}
                            className="text-xs px-2 py-1 text-white bg-red-500 rounded hover:bg-red-600"
                          >
                            确认
                          </button>
                          <button
                            onClick={() => setDeleteConfirm(false)}
                            className="text-xs px-2 py-1 text-slate-500 hover:text-slate-700"
                          >
                            取消
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setDeleteConfirm(true)}
                        className="w-full text-left px-4 py-2 text-sm text-red-500
                          hover:bg-red-50 transition-colors"
                      >
                        删除专家
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 新对话输入框 */}
            <div className="mb-6">
              <div className="bg-white border border-slate-200 rounded-xl p-4">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleNewChat();
                    }
                  }}
                  placeholder="有什么可以帮你的？"
                  rows={2}
                  className="w-full resize-none text-sm text-slate-700 bg-transparent
                    placeholder:text-slate-400
                    focus:outline-none"
                />
                <div className="flex items-center justify-between mt-2">
                  <button className="p-1.5 text-slate-400 hover:text-slate-600 transition-colors">
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                    </svg>
                  </button>
                  <button
                    onClick={handleNewChat}
                    disabled={!input.trim()}
                    className="px-3 py-1.5 text-xs font-medium text-white bg-brand rounded-lg
                      hover:bg-brand-hover transition-colors disabled:opacity-30 disabled:cursor-default"
                  >
                    发送
                  </button>
                </div>
              </div>
            </div>

            {/* 开始新对话按钮（无输入内容时） */}
            <button
              onClick={() => { newConversation(id!); navigate('/chat'); }}
              className="flex items-center gap-2 text-sm text-slate-500
                hover:text-brand transition-colors mb-6"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
              开始空白对话
            </button>

            {/* 历史会话列表 */}
            <div>
              {loadingConvs ? (
                <p className="text-sm text-slate-400 py-4">加载中...</p>
              ) : conversations.length === 0 ? (
                <p className="text-sm text-slate-400 py-4">
                  暂无对话记录，在上方输入开始第一次对话。
                </p>
              ) : (
                <div className="divide-y divide-slate-100">
                  {conversations.map((conv) => (
                    <button
                      key={conv.sessionKey}
                      onClick={() => handleEnterConversation(conv)}
                      className="w-full text-left py-3.5 px-1 hover:bg-slate-50
                        transition-colors group"
                    >
                      <p className="text-sm font-medium text-slate-800 group-hover:text-brand transition-colors">
                        {conv.title || '新对话'}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {formatRelativeTime(conv.lastAt)}
                      </p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* 右侧：工作区配置 */}
          <div className="w-72 shrink-0 hidden lg:block">
            {/* Instructions */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-slate-700">指令配置</h3>
                <button
                  onClick={() => navigate(`/agents/${id}/edit`)}
                  className="p-1 text-slate-400 hover:text-brand transition-colors"
                  title="编辑工作区文件"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>
              <p className="text-xs text-slate-400 mb-3">
                自定义指令来调整专家的行为
              </p>
              {editableFiles.length === 0 ? (
                <div className="bg-slate-50 rounded-lg p-3">
                  <p className="text-xs text-slate-400">尚未配置工作区文件</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {editableFiles.map(([name, content]) => {
                    const meta = FILE_LABELS[name]!;
                    const hasContent = content.trim().length > 0;
                    return (
                      <button
                        key={name}
                        onClick={() => navigate(`/agents/${id}/edit`)}
                        className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-lg
                          bg-slate-50 hover:bg-slate-100 transition-colors"
                      >
                        <span className="text-sm">{meta.icon}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-700">{meta.label}</p>
                          {hasContent ? (
                            <p className="text-xs text-slate-400 truncate">{content.slice(0, 40)}...</p>
                          ) : (
                            <p className="text-xs text-slate-400 italic">未配置</p>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* 知识库 placeholder */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-medium text-slate-700">知识库</h3>
                <button
                  className="p-1 text-slate-400 hover:text-brand transition-colors"
                  title="添加文件"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>
              <div className="bg-slate-50 rounded-lg p-6 flex flex-col items-center justify-center">
                <div className="flex gap-1 mb-2 text-slate-300">
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                  </svg>
                </div>
                <p className="text-xs text-slate-400 text-center">
                  添加文档、PDF 等文件<br />作为专家的参考资料
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
