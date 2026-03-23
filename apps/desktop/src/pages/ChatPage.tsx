import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { BRAND_EVENT_PREFIX } from '@evoclaw/shared';
import { useChatStore, type Message, type ToolCall } from '../stores/chat-store';
import { useAgentStore } from '../stores/agent-store';
import AgentAvatar from '../components/AgentAvatar';
import ModelSelector from '../components/ModelSelector';
import { useAppStore } from '../stores/app-store';
import PermissionDialog from '../components/PermissionDialog';
import { invoke } from '@tauri-apps/api/core';

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


// ─── 欢迎页（无专家选中时） ───

function WelcomeState() {
  const navigate = useNavigate();

  return (
    <div className="h-full flex flex-col items-center justify-center bg-gradient-to-b from-slate-50/80 to-white">
      <img
        src="/brand-logo.png" alt="Logo"
        className="w-16 h-16 mx-auto mb-5 object-contain drop-shadow-sm"
        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
      />
      <h2 className="text-2xl font-bold text-slate-800 mb-2">选择专家开始对话</h2>
      <p className="text-sm text-slate-400 mb-6">从左侧面板选择一位专家，或创建新的专家</p>
      <div className="flex gap-3">
        <button
          onClick={() => navigate('/agents?tab=mine&create=1')}
          className="px-6 py-2.5 bg-brand text-white text-sm font-medium rounded-xl
            hover:bg-brand-hover shadow-sm hover:shadow transition-all"
        >
          创建专家
        </button>
        <button
          onClick={() => navigate('/agents')}
          className="px-6 py-2.5 text-sm font-medium text-slate-600
            bg-white border border-slate-200 rounded-xl
            hover:border-brand/40 hover:text-brand transition-all"
        >
          去专家商店
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
    fetchConversations,
  } = useChatStore();

  const { agents, fetchAgents } = useAgentStore();
  const { sidecarConnected } = useAppStore();

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [permissionRequest, setPermissionRequest] = useState<{
    requestId: string;
    toolName: string;
    category: string;
    resource: string;
    reason?: string;
  } | null>(null);
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

      const body: Record<string, unknown> = { message: text, sessionKey: currentSessionKey };
      // 临时模型覆盖
      if (selectedModelId) {
        body.modelId = selectedModelId;
      }

      const response = await fetch(
        `http://127.0.0.1:${config.port}/chat/${currentAgentId}/send`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.token}`,
          },
          body: JSON.stringify(body),
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
                case 'permission_required':
                  setPermissionRequest({
                    requestId: payload.requestId,
                    toolName: payload.toolName,
                    category: payload.category,
                    resource: payload.resource ?? '*',
                    reason: payload.reason,
                  });
                  break;
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
      window.dispatchEvent(new CustomEvent(`${BRAND_EVENT_PREFIX}:conversations-changed`));
    }
  }, [
    currentAgentId, currentSessionKey, input, attachments, isStreaming, selectedModelId,
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

  /** 权限决策回调 */
  const handlePermissionDecision = useCallback(
    async (scope: 'always' | 'deny') => {
      if (!permissionRequest || !currentAgentId) return;
      try {
        if (scope === 'always') {
          const configStr = localStorage.getItem('sidecar-config');
          if (configStr) {
            const config = JSON.parse(configStr) as { port: number; token: string };
            await fetch(
              `http://127.0.0.1:${config.port}/security/${currentAgentId}/permissions`,
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  Authorization: `Bearer ${config.token}`,
                },
                body: JSON.stringify({
                  category: permissionRequest.category,
                  scope: 'always',
                  resource: permissionRequest.resource || '*',
                }),
              },
            );
            invoke('update_permission', {
              agentId: currentAgentId,
              category: permissionRequest.category,
              scope: 'always',
            }).catch(() => {});
          }
        }
      } catch (err) {
        console.error('权限授予失败:', err);
      }
      setPermissionRequest(null);
    },
    [permissionRequest, currentAgentId],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-white h-full">
      {/* 头部 */}
      <div className="h-12 border-b border-slate-200/60 bg-white flex items-center px-4 gap-3 shrink-0">
        {currentAgent && (
          <>
            <AgentAvatar name={currentAgent.name} size="sm" />
            <span className="font-medium text-sm">{currentAgent.name}</span>
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
            <div className="text-center text-slate-400">
              <p className="text-sm">加载历史消息...</p>
            </div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center text-slate-400">
              {currentAgent ? <AgentAvatar name={currentAgent.name} size="xl" className="mx-auto mb-3" /> : <p className="text-3xl mb-3">💬</p>}
              <p className="text-sm">
                与 <span className="font-medium">{currentAgent?.name ?? '专家'}</span> 开始对话
              </p>
            </div>
          </div>
        ) : (
          <div className="mx-auto px-6 space-y-4">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} agentName={currentAgent?.name} />
            ))}
            {isStreaming && (
              <div className="flex items-center gap-2 text-slate-400 text-xs pl-2">
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
      <div className="px-6 pb-4 pt-2 shrink-0">
        <div className="mx-auto rounded-2xl border border-slate-200/80 bg-white shadow-sm overflow-hidden">
          {/* 附件卡片区 */}
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 px-4 pt-3">
              {attachments.map((file, i) => (
                <div key={i} className="group relative w-[160px] rounded-lg border border-slate-200 bg-slate-50 p-3 hover:border-brand/40 transition-colors">
                  <button
                    onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-slate-400 text-white text-xs
                      flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-red-500 transition-all"
                  >×</button>
                  <p className="text-xs font-medium text-slate-700 truncate mb-2">{file.name}</p>
                  <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-slate-200 text-slate-500">
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
            className="w-full resize-none px-4 py-3 text-sm bg-transparent text-slate-900
              focus:outline-none placeholder:text-slate-400"
          />

          {/* 底部操作栏 */}
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
              className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400
                hover:bg-slate-100 hover:text-slate-600 transition-colors
                disabled:opacity-40 disabled:cursor-not-allowed"
              title="添加附件"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
            </button>

            {/* 右侧：模型选择器 + 发送按钮 */}
            <div className="flex items-center gap-1.5">
              <ModelSelector
                selectedModelId={selectedModelId}
                onModelChange={setSelectedModelId}
                disabled={isStreaming}
              />

              {/* 发送按钮 — 保持原样 */}
              <button
                onClick={() => sendMessage()}
                disabled={isStreaming || (!input.trim() && attachments.length === 0)}
                className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
                  isStreaming || (!input.trim() && attachments.length === 0)
                    ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
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

      {/* 权限弹窗 */}
      <PermissionDialog
        isOpen={!!permissionRequest}
        agentName={currentAgent?.name ?? 'Agent'}
        agentEmoji={currentAgent?.emoji ?? ''}
        category={permissionRequest?.category ?? ''}
        resource={permissionRequest?.resource ?? ''}
        reason={permissionRequest?.reason}
        onDecision={handlePermissionDecision}
        onClose={() => setPermissionRequest(null)}
      />
    </div>
  );
}

// ─── 主页面（路由控制器） ───

export default function ChatPage() {
  const {
    currentAgentId,
    currentSessionKey,
  } = useChatStore();

  // 如果已经选中了 Agent 和会话 -> 显示对话视图
  if (currentAgentId && currentSessionKey) {
    return <ChatView />;
  }

  // 默认：显示欢迎页（Agent 选择在 ExpertPanel 中完成）
  return <WelcomeState />;
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
          className="text-xs text-slate-400 hover:text-brand px-2 py-0.5 transition-colors"
        >
          ... 还有 {hiddenCount} 个工具调用，点击展开
        </button>
      )}
      {expanded && toolCalls.length > MAX_VISIBLE_TOOLS && (
        <button
          onClick={() => setExpanded(false)}
          className="text-xs text-slate-400 hover:text-brand px-2 py-0.5 transition-colors"
        >
          收起
        </button>
      )}
    </div>
  );
}

/** 工具名称美化映射 */
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  bash: 'Exec', read: 'Read', write: 'Write', edit: 'Edit',
  grep: 'Grep', find: 'Find', ls: 'List',
  web_search: 'Search', web_fetch: 'Fetch',
  image: 'Image', pdf: 'PDF',
  apply_patch: 'Patch', exec_background: 'Background',
  process: 'Process', memory_search: 'Memory',
  spawn_agent: 'Spawn', list_agents: 'Agents', kill_agent: 'Kill',
};

function ToolCallItem({ tc }: { tc: ToolCall }) {
  const displayName = TOOL_DISPLAY_NAMES[tc.name] ?? tc.name;
  const statusIcon = tc.status === 'running'
    ? <span className="w-3 h-3 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
    : tc.status === 'error'
      ? <span className="text-red-500 text-xs font-bold">!</span>
      : <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>;

  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/50 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11.42 15.17l-5.658 3.286a1.125 1.125 0 01-1.674-1.087l1.058-6.3L.343 6.37a1.125 1.125 0 01.638-1.92l6.328-.924L10.14.706a1.125 1.125 0 012.02 0l2.83 5.82 6.328.924a1.125 1.125 0 01.638 1.92l-4.797 4.7 1.058 6.3a1.125 1.125 0 01-1.674 1.087L12 15.17z" />
        </svg>
        <span className="text-xs font-semibold text-slate-700 flex-1">{displayName}</span>
        <span className="shrink-0">{statusIcon}</span>
      </div>
      {tc.summary && (
        <div className="px-3 pb-2">
          <code className="text-xs text-slate-500 font-mono break-all leading-relaxed">
            {tc.summary}
          </code>
        </div>
      )}
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
    <div className={`group flex gap-3 ${isUser ? 'flex-row-reverse' : 'flex-row'} ${isEmpty ? 'min-h-0' : ''}`}>
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
      <div className="min-w-0 flex-1">
        {isEmpty ? (
          <div className="flex items-center gap-1 py-1">
            <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-pulse" />
            <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-pulse [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 bg-slate-300 rounded-full animate-pulse [animation-delay:300ms]" />
          </div>
        ) : (
          <>
            <div
              className={`w-fit rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
                isUser
                  ? 'max-w-[75%] ml-auto bg-slate-100 text-slate-900 rounded-br-sm'
                  : 'max-w-[90%] bg-white text-gray-900 border border-gray-200 rounded-bl-sm'
              }`}
            >
              {hasTools && (
                <ToolCallList toolCalls={message.toolCalls!} hasContent={hasContent} />
              )}
              {hasContent && (
                isUser
                  ? <div className="whitespace-pre-wrap break-words">{message.content}</div>
                  : <div className="max-w-none break-words text-sm leading-relaxed
                      text-slate-900
                      [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1.5
                      [&_h2]:text-base [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1.5
                      [&_h3]:text-sm [&_h3]:font-bold [&_h3]:mt-2 [&_h3]:mb-1
                      [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:mt-2 [&_h4]:mb-1
                      [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5
                      [&_pre]:bg-slate-900 [&_pre]:text-slate-100 [&_pre]:rounded-lg [&_pre]:text-xs [&_pre]:p-3 [&_pre]:my-2 [&_pre]:overflow-x-auto
                      [&_code]:text-pink-600 [&_code]:text-sm
                      [&_pre_code]:text-slate-100 [&_pre_code]:text-xs
                      [&_a]:text-brand [&_a]:no-underline hover:[&_a]:underline
                      [&_strong]:font-semibold [&_strong]:text-slate-900
                      [&_blockquote]:border-l-2 [&_blockquote]:border-slate-300 [&_blockquote]:pl-3 [&_blockquote]:text-slate-600
                      [&_table]:text-xs [&_th]:px-2 [&_td]:px-2 [&_hr]:my-3">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
                    </div>
              )}
            </div>

            {/* 消息操作栏 */}
            {!isUser && hasContent && (
              <div className="flex items-center gap-1 mt-1 ml-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => navigator.clipboard.writeText(message.content)}
                  className="flex items-center gap-1 px-2 py-0.5 text-xs text-slate-400
                    hover:text-slate-600 hover:bg-slate-100 rounded transition-colors"
                  title="复制"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                  </svg>
                  复制
                </button>
                <button
                  className="p-1 text-slate-400 hover:text-emerald-500 hover:bg-slate-100 rounded transition-colors"
                  title="有用"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3.75a.75.75 0 01.75-.75A2.25 2.25 0 0116.5 5.25c0 .032-.002.064-.004.096l-.048.576a5.624 5.624 0 01-.88 2.46l-.3.45a1.048 1.048 0 00.21 1.34l.497.39c.486.386.816.948.888 1.57l.14 1.213c.074.646-.16 1.291-.632 1.757l-.64.633a3 3 0 01-2.345.826l-3.083-.211a3 3 0 01-1.536-.527l-1.32-.88A3.75 3.75 0 006 14.25v-3.75z" />
                  </svg>
                </button>
                <button
                  className="p-1 text-slate-400 hover:text-red-500 hover:bg-slate-100 rounded transition-colors"
                  title="无用"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M17.367 13.5c-.806 0-1.533.446-2.031 1.08a9.041 9.041 0 01-2.861 2.4c-.723.384-1.35.956-1.653 1.715a4.498 4.498 0 00-.322 1.672v.633a.75.75 0 01-.75.75A2.25 2.25 0 017.5 18.75c0-.032.002-.064.004-.096l.048-.576a5.624 5.624 0 01.88-2.46l.3-.45a1.048 1.048 0 00-.21-1.34l-.497-.39a2.622 2.622 0 01-.888-1.57l-.14-1.213a2.25 2.25 0 01.632-1.757l.64-.633a3 3 0 012.345-.826l3.083.211c.546.037 1.07.228 1.536.527l1.32.88A3.75 3.75 0 0018 9.75v3.75z" />
                  </svg>
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
