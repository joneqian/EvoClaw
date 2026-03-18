import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore, type Message, type ToolCall } from '../stores/chat-store';
import { useAgentStore } from '../stores/agent-store';
import AgentAvatar from '../components/AgentAvatar';
import { useAppStore } from '../stores/app-store';
import { get, del } from '../lib/api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** 生成简单的唯一 ID */
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 解析 SSE 数据行 */
function parseSSELine(line: string): { event?: string; data?: string } | null {
  if (line.startsWith('event:')) return { event: line.slice(6).trim() };
  if (line.startsWith('data:')) return { data: line.slice(5).trim() };
  return null;
}

/** 相对时间格式化 */
function formatRelativeTime(dateStr: string): string {
  const now = Date.now();
  const date = new Date(dateStr).getTime();
  const diff = now - date;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins} 分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(dateStr).toLocaleDateString('zh-CN');
}

// ─── 全局对话列表（类似 Claude 的 Chats 页面） ───

interface RecentConversation {
  sessionKey: string;
  agentId: string;
  agentName: string;
  agentEmoji: string;
  title: string;
  lastAt: string;
  messageCount: number;
}

function ConversationListView({
  onSelectConversation,
  onNewChat,
}: {
  onSelectConversation: (agentId: string, sessionKey: string) => void;
  onNewChat: () => void;
}) {
  const [conversations, setConversations] = useState<RecentConversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<RecentConversation | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    get<{ conversations: RecentConversation[] }>('/chat/recents?limit=50')
      .then((res) => setConversations(res.conversations))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = search.trim()
    ? conversations.filter((c) =>
        c.title.toLowerCase().includes(search.toLowerCase()) ||
        c.agentName.toLowerCase().includes(search.toLowerCase())
      )
    : conversations;

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-2xl mx-auto px-6 py-6">
        {/* 标题 + 新建按钮 */}
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-2xl font-bold text-slate-900 dark:text-white">对话</h1>
          <button
            onClick={onNewChat}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-600
              text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
            title="新建对话"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>

        {/* 搜索 */}
        <div className="mb-4">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索对话..."
              className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl
                bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-white
                focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand
                placeholder:text-slate-400 dark:placeholder:text-slate-500"
            />
          </div>
        </div>

        {/* 子标题 */}
        <div className="flex items-center gap-2 mb-2 px-1">
          <span className="text-sm text-slate-500 dark:text-slate-400">你的对话</span>
        </div>

        {/* 对话列表 */}
        {loading ? (
          <div className="text-center py-16 text-slate-400 dark:text-slate-500">
            <p className="text-sm">加载中...</p>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-4xl mb-3">💬</p>
            <p className="text-slate-400 dark:text-slate-500 text-sm">
              {search.trim() ? '没有匹配的对话' : '暂无对话记录'}
            </p>
            {!search.trim() && (
              <button
                onClick={onNewChat}
                className="mt-4 text-sm text-brand hover:text-brand-hover"
              >
                开始第一次对话
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-700/50">
            {filtered.map((conv) => (
              <div
                key={conv.sessionKey}
                className="flex items-center py-3.5 px-1 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
              >
                <button
                  onClick={() => onSelectConversation(conv.agentId, conv.sessionKey)}
                  className="flex-1 text-left min-w-0"
                >
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                    {conv.title || '新对话'}
                  </p>
                  <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                    {conv.agentName} · {formatRelativeTime(conv.lastAt)}
                  </p>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteTarget(conv);
                  }}
                  className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg
                    text-slate-300 dark:text-slate-600 opacity-0 group-hover:opacity-100
                    hover:text-red-500 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                  title="删除对话"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 删除确认弹窗 */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="删除对话"
        message={`确定删除与 ${deleteTarget?.agentName ?? ''} 的对话「${deleteTarget?.title ?? ''}」吗？消息记录将被永久删除。`}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await del(`/chat/${deleteTarget.agentId}/conversations?sessionKey=${encodeURIComponent(deleteTarget.sessionKey)}`);
            setConversations(prev => prev.filter(c => c.sessionKey !== deleteTarget.sessionKey));
            window.dispatchEvent(new Event('evoclaw:conversations-changed'));
          } catch { /* ignore */ }
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}

// ─── Agent 选择弹窗（新建对话时） ───

function AgentPicker({
  onSelect,
  onCancel,
}: {
  onSelect: (agentId: string) => void;
  onCancel: () => void;
}) {
  const { agents, fetchAgents } = useAgentStore();
  const navigate = useNavigate();

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  return (
    <div className="h-full flex flex-col items-center justify-center">
      <div className="w-full max-w-md">
        <h3 className="text-lg font-bold text-slate-800 dark:text-slate-200 mb-4 text-center">
          选择 Agent 开始对话
        </h3>
        {agents.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-3xl mb-3">🐾</p>
            <p className="text-sm text-slate-400 dark:text-slate-500 mb-4">还没有 Agent</p>
            <button
              onClick={() => navigate('/agents')}
              className="text-sm text-brand hover:text-brand-hover"
            >
              去创建 Agent →
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => onSelect(agent.id)}
                className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700
                  bg-white dark:bg-slate-800 hover:border-brand/40 hover:shadow-sm transition-all text-left"
              >
                <AgentAvatar name={agent.name} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{agent.name}</p>
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    {agent.status === 'active' ? '活跃' : agent.status === 'draft' ? '草稿' : agent.status}
                  </p>
                </div>
                <svg className="w-4 h-4 text-slate-300 dark:text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                </svg>
              </button>
            ))}
          </div>
        )}
        <button
          onClick={onCancel}
          className="mt-4 w-full text-center text-sm text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
        >
          返回对话列表
        </button>
      </div>
    </div>
  );
}

// ─── 对话视图 ───

function ChatView() {
  const {
    messages,
    isStreaming,
    currentAgentId,
    currentSessionKey,
    loadingMessages,
    addMessage,
    appendToLastMessage,
    updateLastMessageToolCalls,
    setStreaming,
    setCurrentAgent,
    fetchConversations,
  } = useChatStore();

  const { agents, fetchAgents } = useAgentStore();
  const { sidecarConnected } = useAppStore();

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasSentPending = useRef(false);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 160) + 'px';
    }
  }, [input]);

  const currentAgent = agents.find((a) => a.id === currentAgentId);

  /** 发送消息 */
  const sendMessage = useCallback(async (overrideInput?: string) => {
    const rawText = overrideInput ?? input.trim();
    if (!currentAgentId || !currentSessionKey || isStreaming) return;

    // 构建消息文本：附件路径 + 用户输入
    const attachParts = attachments.map(f => {
      // Tauri/Electron 的 File 对象通常有 path 属性
      const filePath = (f as any).path ?? f.name;
      return `[附件: ${filePath}]`;
    });
    const text = [...attachParts, rawText].filter(Boolean).join('\n');
    if (!text) return;

    const userMsg: Message = {
      id: uid(),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    addMessage(userMsg);
    if (!overrideInput) {
      setInput('');
      setAttachments([]);
    }

    const assistantMsg: Message = {
      id: uid(),
      role: 'assistant',
      content: '',
      createdAt: new Date().toISOString(),
    };
    addMessage(assistantMsg);
    setStreaming(true);

    try {
      const configStr = localStorage.getItem('sidecar-config');
      if (!configStr) {
        appendToLastMessage('Sidecar 未连接，无法发送消息。');
        setStreaming(false);
        return;
      }
      const config = JSON.parse(configStr) as { port: number; token: string };

      const response = await fetch(
        `http://127.0.0.1:${config.port}/chat/${currentAgentId}/send`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.token}`,
          },
          body: JSON.stringify({ message: text, sessionKey: currentSessionKey }),
        },
      );

      if (!response.ok) {
        const errBody = await response.json().catch(() => null) as { error?: string } | null;
        const errMsg = errBody?.error || `HTTP ${response.status}`;
        appendToLastMessage(`请求失败: ${errMsg}`);
        setStreaming(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        appendToLastMessage('无法读取响应流');
        setStreaming(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';
      const toolCalls: ToolCall[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) { currentEvent = ''; continue; }

          const parsed = parseSSELine(trimmed);
          if (!parsed) continue;

          if (parsed.event) {
            currentEvent = parsed.event;
          } else if (parsed.data) {
            try {
              const payload = JSON.parse(parsed.data);
              switch (currentEvent || payload.type) {
                case 'text_delta':
                  appendToLastMessage(payload.delta ?? payload.text ?? '');
                  break;
                case 'tool_start': {
                  const toolName = payload.toolName ?? payload.name ?? '未知工具';
                  const args = payload.toolArgs ?? payload.args;
                  const summary = formatToolSummary(toolName, args);
                  toolCalls.push({ name: toolName, status: 'running', summary });
                  updateLastMessageToolCalls([...toolCalls]);
                  break;
                }
                case 'tool_end': {
                  const endName = payload.toolName ?? payload.name;
                  const tc = toolCalls.find((t) => t.name === endName && t.status === 'running');
                  if (tc) {
                    tc.status = payload.isError ? 'error' : 'done';
                    updateLastMessageToolCalls([...toolCalls]);
                  }
                  break;
                }
                case 'agent_done':
                  setStreaming(false);
                  break;
                case 'error':
                  appendToLastMessage(`\n[错误] ${payload.message ?? '未知错误'}`);
                  setStreaming(false);
                  break;
              }
            } catch {
              appendToLastMessage(parsed.data);
            }
          }
        }
      }
    } catch (err) {
      appendToLastMessage(`\n[连接错误] ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setStreaming(false);
      if (currentAgentId) fetchConversations(currentAgentId);
    }
  }, [
    currentAgentId, currentSessionKey, input, attachments, isStreaming,
    addMessage, appendToLastMessage, updateLastMessageToolCalls,
    setStreaming, fetchConversations,
  ]);

  // 检查 pending message（从 AgentDetailPage 带过来的初始消息）
  useEffect(() => {
    if (hasSentPending.current) return;
    const pending = sessionStorage.getItem('pending-message');
    if (pending && currentAgentId && currentSessionKey) {
      hasSentPending.current = true;
      sessionStorage.removeItem('pending-message');
      sendMessage(pending);
    }
  }, [currentAgentId, currentSessionKey, sendMessage]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-slate-50 dark:bg-slate-900 h-full">
      {/* 头部 */}
      <div className="h-12 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center px-4 gap-3 shrink-0">
        <button
          onClick={() => setCurrentAgent(null)}
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          title="返回对话列表"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
          </svg>
        </button>
        {currentAgent && (
          <>
            <AgentAvatar name={currentAgent.name} size="sm" />
            <span className="font-medium text-sm dark:text-white">{currentAgent.name}</span>
          </>
        )}
        {!sidecarConnected && (
          <span className="ml-auto text-xs text-red-400">Sidecar 未连接</span>
        )}
      </div>

      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto px-4 py-4">
        {loadingMessages ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-slate-400 dark:text-slate-500">
              <p className="text-sm">加载历史消息...</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-slate-400 dark:text-slate-500">
              {currentAgent ? <AgentAvatar name={currentAgent.name} size="xl" className="mx-auto mb-3" /> : <p className="text-3xl mb-3">💬</p>}
              <p className="text-sm">
                与 <span className="font-medium">{currentAgent?.name ?? 'Agent'}</span> 开始对话
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto px-6 space-y-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} agentName={currentAgent?.name} />
            ))}
            {isStreaming && (
              <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 text-xs pl-2">
                <span className="flex gap-0.5">
                  <span className="w-1.5 h-1.5 bg-brand rounded-full animate-pulse" />
                  <span className="w-1.5 h-1.5 bg-brand rounded-full animate-pulse [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-brand rounded-full animate-pulse [animation-delay:300ms]" />
                </span>
                正在思考...
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* 输入区域 — Claude 风格：统一容器，附件卡片在内部上方 */}
      <div className="px-6 pb-4 pt-2 shrink-0">
        <div className="mx-auto rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm overflow-hidden">
          {/* 附件卡片区 */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pt-3">
              {attachments.map((file, i) => (
                <div key={i} className="group relative w-[160px] rounded-lg border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 p-3 hover:border-brand/40 transition-colors">
                  {/* 删除按钮 */}
                  <button
                    onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-400 dark:bg-slate-500 text-white text-xs
                      flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-all"
                  >×</button>
                  {/* 文件名 */}
                  <p className="text-xs font-medium text-slate-700 dark:text-slate-200 truncate mb-2">{file.name}</p>
                  {/* 文件类型标签 */}
                  <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-400">
                    {getFileExtLabel(file.name)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* 文本输入 */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="回复..."
            rows={1}
            className="w-full resize-none px-4 py-3 text-sm bg-transparent text-slate-900 dark:text-white
              focus:outline-none placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />

          {/* 底部操作栏：+ 按钮 ... 发送按钮 */}
          <div className="flex items-center justify-between px-3 pb-2.5">
            {/* 左侧：添加附件 */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.pdf,.txt,.md,.json,.csv,.doc,.docx,.xls,.xlsx"
              style={{ display: 'none' }}
              onChange={(e) => {
                const files = e.target.files;
                if (files && files.length > 0) {
                  setAttachments(prev => [...prev, ...Array.from(files)]);
                }
                e.target.value = '';
              }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isStreaming}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 dark:text-slate-500
                hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-600 dark:hover:text-slate-300 transition-colors
                disabled:opacity-40 disabled:cursor-not-allowed"
              title="添加附件"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>

            {/* 右侧：发送按钮 */}
            <button
              onClick={() => sendMessage()}
              disabled={isStreaming || (!input.trim() && attachments.length === 0)}
              className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
                isStreaming || (!input.trim() && attachments.length === 0)
                  ? 'bg-slate-200 dark:bg-slate-600 text-slate-400 dark:text-slate-500 cursor-not-allowed'
                  : 'bg-brand text-white hover:bg-brand-hover'
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── 主页面（路由控制器） ───

export default function ChatPage() {
  const {
    currentAgentId,
    currentSessionKey,
    enterConversation,
    newConversation,
    setCurrentAgent,
  } = useChatStore();

  const [showAgentPicker, setShowAgentPicker] = useState(false);

  /** 从对话列表选择已有会话 */
  const handleSelectConversation = useCallback((agentId: string, sessionKey: string) => {
    enterConversation(agentId, sessionKey);
  }, [enterConversation]);

  /** 点击新建对话 → 显示 Agent 选择器 */
  const handleNewChat = useCallback(() => {
    setShowAgentPicker(true);
  }, []);

  /** 选定 Agent → 新建会话进入对话 */
  const handleSelectAgent = useCallback((agentId: string) => {
    setShowAgentPicker(false);
    newConversation(agentId);
  }, [newConversation]);

  // 如果已经选中了 Agent 和会话 → 显示对话视图
  if (currentAgentId && currentSessionKey) {
    return <ChatView />;
  }

  // Agent 选择器
  if (showAgentPicker) {
    return (
      <AgentPicker
        onSelect={handleSelectAgent}
        onCancel={() => setShowAgentPicker(false)}
      />
    );
  }

  // 默认：会话列表
  return (
    <ConversationListView
      onSelectConversation={handleSelectConversation}
      onNewChat={handleNewChat}
    />
  );
}

/** 确认弹窗 */
function ConfirmDialog({ isOpen, title, message, onConfirm, onCancel }: {
  isOpen: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onCancel}>
      <div className="bg-white dark:bg-slate-800 rounded-xl shadow-xl w-[340px] p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-semibold text-slate-900 dark:text-white mb-1.5">{title}</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3.5 py-1.5 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-600
              text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
          >取消</button>
          <button
            onClick={onConfirm}
            className="px-3.5 py-1.5 text-xs font-medium rounded-lg bg-red-500 text-white hover:bg-red-600 transition-colors"
          >删除</button>
        </div>
      </div>
    </div>
  );
}

/** 工具调用摘要：显示操作而非结果 */
function formatToolSummary(name: string, args: unknown): string {
  if (!args || typeof args !== 'object') return '';
  const a = args as Record<string, unknown>;
  switch (name) {
    case 'bash': return a.command ? `$ ${String(a.command).slice(0, 80)}` : '';
    case 'read': return a.file_path ? String(a.file_path) : (a.path ? String(a.path) : '');
    case 'write':
    case 'edit': return a.file_path ? String(a.file_path) : '';
    case 'find': return a.pattern ? `${a.pattern}` : '';
    case 'grep': return a.pattern ? `/${a.pattern}/` : '';
    case 'web_search': return a.query ? `"${String(a.query).slice(0, 60)}"` : '';
    case 'web_fetch': return a.url ? String(a.url).slice(0, 80) : '';
    case 'image': return a.path ? String(a.path).split('/').pop() ?? '' : '';
    case 'pdf': return a.path ? String(a.path).split('/').pop() ?? '' : '';
    case 'memory_search': return a.query ? `"${a.query}"` : '';
    case 'spawn_agent': return a.task ? String(a.task).slice(0, 60) : '';
    default: return '';
  }
}

/** 文件扩展名标签 */
function getFileExtLabel(name: string): string {
  const ext = name.split('.').pop()?.toUpperCase() ?? '';
  return ext || 'FILE';
}

/** 工具调用列表（默认最多 3 条，超出折叠） */
const MAX_VISIBLE_TOOLS = 3;

function ToolCallList({ toolCalls, hasContent }: { toolCalls: ToolCall[]; hasContent: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const hasRunning = toolCalls.some(tc => tc.status === 'running');
  const showAll = expanded || hasRunning || toolCalls.length <= MAX_VISIBLE_TOOLS;
  const visible = showAll ? toolCalls : toolCalls.slice(0, MAX_VISIBLE_TOOLS);
  const hiddenCount = toolCalls.length - MAX_VISIBLE_TOOLS;

  return (
    <div className={hasContent ? 'mb-2 space-y-1' : 'space-y-1'}>
      {visible.map((tc, i) => (
        <ToolCallItem key={i} tc={tc} />
      ))}
      {!showAll && hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-xs text-slate-400 dark:text-slate-500 hover:text-brand dark:hover:text-brand px-2 py-0.5 transition-colors"
        >
          ... 还有 {hiddenCount} 个工具调用，点击展开
        </button>
      )}
      {expanded && toolCalls.length > MAX_VISIBLE_TOOLS && (
        <button
          onClick={() => setExpanded(false)}
          className="text-xs text-slate-400 dark:text-slate-500 hover:text-brand dark:hover:text-brand px-2 py-0.5 transition-colors"
        >
          收起
        </button>
      )}
    </div>
  );
}

function ToolCallItem({ tc }: { tc: ToolCall }) {
  return (
    <div
      className={`text-xs px-2 py-1 rounded ${
        tc.status === 'running'
          ? 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400'
          : tc.status === 'error'
            ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
            : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
      }`}
    >
      {tc.status === 'running' ? '🔧' : tc.status === 'error' ? '❌' : '✅'}{' '}
      {tc.name}
      {tc.summary && <span className="ml-1 opacity-70">{tc.summary}</span>}
    </div>
  );
}

/** 单条消息气泡组件 */
function MessageBubble({ message, agentName }: { message: Message; agentName?: string }) {
  const isUser = message.role === 'user';
  const hasContent = !!message.content;
  const hasTools = message.toolCalls && message.toolCalls.length > 0;
  const isEmpty = !isUser && !hasContent && !hasTools;

  return (
    <div className={`flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} ${isEmpty ? 'min-h-0' : ''}`}>
      {/* 头像 */}
      <div className="shrink-0 mt-0.5">
        {isUser ? (
          <div className="w-8 h-8 rounded-full bg-brand/20 flex items-center justify-center">
            <span className="text-sm">👤</span>
          </div>
        ) : (
          <AgentAvatar name={agentName ?? 'AI'} size="sm" />
        )}
      </div>

      {/* 消息体 */}
      {isEmpty ? (
        /* streaming 占位：紧凑的思考动画 */
        <div className="flex items-center gap-1 py-1">
          <span className="w-1.5 h-1.5 bg-slate-300 dark:bg-slate-600 rounded-full animate-pulse" />
          <span className="w-1.5 h-1.5 bg-slate-300 dark:bg-slate-600 rounded-full animate-pulse [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 bg-slate-300 dark:bg-slate-600 rounded-full animate-pulse [animation-delay:300ms]" />
        </div>
      ) : (
        <div
          className={`min-w-0 rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
            isUser
              ? 'max-w-[75%] bg-brand text-white rounded-br-sm'
              : 'flex-1 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-100 dark:border-slate-700 rounded-bl-sm shadow-sm'
          }`}
        >
          {hasTools && (
            <ToolCallList toolCalls={message.toolCalls!} hasContent={hasContent} />
          )}
          {hasContent && (
            isUser
              ? <div className="whitespace-pre-wrap break-words">{message.content}</div>
              : <div className="prose prose-sm dark:prose-invert max-w-none break-words
                  prose-p:my-1.5 prose-headings:my-2 prose-li:my-0.5
                  prose-pre:bg-slate-900 prose-pre:text-slate-100 prose-pre:rounded-lg prose-pre:text-xs
                  prose-code:text-pink-500 dark:prose-code:text-pink-400 prose-code:before:content-none prose-code:after:content-none
                  prose-a:text-brand prose-a:no-underline hover:prose-a:underline
                  prose-table:text-xs prose-th:px-2 prose-td:px-2">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                </div>
          )}
        </div>
      )}
    </div>
  );
}
