import { useState, useRef, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Paperclip, Sparkles, Square, ArrowUp, ListChecks, MessageSquare, Clock, ChevronRight, Check, Trash2 } from 'lucide-react';
import { BRAND_EVENT_PREFIX, parseQuotedPrefix } from '@evoclaw/shared';
import { useChatStore, type Message, type ToolCall, type ToolSegment, type RecallMeta } from '../stores/chat-store';
import { useAgentStore } from '../stores/agent-store';
import { useMemoryStore, type MemoryFeedbackType } from '../stores/memory-store';
import { patch, post } from '../lib/api';
import ModelSelector from '../components/ModelSelector';
import ExpertSettingsPanel from '../components/ExpertSettingsPanel';
import { useAppStore } from '../stores/app-store';
import PermissionDialog from '../components/PermissionDialog';
import ThinkingBlock from '../components/ThinkingBlock';
import DestructiveConfirmDialog from '../components/DestructiveConfirmDialog';
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


// ─── 对话视图 ───

function ChatView() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const {
    messages,
    isStreaming,
    currentAgentId,
    currentSessionKey,
    loadingMessages,
    addMessage,
    appendToLastMessage,
    updateLastMessageToolCalls,
    appendTextSegment,
    appendThinkingSegment,
    toggleThinkingExpanded,
    addToolSegment,
    updateToolSegment,
    updateToolProgress,
    discardLastAssistantMessage,
    setLastMessageRecallMeta,
    destructiveConfirm,
    setDestructiveConfirm,
    setStreaming,
    fetchConversations,
    newConversation,
  } = useChatStore();

  const { agents, fetchAgents } = useAgentStore();
  const { sidecarConnected } = useAppStore();

  const [input, setInput] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  // 模型选择：初始化为当前专家绑定的模型
  const currentAgent = agents.find((a) => a.id === currentAgentId);
  const [selectedModelId, setSelectedModelId] = useState<string | null>(currentAgent?.modelId ?? null);
  const [showSettings, setShowSettings] = useState(false);
  const [permissionRequest, setPermissionRequest] = useState<{
    requestId: string;
    toolName: string;
    category: string;
    resource: string;
    reason?: string;
    smartApprove?: { decision: 'escalate'; reason: string };
  } | null>(null);
  /** 子 Agent 完成通知（浮动 pill，12s 自动消失） */
  const [subagentNotices, setSubagentNotices] = useState<Array<{
    id: string;
    taskId: string;
    task: string;
    status: 'completed' | 'failed' | 'cancelled';
    success: boolean;
    durationMs: number;
    agentType?: string;
  }>>([]);
  /** 自动后台化提示 banner */
  const [backgroundedNotice, setBackgroundedNotice] = useState<{
    elapsedMs: number;
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

  // 渠道会话消息更新已由 App.tsx 的 SSE conversations-changed 事件驱动
  // 无需独立轮询（SSE 断开时由 App.tsx 30s 兜底轮询覆盖）

  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = Math.min(el.scrollHeight, 160) + 'px';
    }
  }, [input]);

  // 切换专家时同步模型选择
  useEffect(() => {
    setSelectedModelId(currentAgent?.modelId ?? null);
  }, [currentAgentId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 模型选择变更 → 保存到后端 */
  const handleModelChange = useCallback((modelId: string | null, provider?: string) => {
    setSelectedModelId(modelId);
    if (!currentAgentId || !modelId) return;
    // 持久化到后端 Agent 配置
    const updates: Record<string, unknown> = { modelId };
    if (provider) updates.provider = provider;
    patch(`/agents/${currentAgentId}`, updates)
      .then(() => fetchAgents())
      .catch(() => {});
  }, [currentAgentId, fetchAgents]);

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
        appendTextSegment('Sidecar 未连接，无法发送消息。');
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
        appendTextSegment(`请求失败: ${errMsg}`);
        setStreaming(false);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        appendTextSegment('无法读取响应流');
        setStreaming(false);
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let currentEvent = '';

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
                case 'text_delta': {
                  const delta = payload.delta ?? payload.text ?? '';
                  appendTextSegment(delta);
                  break;
                }
                case 'thinking_delta': {
                  const thinkDelta = payload.delta ?? '';
                  appendThinkingSegment(thinkDelta);
                  break;
                }
                case 'tool_update': {
                  const progressName = payload.toolName ?? payload.name;
                  const progressText = payload.toolResult ?? payload.message ?? '';
                  updateToolProgress(progressName, progressText);
                  break;
                }
                case 'tool_start': {
                  const toolName = payload.toolName ?? payload.name ?? '未知工具';
                  const args = payload.toolArgs ?? payload.args;
                  const summary = formatToolSummary(toolName, args);
                  const displayName = TOOL_DISPLAY_NAMES[toolName] ?? toolName;
                  addToolSegment({ type: 'tool', name: toolName, displayName, summary, status: 'running' });

                  // 破坏性操作检测 — 弹出确认对话框
                  if (payload.isDestructive) {
                    setDestructiveConfirm({
                      toolName,
                      args: args ?? {},
                      resolve: () => {},
                    });
                  }
                  break;
                }
                case 'tool_end': {
                  const endName = payload.toolName ?? payload.name;
                  const toolResult = payload.toolResult ?? payload.result;
                  updateToolSegment(endName, {
                    status: payload.isError ? 'error' : 'done',
                    result: typeof toolResult === 'string' ? toolResult : undefined,
                    isError: payload.isError,
                  });
                  break;
                }
                case 'permission_required':
                  setPermissionRequest({
                    requestId: payload.requestId,
                    toolName: payload.toolName,
                    category: payload.category,
                    resource: payload.resource ?? '*',
                    reason: payload.reason,
                    smartApprove: payload.smartApprove,
                  });
                  break;
                case 'recall_meta':
                  // Sprint 15.12 Phase E — Show Your Work 折叠条数据
                  setLastMessageRecallMeta({
                    memoryIds: payload.memoryIds ?? [],
                    scores: payload.scores ?? [],
                    l0Indexes: payload.l0Indexes ?? [],
                    categories: payload.categories ?? [],
                  });
                  break;
                case 'queued':
                  break;
                case 'agent_done':
                  setStreaming(false);
                  break;
                case 'error':
                  appendTextSegment(`\n[错误] ${payload.message ?? '未知错误'}`);
                  setStreaming(false);
                  break;
                case 'tombstone':
                  // 模型回退: 丢弃本轮 partial 内容，等待 fallback 模型重新填充
                  discardLastAssistantMessage();
                  break;
                case 'subagent_notification': {
                  // 子 Agent 完成通知 — 浮动 pill（12s 自动消失）
                  const n = payload.subagentNotification;
                  if (n) {
                    const noticeId = uid();
                    setSubagentNotices(prev => [
                      ...prev.slice(-4), // 最多保留 5 条
                      {
                        id: noticeId,
                        taskId: n.taskId,
                        task: n.task ?? '',
                        status: n.status,
                        success: !!n.success,
                        durationMs: n.durationMs ?? 0,
                        agentType: n.agentType,
                      },
                    ]);
                    // 12 秒后自动移除
                    setTimeout(() => {
                      setSubagentNotices(prev => prev.filter(x => x.id !== noticeId));
                    }, 12000);
                  }
                  break;
                }
                case 'subagent_progress':
                  // 进度事件由任务面板展示，此处不占用聊天流
                  break;
                case 'auto_backgrounded':
                  // 60s 自动后台化 — 显示一个轻量 banner，提醒用户可继续对话
                  setBackgroundedNotice({
                    elapsedMs: payload.autoBackgrounded?.elapsedMs ?? 0,
                  });
                  setTimeout(() => setBackgroundedNotice(null), 8000);
                  break;
                case 'usage': {
                  // M3-T2: 接住 turnCount/maxTurns/remainingTurns → 状态栏显示剩余轮次
                  const u = payload.usage;
                  if (u && typeof u.turnCount === 'number' && typeof u.maxTurns === 'number') {
                    useChatStore.getState().setTurnProgress({ used: u.turnCount, max: u.maxTurns });
                  }
                  break;
                }
                case 'stream_metrics':
                case 'message_start':
                case 'message_end':
                case 'compaction_start':
                case 'compaction_end':
                  // 后端内部事件，前端静默忽略
                  break;
              }
            } catch {
              appendTextSegment(parsed.data);
            }
          }
        }
      }
    } catch (err) {
      appendTextSegment(`\n[连接错误] ${err instanceof Error ? err.message : '未知错误'}`);
    } finally {
      setStreaming(false);
      if (currentAgentId) fetchConversations(currentAgentId);
      fetchAgents(); // 刷新专家列表排序（last_chat_at 已更新）
      window.dispatchEvent(new CustomEvent(`${BRAND_EVENT_PREFIX}:conversations-changed`));
    }
  }, [
    currentAgentId, currentSessionKey, input, attachments, isStreaming, selectedModelId,
    addMessage, appendTextSegment, addToolSegment, updateToolSegment,
    setStreaming, fetchConversations,
  ]);

  /** 取消正在运行的 Agent 任务 */
  const cancelRun = useCallback(async () => {
    if (!currentAgentId || !currentSessionKey) return;
    try {
      await post(`/chat/${currentAgentId}/cancel`, { sessionKey: currentSessionKey });
    } catch {
      // 忽略取消失败（可能任务已完成）
    }
  }, [currentAgentId, currentSessionKey]);

  // 检查 pending message（从专家页面带过来的初始消息）
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

  const hasMessages = messages.length > 0;

  /** 输入区域（空态和消息态共享） */
  // M3-T2: 剩余轮次状态栏（输入区正上方一行）
  const turnProgress = useChatStore((s) => s.turnProgress);
  const turnStatusText = (() => {
    if (!turnProgress) return null;
    const { used, max } = turnProgress;
    const remaining = Math.max(0, max - used);
    const ratio = max > 0 ? remaining / max : 1;
    let colorCls = 'text-muted-foreground';
    if (ratio < 0.2) colorCls = 'text-rose-500';
    else if (ratio < 0.5) colorCls = 'text-warning';
    return { text: `已用 ${used} / 剩余 ${remaining}`, colorCls };
  })();

  const inputArea = (
    <div className="w-full max-w-[700px] mx-auto">
      {turnStatusText && (
        <div className="flex justify-end pr-2 mb-1">
          <span className={`text-xs ${turnStatusText.colorCls}`} title={`本次会话工具调用轮次：${turnStatusText.text}`}>
            {turnStatusText.text}
          </span>
        </div>
      )}
      <div className="rounded-2xl border border-border/80 bg-card shadow-sm overflow-hidden">
        {/* 附件卡片区 */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-4 pt-3">
            {attachments.map((file, i) => (
              <div key={i} className="group/att relative w-[160px] rounded-lg border border-border bg-muted p-3 hover:border-brand/40 transition-colors">
                <button
                  onClick={() => setAttachments(prev => prev.filter((_, j) => j !== i))}
                  className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-muted-foreground text-white text-xs
                    flex items-center justify-center opacity-0 group-hover/att:opacity-100 hover:bg-danger transition-all"
                >×</button>
                <p className="text-xs font-medium text-foreground truncate mb-2">{file.name}</p>
                <span className="inline-block px-1.5 py-0.5 rounded text-xs font-medium bg-accent text-muted-foreground">
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
          onPaste={(e) => {
            // 剪贴板图片粘贴支持
            const items = e.clipboardData?.items;
            if (!items) return;
            for (const item of items) {
              if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) setAttachments(prev => [...prev, file]);
                return;
              }
            }
          }}
          placeholder={t('chat.placeholder')}
          rows={3}
          className="w-full resize-none px-4 py-3 text-sm bg-transparent text-foreground
            focus-visible:outline-none placeholder:text-muted-foreground min-h-[80px]"
        />

        {/* 底部操作栏 */}
        <div className="flex items-center justify-between px-3 pb-2.5">
          {/* 左侧：附件 + AI 增强 */}
          <div className="flex items-center gap-0.5">
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
              className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground
                hover:bg-accent hover:text-muted-foreground transition-colors
                disabled:opacity-40 disabled:cursor-not-allowed"
              title="添加附件"
            >
              {/* 回形针图标 */}
              <Paperclip className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
            </button>
            <button
              disabled={isStreaming}
              className="w-7 h-7 flex items-center justify-center rounded-lg text-muted-foreground
                hover:bg-accent hover:text-muted-foreground transition-colors
                disabled:opacity-40 disabled:cursor-not-allowed"
              title="AI 增强"
            >
              {/* 星形图标 */}
              <Sparkles className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
            </button>
          </div>

          {/* 右侧：模型选择器 + 发送按钮 */}
          <div className="flex items-center gap-1.5">
            <ModelSelector
              selectedModelId={selectedModelId}
              onModelChange={handleModelChange}
              disabled={isStreaming}
            />

            {/* 发送/停止按钮 */}
            {isStreaming ? (
              <button
                onClick={cancelRun}
                className="w-8 h-8 flex items-center justify-center rounded-full transition-colors bg-danger text-white hover:bg-danger"
                title="停止"
              >
                <Square className="w-4 h-4 fill-current" strokeWidth={1} aria-hidden="true" />
              </button>
            ) : (
              <button
                onClick={() => sendMessage()}
                disabled={!input.trim() && attachments.length === 0}
                className={`w-8 h-8 flex items-center justify-center rounded-full transition-colors ${
                  !input.trim() && attachments.length === 0
                    ? 'bg-accent text-muted-foreground cursor-not-allowed'
                    : 'bg-brand text-white hover:bg-brand-hover'
                }`}
              >
                <ArrowUp className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
              </button>
            )}
          </div>
        </div>
      </div>
      <p className="text-xs text-muted-foreground text-center mt-2">内容由AI生成，仅供参考</p>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col bg-card h-full relative">
      {/* 右上角：专家设置 */}
      {currentAgent && (
        <div className="absolute top-2 right-4 z-10 flex items-center gap-2">
          {!sidecarConnected && (
            <span className="text-xs text-danger">Sidecar 未连接</span>
          )}
          <button
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-lg
              hover:bg-muted transition-colors text-muted-foreground"
          >
            <ListChecks className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
            专家设置
          </button>
        </div>
      )}

      {loadingMessages ? (
        /* 加载状态 */
        <div className="flex-1 flex items-center justify-center">
          <p className="text-sm text-muted-foreground">加载历史消息...</p>
        </div>
      ) : !hasMessages ? (
        /* ── 空态：欢迎 + 输入 ── */
        <div className="flex-1 flex flex-col items-center justify-center px-6">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-foreground">
              Hi, 我是{currentAgent?.name ?? '专家'}
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              {currentAgent?.name ?? ''}
            </p>
          </div>
          {inputArea}
        </div>
      ) : (
        /* ── 有消息：新建对话 + 消息列表 + 底部输入 ── */
        <>
          {/* 新建对话按钮 */}
          <div className="shrink-0 px-4 pt-3 pb-1">
            <button
              onClick={() => currentAgentId && newConversation(currentAgentId)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-lg hover:bg-muted transition-colors"
            >
              <MessageSquare className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
              新建对话
            </button>
          </div>

          {/* 消息列表 */}
          <div className="flex-1 overflow-y-auto px-4 py-2">
            <div className="mx-auto px-6 space-y-0">
              {messages.map((msg) => (
                <MessageBubble key={msg.id} message={msg} />
              ))}
              {/* 思考指示器由 MessageBubble 的空消息状态显示，无需额外重复 */}
              <div ref={messagesEndRef} />
            </div>
          </div>

          {/* 子 Agent 完成通知 + 后台化 banner（浮动在输入区上方） */}
          {(subagentNotices.length > 0 || backgroundedNotice) && (
            <div className="shrink-0 px-6 pt-1 pb-0 flex flex-col gap-1.5 items-center">
              {backgroundedNotice && (
                <div className="flex items-center gap-2 px-3 py-1.5 bg-warning/10 border border-warning/30
                                rounded-full text-xs text-warning shadow-sm">
                  <Clock className="w-3.5 h-3.5" strokeWidth={2} aria-hidden="true" />
                  <span>Agent 已转后台运行（{(backgroundedNotice.elapsedMs / 1000).toFixed(0)}s），您可以继续对话</span>
                  <button
                    onClick={() => setBackgroundedNotice(null)}
                    className="ml-1 text-warning hover:text-warning"
                    title="关闭"
                  >
                    ×
                  </button>
                </div>
              )}
              {subagentNotices.map((n) => {
                const isOk = n.success && n.status === 'completed';
                const isCancelled = n.status === 'cancelled';
                const colorCls = isOk
                  ? 'bg-success/10 border-success/30 text-success'
                  : isCancelled
                  ? 'bg-muted border-border text-muted-foreground'
                  : 'bg-danger/10 border-danger/30 text-danger';
                const statusText = isOk ? '完成' : isCancelled ? '已取消' : '失败';
                return (
                  <div
                    key={n.id}
                    className={`flex items-center gap-2 px-3 py-1.5 border rounded-full text-xs shadow-sm max-w-full ${colorCls}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      isOk ? 'bg-success' : isCancelled ? 'bg-muted-foreground' : 'bg-danger'
                    }`} />
                    <span className="truncate max-w-[320px]">
                      子任务{statusText}：{n.task.slice(0, 60)}
                    </span>
                    <span className="text-muted-foreground shrink-0">
                      {(n.durationMs / 1000).toFixed(1)}s
                    </span>
                    <button
                      onClick={() => setSubagentNotices(prev => prev.filter(x => x.id !== n.id))}
                      className="ml-0.5 opacity-50 hover:opacity-100 shrink-0"
                      title="关闭"
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          {/* 底部输入 */}
          <div className="px-6 pb-4 pt-2 shrink-0">
            {inputArea}
          </div>
        </>
      )}

      {/* 权限弹窗 */}
      <PermissionDialog
        isOpen={!!permissionRequest}
        agentName={currentAgent?.name ?? 'Agent'}
        agentEmoji={currentAgent?.emoji ?? ''}
        category={permissionRequest?.category ?? ''}
        resource={permissionRequest?.resource ?? ''}
        reason={permissionRequest?.reason}
        smartApprove={permissionRequest?.smartApprove}
        onDecision={handlePermissionDecision}
        onClose={() => setPermissionRequest(null)}
      />

      {/* 破坏性操作确认对话框 */}
      {destructiveConfirm && (
        <DestructiveConfirmDialog
          toolName={destructiveConfirm.toolName}
          args={destructiveConfirm.args}
          onConfirm={() => {
            destructiveConfirm.resolve(true);
            setDestructiveConfirm(null);
          }}
          onDeny={() => {
            destructiveConfirm.resolve(false);
            setDestructiveConfirm(null);
          }}
        />
      )}

      {/* 专家设置面板 */}
      {currentAgentId && (
        <ExpertSettingsPanel
          agentId={currentAgentId}
          isOpen={showSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

// ─── 主页面（路由控制器） ───

export default function ChatPage() {
  const {
    currentAgentId,
    currentSessionKey,
  } = useChatStore();

  // 已选中专家 → 显示对话视图
  if (currentAgentId && currentSessionKey) {
    return <ChatView />;
  }

  // 无专家选中 → 空白页
  return <div className="h-full bg-card" />;
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
        <ToolCallItemLegacy key={i} tc={tc} />
      ))}
      {!showAll && hiddenCount > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="text-xs text-muted-foreground hover:text-brand px-2 py-0.5 transition-colors"
        >
          ... 还有 {hiddenCount} 个工具调用，点击展开
        </button>
      )}
      {expanded && toolCalls.length > MAX_VISIBLE_TOOLS && (
        <button
          onClick={() => setExpanded(false)}
          className="text-xs text-muted-foreground hover:text-brand px-2 py-0.5 transition-colors"
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

/** 工具调用卡片（支持展开结果） */
function ToolCallCard({ seg }: { seg: ToolSegment }) {
  const [expanded, setExpanded] = useState(false);
  const hasResult = !!seg.result;
  const statusIcon = seg.status === 'running'
    ? <span className="w-2.5 h-2.5 border-[1.5px] border-warning/50 border-t-transparent rounded-full animate-spin" />
    : seg.status === 'error'
      ? <span className="w-2 h-2 rounded-full bg-danger" />
      : <span className="w-2 h-2 rounded-full bg-success" />;

  return (
    <div
      className={`rounded-md border overflow-hidden my-1 ${
        hasResult ? 'cursor-pointer' : ''
      } ${seg.isError ? 'border-danger/20 bg-danger/10/30' : 'border-border bg-muted/40'}`}
      onClick={() => hasResult && setExpanded(!expanded)}
    >
      {/* 标题行 */}
      <div className="flex items-center gap-1.5 px-2.5 py-1.5">
        <span className="shrink-0">{statusIcon}</span>
        <span className="text-xs font-medium text-muted-foreground font-mono">{seg.displayName}</span>
        {seg.summary && (
          <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">{seg.summary}</span>
        )}
        {hasResult && (
          <ChevronRight className={`w-3 h-3 text-muted-foreground shrink-0 transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`} strokeWidth={2} aria-hidden="true" />
        )}
      </div>
      {/* 工具进度区域（运行中 + 有进度时显示） */}
      {seg.status === 'running' && seg.progress && (
        <div className="border-t border-border/80">
          <pre className="bg-foreground text-success dark:bg-muted dark:text-success font-mono text-[11px] leading-relaxed p-2 max-h-40 overflow-y-auto whitespace-pre-wrap break-all">
            {seg.progress}
            <span className="inline-block w-1.5 h-3 bg-success animate-pulse ml-0.5" />
          </pre>
        </div>
      )}
      {/* 可展开的结果区域（带动画） */}
      <div className={`overflow-hidden transition-all duration-200 ease-in-out ${
        expanded && seg.result ? 'max-h-64 opacity-100' : 'max-h-0 opacity-0'
      }`}>
        <div className="px-2.5 pb-2 border-t border-border/80">
          <pre className="text-[11px] text-muted-foreground font-mono whitespace-pre-wrap break-all leading-relaxed mt-1.5 max-h-48 overflow-y-auto">
            {seg.result && seg.result.length > 2000 ? seg.result.slice(0, 2000) + '\n... (truncated)' : seg.result}
          </pre>
        </div>
      </div>
    </div>
  );
}

/** 旧版工具调用项（向后兼容无 segments 的消息） */
function ToolCallItemLegacy({ tc }: { tc: ToolCall }) {
  const displayName = TOOL_DISPLAY_NAMES[tc.name] ?? tc.name;
  const statusIcon = tc.status === 'running'
    ? <span className="w-3 h-3 border-2 border-warning/50 border-t-transparent rounded-full animate-spin" />
    : tc.status === 'error'
      ? <span className="text-danger text-xs font-bold">!</span>
      : <Check className="w-3.5 h-3.5 text-success" strokeWidth={2.5} aria-hidden="true" />;

  return (
    <div className="rounded-lg border border-border bg-muted/50 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5">
        <span className="text-xs font-semibold text-foreground flex-1">{displayName}</span>
        {tc.summary && <span className="text-xs text-muted-foreground truncate">{tc.summary}</span>}
        <span className="shrink-0">{statusIcon}</span>
      </div>
    </div>
  );
}

/** Markdown 文本样式类 */
const MARKDOWN_CLASSES = `max-w-none break-words text-sm leading-relaxed text-foreground
  [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1.5
  [&_h2]:text-base [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1.5
  [&_h3]:text-sm [&_h3]:font-bold [&_h3]:mt-2 [&_h3]:mb-1
  [&_h4]:text-sm [&_h4]:font-semibold [&_h4]:mt-2 [&_h4]:mb-1
  [&_p]:my-1.5 [&_ul]:my-1.5 [&_ol]:my-1.5 [&_li]:my-0.5
  [&_pre]:bg-foreground dark:[&_pre]:bg-muted [&_pre]:text-card dark:[&_pre]:text-foreground [&_pre]:rounded-lg [&_pre]:text-xs [&_pre]:p-3 [&_pre]:my-2 [&_pre]:overflow-x-auto
  [&_code]:text-brand [&_code]:text-sm
  [&_pre_code]:text-card dark:[&_pre_code]:text-foreground [&_pre_code]:text-xs
  [&_a]:text-brand [&_a]:no-underline hover:[&_a]:underline
  [&_strong]:font-semibold [&_strong]:text-foreground
  [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground
  [&_table]:text-xs [&_th]:px-2 [&_td]:px-2 [&_hr]:my-3`;

/** 消息操作栏 */
function MessageActions({ content }: { content: string }) {
  return (
    <div className="flex items-center gap-1 mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        onClick={() => navigator.clipboard.writeText(content)}
        className="flex items-center gap-1 px-2 py-0.5 text-xs text-muted-foreground
          hover:text-muted-foreground hover:bg-accent rounded transition-colors"
        title="复制"
      >
        <Trash2 className="w-3 h-3" strokeWidth={1.5} aria-hidden="true" />
        复制
      </button>
    </div>
  );
}

/** 单条消息气泡组件 */
/** Show Your Work 折叠条 — Sprint 15.12 Phase E
 *  显示本轮 LLM 召回的记忆列表，每条带"不准"反馈按钮 */
function RecallMetaBar({ meta }: { meta: RecallMeta }) {
  const [expanded, setExpanded] = useState(false);
  const [flagged, setFlagged] = useState<Record<string, MemoryFeedbackType>>({});
  const [flagging, setFlagging] = useState<string | null>(null);
  const currentAgentId = useChatStore((s) => s.currentAgentId);
  const flagMemory = useMemoryStore((s) => s.flagMemory);

  const count = meta.memoryIds.length;
  if (count === 0) return null;

  const CATEGORY_LABELS: Record<string, string> = {
    profile: '个人',
    preference: '偏好',
    entity: '实体',
    event: '事件',
    case: '案例',
    pattern: '模式',
    tool: '工具',
    skill: '技能',
    correction: '纠正',
  };

  const handleFlag = async (memoryId: string) => {
    if (!currentAgentId || flagged[memoryId] || flagging) return;
    setFlagging(memoryId);
    try {
      await flagMemory(currentAgentId, memoryId, 'inaccurate');
      setFlagged((prev) => ({ ...prev, [memoryId]: 'inaccurate' }));
    } catch (err) {
      console.error('反馈失败:', err);
    } finally {
      setFlagging(null);
    }
  };

  return (
    <div className="mb-3 border border-border rounded-lg overflow-hidden bg-muted/50">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-3 py-1.5 flex items-center justify-between text-xs text-muted-foreground hover:bg-accent transition-colors"
      >
        <span className="flex items-center gap-1.5">
          <span className="text-muted-foreground">💭</span>
          本轮用到 {count} 条记忆
        </span>
        <span className="text-muted-foreground">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="border-t border-border divide-y divide-border">
          {meta.memoryIds.map((id, i) => {
            const l0 = meta.l0Indexes[i] ?? '(无摘要)';
            const cat = meta.categories[i] ?? '';
            const score = meta.scores[i] ?? 0;
            const isFlagged = !!flagged[id];
            return (
              <div key={id} className="flex items-start gap-2 px-3 py-1.5 text-xs">
                <span className="px-1.5 py-0.5 rounded bg-accent text-muted-foreground text-[10px] shrink-0">
                  {CATEGORY_LABELS[cat] ?? cat}
                </span>
                <span className="flex-1 text-foreground leading-snug">{l0}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{Math.round(score * 100)}%</span>
                {isFlagged ? (
                  <span className="text-[10px] text-warning shrink-0">已反馈</span>
                ) : (
                  <button
                    onClick={() => handleFlag(id)}
                    disabled={flagging === id}
                    className="text-[10px] text-muted-foreground hover:text-warning transition-colors shrink-0 disabled:opacity-50"
                    title="标记为不准确，下次召回会降权"
                  >
                    {flagging === id ? '提交中…' : '不准'}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const { t } = useTranslation();
  const { isStreaming, toggleThinkingExpanded } = useChatStore();
  const isUser = message.role === 'user';
  const hasSegments = message.segments && message.segments.length > 0;
  const hasContent = !!message.content;
  const hasTools = message.toolCalls && message.toolCalls.length > 0;
  const isEmpty = !isUser && !hasContent && !hasTools && !hasSegments;

  if (isUser) {
    const { quoted, rest } = parseQuotedPrefix(message.content);
    const displayAuthor = quoted?.senderName?.trim() || quoted?.senderId || '';
    const imageAttachments = (message.attachments ?? []).filter((a) => a.type === 'image');
    return (
      <div className="flex justify-end py-3">
        <div className="max-w-[75%] rounded-xl px-4 py-2.5 text-sm leading-relaxed bg-accent text-foreground rounded-br-sm">
          {quoted && (
            <div className="mb-2 border-l-2 border-muted-foreground pl-2 text-xs text-muted-foreground">
              <div className="font-medium truncate">
                回复 {displayAuthor || '消息'}
              </div>
              <div className="line-clamp-3 whitespace-pre-wrap break-words opacity-80">
                {quoted.content}
              </div>
            </div>
          )}
          {imageAttachments.length > 0 && (
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {imageAttachments.map((att, i) => {
                const src = att.base64
                  ? `data:${att.mimeType};base64,${att.base64}`
                  : att.path
                    ? `file://${att.path}`
                    : '';
                if (!src) return null;
                return (
                  <img
                    key={i}
                    src={src}
                    alt="用户发送的图片"
                    className="max-h-40 max-w-[200px] rounded border border-border object-cover"
                    onClick={() => window.open(src, '_blank')}
                  />
                );
              })}
            </div>
          )}
          {rest.trim() && (
            <div className="whitespace-pre-wrap break-words">{rest}</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="group border-t border-border first:border-t-0 py-4">
      {/* Sprint 15.12 Phase E — Show Your Work 折叠条 */}
      {message.recallMeta && <RecallMetaBar meta={message.recallMeta} />}
      {isEmpty ? (
        <div className="flex items-center gap-2 text-muted-foreground text-xs py-1">
          <span className="flex gap-0.5">
            <span className="w-1.5 h-1.5 bg-brand rounded-full animate-pulse" />
            <span className="w-1.5 h-1.5 bg-brand rounded-full animate-pulse [animation-delay:150ms]" />
            <span className="w-1.5 h-1.5 bg-brand rounded-full animate-pulse [animation-delay:300ms]" />
          </span>
          {t('chat.thinking')}...
        </div>
      ) : hasSegments ? (
        /* 新渲染：segments 交错显示 */
        <>
          {message.segments!.map((seg, i) =>
            seg.type === 'text' ? (
              seg.content.trim() ? (
                <div key={i} className={MARKDOWN_CLASSES}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{seg.content}</ReactMarkdown>
                </div>
              ) : null
            ) : seg.type === 'thinking' ? (
              <ThinkingBlock
                key={i}
                content={seg.content}
                isExpanded={seg.isExpanded}
                onToggle={() => toggleThinkingExpanded(message.id)}
                isStreaming={isStreaming}
              />
            ) : (
              <ToolCallCard key={i} seg={seg} />
            )
          )}
          {hasContent && <MessageActions content={message.content} />}
        </>
      ) : (
        /* 旧渲染：向后兼容无 segments 的历史消息 */
        <>
          {hasTools && (
            <ToolCallList toolCalls={message.toolCalls!} hasContent={hasContent} />
          )}
          {hasContent && (
            <div className={MARKDOWN_CLASSES}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          )}
          {hasContent && <MessageActions content={message.content} />}
        </>
      )}
    </div>
  );
}
