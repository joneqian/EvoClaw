import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore, type Message, type ToolCall } from '../stores/chat-store';
import { useAgentStore } from '../stores/agent-store';
import { useAppStore } from '../stores/app-store';

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

export default function ChatPage() {
  const {
    messages,
    isStreaming,
    currentAgentId,
    setCurrentAgent,
    addMessage,
    appendToLastMessage,
    updateLastMessageToolCalls,
    setStreaming,
  } = useChatStore();

  const { agents, fetchAgents } = useAgentStore();
  const { sidecarConnected } = useAppStore();
  const navigate = useNavigate();

  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /** 挂载时加载 Agent 列表 */
  useEffect(() => {
    fetchAgents();
  }, [fetchAgents]);

  /** 自动滚动到底部 */
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  /** 自动调整 textarea 高度 */
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 160) + 'px';
    }
  }, [input]);

  /** 发送消息 */
  const sendMessage = useCallback(async () => {
    if (!currentAgentId || !input.trim() || isStreaming) return;

    const userMsg: Message = {
      id: uid(),
      role: 'user',
      content: input.trim(),
      createdAt: new Date().toISOString(),
    };
    addMessage(userMsg);
    setInput('');

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
          body: JSON.stringify({ message: userMsg.content }),
        },
      );

      if (!response.ok) {
        appendToLastMessage(`请求失败: HTTP ${response.status}`);
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
          if (!trimmed) {
            currentEvent = '';
            continue;
          }

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
                  toolCalls.push({
                    name: payload.name ?? '未知工具',
                    status: 'running',
                  });
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
    }
  }, [
    currentAgentId,
    input,
    isStreaming,
    addMessage,
    appendToLastMessage,
    updateLastMessageToolCalls,
    setStreaming,
  ]);

  /** 键盘事件 */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const currentAgent = agents.find((a) => a.id === currentAgentId);

  return (
    <div className="flex h-full">
      {/* 左侧 Agent 选择栏 */}
      <div className="w-52 border-r border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex flex-col">
        <div className="p-3 border-b border-gray-100 dark:border-gray-700">
          <h3 className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
            选择 Agent
          </h3>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {agents.length === 0 ? (
            <div className="text-center mt-8 px-2">
              <p className="text-3xl mb-2">🐾</p>
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-3">
                还没有 Agent
              </p>
              <button
                onClick={() => navigate('/agents')}
                className="text-xs text-[#00d4aa] hover:text-[#00b894]"
              >
                去创建 →
              </button>
            </div>
          ) : (
            agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => setCurrentAgent(agent.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${
                  currentAgentId === agent.id
                    ? 'bg-[#00d4aa]/10 text-[#00a88a] font-medium'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-gray-700'
                }`}
              >
                <span className="mr-2">{agent.emoji}</span>
                {agent.name}
              </button>
            ))
          )}
        </div>
      </div>

      {/* 主聊天区域 */}
      <div className="flex-1 flex flex-col bg-gray-50 dark:bg-gray-900">
        {/* 头部 */}
        {currentAgent && (
          <div className="h-12 border-b border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 flex items-center px-4">
            <span className="mr-2 text-lg">{currentAgent.emoji}</span>
            <span className="font-medium text-sm dark:text-white">{currentAgent.name}</span>
            {!sidecarConnected && (
              <span className="ml-3 text-xs text-red-400">Sidecar 未连接</span>
            )}
          </div>
        )}

        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {!currentAgentId ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-gray-400 dark:text-gray-500">
                <p className="text-4xl mb-3">💬</p>
                <p className="text-sm">选择一个 Agent 开始对话</p>
                {agents.length === 0 && (
                  <button
                    onClick={() => navigate('/agents')}
                    className="mt-3 text-sm text-[#00d4aa] hover:text-[#00b894]"
                  >
                    或者先创建一个 Agent →
                  </button>
                )}
              </div>
            </div>
          ) : messages.length === 0 ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center text-gray-400 dark:text-gray-500">
                <p className="text-3xl mb-3">{currentAgent?.emoji}</p>
                <p className="text-sm">
                  与 <span className="font-medium">{currentAgent?.name}</span> 开始对话
                </p>
              </div>
            </div>
          ) : (
            <div className="max-w-2xl mx-auto space-y-4">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              {isStreaming && (
                <div className="flex items-center gap-2 text-gray-400 dark:text-gray-500 text-xs pl-2">
                  <span className="flex gap-0.5">
                    <span className="w-1.5 h-1.5 bg-[#00d4aa] rounded-full animate-pulse" />
                    <span className="w-1.5 h-1.5 bg-[#00d4aa] rounded-full animate-pulse [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-[#00d4aa] rounded-full animate-pulse [animation-delay:300ms]" />
                  </span>
                  正在思考...
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        {/* 输入区域 */}
        {currentAgentId && (
          <div className="border-t border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-3">
            <div className="max-w-2xl mx-auto flex gap-2 items-end">
              <textarea
                ref={textareaRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="输入消息... (Enter 发送, Shift+Enter 换行)"
                rows={1}
                className="flex-1 resize-none rounded-lg border border-gray-200 dark:border-gray-600 px-3 py-2 text-sm
                  bg-white dark:bg-gray-700 text-gray-900 dark:text-white
                  focus:outline-none focus:ring-2 focus:ring-[#00d4aa]/40 focus:border-[#00d4aa]
                  placeholder:text-gray-400 dark:placeholder:text-gray-500"
              />
              <button
                onClick={sendMessage}
                disabled={isStreaming || !input.trim()}
                className="shrink-0 px-4 py-2 rounded-lg text-sm font-medium text-white
                  bg-[#00d4aa] hover:bg-[#00b894] transition-colors
                  disabled:opacity-40 disabled:cursor-not-allowed"
              >
                发送
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
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
            ? 'bg-[#00d4aa] text-white rounded-br-sm'
            : 'bg-white dark:bg-gray-800 text-gray-800 dark:text-gray-200 border border-gray-100 dark:border-gray-700 rounded-bl-sm shadow-sm'
        }`}
      >
        {/* 工具调用展示 */}
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
