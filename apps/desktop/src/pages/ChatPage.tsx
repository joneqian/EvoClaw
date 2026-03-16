import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore, type Message, type ToolCall } from '../stores/chat-store';
import { useAgentStore } from '../stores/agent-store';
import AgentAvatar from '../components/AgentAvatar';
import { useAppStore } from '../stores/app-store';
import { get } from '../lib/api';

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
              <button
                key={conv.sessionKey}
                onClick={() => onSelectConversation(conv.agentId, conv.sessionKey)}
                className="w-full text-left py-3.5 px-1 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group"
              >
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  {conv.title || '新对话'}
                </p>
                <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                  Last message {formatRelativeTime(conv.lastAt)}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
    const text = overrideInput ?? input.trim();
    if (!currentAgentId || !currentSessionKey || !text || isStreaming) return;

    const userMsg: Message = {
      id: uid(),
      role: 'user',
      content: text,
      createdAt: new Date().toISOString(),
    };
    addMessage(userMsg);
    if (!overrideInput) setInput('');

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
                case 'tool_start':
                  toolCalls.push({ name: payload.name ?? '未知工具', status: 'running' });
                  updateLastMessageToolCalls([...toolCalls]);
                  break;
                case 'tool_end': {
                  const tc = toolCalls.find((t) => t.name === payload.name);
                  if (tc) {
                    tc.status = payload.error ? 'error' : 'done';
                    tc.result = payload.result;
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
    currentAgentId, currentSessionKey, input, isStreaming,
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
          <div className="max-w-2xl mx-auto space-y-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
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

      {/* 输入区域 */}
      <div className="border-t border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-3 shrink-0">
        <div className="max-w-2xl mx-auto flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
            rows={1}
            className="flex-1 resize-none rounded-lg border border-slate-200 dark:border-slate-600 px-3 py-2 text-sm
              bg-white dark:bg-slate-700 text-slate-900 dark:text-white
              focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand
              placeholder:text-slate-400 dark:placeholder:text-slate-500"
          />
          <button
            onClick={() => sendMessage()}
            disabled={isStreaming || !input.trim()}
            className="shrink-0 px-4 py-2 rounded-lg text-sm font-medium text-white
              bg-brand hover:bg-brand-hover transition-colors
              disabled:opacity-40 disabled:cursor-not-allowed"
          >
            发送
          </button>
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

/** 单条消息气泡组件 */
function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === 'user';

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
          isUser
            ? 'bg-brand text-white rounded-br-sm'
            : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-100 dark:border-slate-700 rounded-bl-sm shadow-sm'
        }`}
      >
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mb-2 space-y-1">
            {message.toolCalls.map((tc, i) => (
              <div
                key={i}
                className={`text-xs px-2 py-1 rounded ${
                  tc.status === 'running'
                    ? 'bg-yellow-50 dark:bg-yellow-900/20 text-yellow-700 dark:text-yellow-400'
                    : tc.status === 'error'
                      ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400'
                      : 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400'
                }`}
              >
                {tc.status === 'running' ? '🔧 正在执行' : tc.status === 'error' ? '❌' : '✅'}{' '}
                {tc.name}
                {tc.result && <span className="ml-1 opacity-70">- {tc.result}</span>}
              </div>
            ))}
          </div>
        )}
        <div className="whitespace-pre-wrap break-words">{message.content}</div>
      </div>
    </div>
  );
}
