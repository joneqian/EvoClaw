import { useState, useCallback, useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAgentStore, type BuilderStage } from '../stores/agent-store';

/** role 阶段的默认快捷建议（后续阶段由后端动态生成） */
const DEFAULT_ROLE_SUGGESTIONS = ['资深程序员', '英语老师', '数据分析师', '创意写手', '产品经理', '日语学习伙伴'];

/**
 * 从后端返回的 message 中提取动态建议
 * 格式: "...比如：建议A、建议B、建议C..."
 */
function extractSuggestionsFromMessage(message: string): string[] | null {
  const match = message.match(/比如[：:]\s*(.+?)\.{2,}/);
  if (!match) return null;
  const items = match[1]!.split(/[、,，]/).map(s => s.trim()).filter(Boolean);
  return items.length > 0 ? items : null;
}

/** 阶段进度指示器配置 — 显示标签从 i18n 取 */
const STAGE_STEPS: { key: BuilderStage; labelKey: string }[] = [
  { key: 'role', labelKey: 'agentCreation.stage.role' },
  { key: 'expertise', labelKey: 'agentCreation.stage.expertise' },
  { key: 'style', labelKey: 'agentCreation.stage.style' },
  { key: 'constraints', labelKey: 'agentCreation.stage.constraints' },
  { key: 'preview', labelKey: 'agentCreation.stage.preview' },
];

/** 工作区文件图标和标签 key（label/desc 走 i18n） */
const FILE_META: Record<string, { icon: string; labelKey: string; editable: boolean }> = {
  'SOUL.md': { icon: '💎', labelKey: 'soul', editable: true },
  'IDENTITY.md': { icon: '🪪', labelKey: 'identity', editable: true },
  'AGENTS.md': { icon: '📋', labelKey: 'agents', editable: true },
  'BOOTSTRAP.md': { icon: '🌅', labelKey: 'bootstrap', editable: true },
  'TOOLS.md': { icon: '🔧', labelKey: 'tools', editable: true },
  'HEARTBEAT.md': { icon: '💓', labelKey: 'heartbeat', editable: true },
  'USER.md': { icon: '👤', labelKey: 'user', editable: false },
  'MEMORY.md': { icon: '🧠', labelKey: 'memory', editable: false },
};

interface AgentCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (agentId: string) => void;
  /** 打开后自动发送的初始消息（如从模板创建） */
  initialMessage?: string;
}

export default function AgentCreationModal({ isOpen, onClose, onCreated, initialMessage }: AgentCreationModalProps) {
  const { t } = useTranslation();
  const {
    builderMessages, builderStage, builderPreview, builderLoading, builderCreatedAgentId,
    startGuidedCreation, sendBuilderMessage, resetBuilder, updatePreviewFile,
  } = useAgentStore();

  const [inputValue, setInputValue] = useState('');
  const [selectedSuggestions, setSelectedSuggestions] = useState<Set<string>>(new Set());
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initialMessageSentRef = useRef(false);
  const prevStageRef = useRef<BuilderStage | null>(null);

  // 当 isOpen 变为 true 时，启动引导式创建
  useEffect(() => {
    if (isOpen) {
      resetBuilder();
      startGuidedCreation();
      initialMessageSentRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // 发送初始消息（如从模板创建时）
  useEffect(() => {
    if (isOpen && initialMessage && !initialMessageSentRef.current && builderStage && !builderLoading) {
      initialMessageSentRef.current = true;
      setTimeout(() => sendBuilderMessage(initialMessage), 300);
    }
  }, [isOpen, initialMessage, builderStage, builderLoading, sendBuilderMessage]);

  // 阶段变化时清空已选建议
  useEffect(() => {
    if (builderStage !== prevStageRef.current) {
      setSelectedSuggestions(new Set());
      prevStageRef.current = builderStage;
    }
  }, [builderStage]);

  // 自动滚动到最新消息
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [builderMessages]);

  // 创建完成后自动关闭弹窗并进入对话
  useEffect(() => {
    if (builderCreatedAgentId) {
      // 延迟一帧确保状态已更新
      const timer = setTimeout(() => {
        onCreated?.(builderCreatedAgentId);
        resetBuilder();
        onClose();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [builderCreatedAgentId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** 关闭并重置 */
  const handleClose = useCallback(() => {
    resetBuilder();
    setInputValue('');
    setExpandedFile(null);
    setEditingFile(null);
    onClose();
  }, [resetBuilder, onClose]);

  /** 是否为直接发送阶段（role 单选 / preview 确认/重来） */
  const isSingleSelectStage = builderStage === 'role' || builderStage === 'preview';

  /** 发送消息：合并已选建议 + 输入框内容 */
  const handleSend = useCallback(() => {
    const parts: string[] = [...selectedSuggestions];
    const extra = inputValue.trim();
    if (extra) parts.push(extra);
    if (parts.length === 0 || builderLoading) return;
    const msg = parts.join('、');
    setInputValue('');
    setSelectedSuggestions(new Set());
    sendBuilderMessage(msg);
  }, [inputValue, selectedSuggestions, builderLoading, sendBuilderMessage]);

  /** 点击建议标签：单选阶段直接发送，多选阶段 toggle 选中状态 */
  const handleSuggestion = useCallback((text: string) => {
    if (builderLoading) return;
    if (isSingleSelectStage) {
      // 单选阶段：直接发送
      setInputValue('');
      setSelectedSuggestions(new Set());
      sendBuilderMessage(text);
      return;
    }
    // 多选阶段：toggle 选中状态
    setSelectedSuggestions(prev => {
      const next = new Set(prev);
      if (next.has(text)) {
        next.delete(text);
      } else {
        next.add(text);
      }
      return next;
    });
  }, [builderLoading, isSingleSelectStage, sendBuilderMessage]);

  /** 切换文件展开/编辑 */
  const toggleFile = useCallback((filename: string) => {
    if (expandedFile === filename) {
      setExpandedFile(null);
      setEditingFile(null);
    } else {
      setExpandedFile(filename);
      setEditingFile(null);
    }
  }, [expandedFile]);

  if (!isOpen) return null;

  // 当前阶段的建议：role 用默认列表，其他阶段从后端 message 动态提取
  const lastSystemMessage = [...builderMessages].reverse().find(m => m.role === 'system');
  const dynamicSuggestions = lastSystemMessage ? extractSuggestionsFromMessage(lastSystemMessage.content) : null;
  const baseSuggestions = builderStage === 'role'
    ? DEFAULT_ROLE_SUGGESTIONS
    : builderStage === 'preview' || builderStage === 'done'
      ? undefined
      : dynamicSuggestions ?? undefined;
  // constraints 阶段末尾追加"无"选项
  const suggestions = baseSuggestions && builderStage === 'constraints'
    ? [...baseSuggestions, t('agentCreation.noneOption')]
    : baseSuggestions;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className="w-[90vw] max-w-[900px] h-[80vh] bg-card rounded-xl shadow-xl
          overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 + 进度条 */}
        <div className="px-5 pt-4 pb-3 border-b border-border shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-foreground">{t('agentCreation.title')}</h3>
            <button
              onClick={handleClose}
              className="text-muted-foreground hover:text-muted-foreground text-lg leading-none"
            >
              ×
            </button>
          </div>
          {/* 进度步骤 */}
          <div className="flex items-center gap-1">
            {STAGE_STEPS.map((step, i) => {
              const stageIdx = STAGE_STEPS.findIndex(s => s.key === builderStage);
              const isActive = step.key === builderStage;
              const isDone = stageIdx > i || builderStage === 'done';
              return (
                <div key={step.key} className="flex items-center gap-1 flex-1">
                  <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-brand/10 text-brand'
                      : isDone
                        ? 'text-success'
                        : 'text-muted-foreground'
                  }`}>
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-xs ${
                      isDone
                        ? 'bg-success text-white'
                        : isActive
                          ? 'bg-brand text-white'
                          : 'bg-accent text-muted-foreground'
                    }`}>
                      {isDone ? '✓' : i + 1}
                    </span>
                    <span className="hidden sm:inline">{t(step.labelKey)}</span>
                  </div>
                  {i < STAGE_STEPS.length - 1 && (
                    <div className={`flex-1 h-px ${isDone ? 'bg-success/50' : 'bg-accent'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 对话区域 — flex 填充剩余高度 */}
        <div className="flex min-h-0 flex-1">
          {/* 左侧：对话 */}
          <div className={`flex-1 flex flex-col min-h-0 ${builderPreview ? 'border-r border-border' : ''}`}>
            <div className="p-4 space-y-3 overflow-y-auto flex-1">
              {builderMessages.map((msg, i) => (
                <div key={i} className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                  {msg.role === 'system' && (
                    <div className="w-6 h-6 rounded-full bg-brand/10 flex items-center justify-center text-xs shrink-0 mt-0.5">
                      🤖
                    </div>
                  )}
                  <div className={`max-w-[85%] px-3 py-2 rounded-lg text-sm whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-brand text-white rounded-br-sm'
                      : 'bg-muted text-foreground rounded-bl-sm'
                  }`}>
                    {msg.content}
                  </div>
                </div>
              ))}
              {builderLoading && (
                <div className="flex gap-2">
                  <div className="w-6 h-6 rounded-full bg-brand/10 flex items-center justify-center text-xs shrink-0">
                    🤖
                  </div>
                  <div className="px-3 py-2 bg-muted rounded-lg rounded-bl-sm">
                    {builderStage === 'constraints' ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2} aria-hidden="true" />
                        <span>{t('agentCreation.generating')}</span>
                      </div>
                    ) : (
                      <span className="inline-flex gap-1">
                        <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-muted-foreground rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </span>
                    )}
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* 建议标签 */}
            {suggestions && !builderCreatedAgentId && (
              <div className="px-4 pb-2 shrink-0">
                <div className="flex flex-wrap gap-1.5">
                  {suggestions.map((s) => {
                    const isSelected = selectedSuggestions.has(s);
                    return (
                      <button
                        key={s}
                        onClick={() => handleSuggestion(s)}
                        disabled={builderLoading}
                        className={`px-2.5 py-1 text-xs rounded-full border transition-colors
                          disabled:opacity-50
                          ${isSelected
                            ? 'bg-brand/10 text-brand border-brand/40 font-medium'
                            : 'bg-muted text-muted-foreground border-border hover:bg-brand/5 hover:border-brand/30 hover:text-brand'
                          }`}
                      >
                        {isSelected ? `✓ ${s}` : s}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 输入区域 / 完成操作 */}
            <div className="p-3 border-t border-border shrink-0">
              {builderStage === 'preview' && !builderCreatedAgentId ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSuggestion(t('agentCreation.confirm'))}
                    disabled={builderLoading}
                    className="flex-1 px-4 py-2 text-sm font-medium text-white bg-brand
                      rounded-lg hover:bg-brand-hover transition-colors
                      disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {builderLoading ? t('agentCreation.creating') : t('agentCreation.confirmCreate')}
                  </button>
                  <button
                    onClick={() => handleSuggestion(t('agentCreation.regenerate'))}
                    disabled={builderLoading}
                    className="px-4 py-2 text-sm text-muted-foreground
                      hover:text-foreground
                      border border-border rounded-lg
                      disabled:opacity-50"
                  >
                    {t('agentCreation.restart')}
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && (inputValue.trim() || selectedSuggestions.size > 0)) handleSend(); }}
                    placeholder={t('agentCreation.placeholder')}
                    disabled={builderLoading}
                    className="flex-1 px-3 py-2 text-sm border border-border rounded-lg
                      bg-card text-foreground
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand
                      disabled:opacity-50"
                    autoFocus
                  />
                  <button
                    onClick={handleSend}
                    disabled={(!inputValue.trim() && selectedSuggestions.size === 0) || builderLoading}
                    className="px-4 py-2 text-sm font-medium text-white bg-brand
                      rounded-lg hover:bg-brand-hover transition-colors
                      disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {t('agentCreation.send')}
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 右侧：工作区文件预览 + 编辑 */}
          {builderPreview && (
            <div className="w-80 lg:w-96 flex flex-col min-h-0 shrink-0">
              <div className="px-4 pt-4 pb-2 shrink-0">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {t('agentCreation.workspacePreview')}
                </h4>
              </div>
              <div className="px-4 pb-4 overflow-y-auto flex-1 space-y-2">
                {Object.entries(builderPreview).map(([filename, content]) => {
                  const fileMeta = FILE_META[filename];
                  const meta = fileMeta
                    ? { icon: fileMeta.icon, label: t(`agentCreation.fileLabel.${fileMeta.labelKey}`), editable: fileMeta.editable }
                    : { icon: '📄', label: filename, editable: false };
                  const isExpanded = expandedFile === filename;
                  const isEditing = editingFile === filename;
                  const hasContent = content.trim().length > 0;
                  const isRuntime = !meta.editable;
                  return (
                    <div key={filename} className={`border rounded-lg overflow-hidden transition-colors ${
                      isEditing
                        ? 'border-brand/50 ring-1 ring-brand/20'
                        : 'border-border'
                    }`}>
                      <button
                        onClick={() => toggleFile(filename)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted transition-colors"
                      >
                        <span className="text-sm">{meta.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-foreground">{meta.label}</span>
                            <code className="text-xs px-1 py-0.5 bg-accent text-muted-foreground rounded font-mono">{filename}</code>
                          </div>
                        </div>
                        {isRuntime ? (
                          <span className="text-xs text-muted-foreground italic shrink-0">{t('agentCreation.runtimeGenerated')}</span>
                        ) : hasContent ? (
                          <span className={`text-muted-foreground text-xs transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}>
                            ▶
                          </span>
                        ) : null}
                      </button>
                      {isExpanded && hasContent && !isRuntime && (
                        <div className="px-3 pb-2">
                          {isEditing ? (
                            <div>
                              <textarea
                                value={content}
                                onChange={(e) => updatePreviewFile(filename, e.target.value)}
                                className="w-full text-xs text-foreground bg-card
                                  border border-border rounded p-2 font-mono leading-relaxed
                                  focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/40 focus-visible:border-brand
                                  resize-y"
                                style={{ minHeight: '120px', maxHeight: '300px' }}
                              />
                              <div className="flex justify-end mt-1">
                                <button
                                  onClick={() => setEditingFile(null)}
                                  className="text-xs text-brand hover:text-brand-hover"
                                >
                                  {t('agentCreation.finishEdit')}
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="group relative">
                              <pre className="text-xs text-muted-foreground bg-muted
                                rounded p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">
                                {content}
                              </pre>
                              <button
                                onClick={(e) => { e.stopPropagation(); setEditingFile(filename); }}
                                className="absolute top-1.5 right-1.5 px-1.5 py-0.5 text-xs text-muted-foreground
                                  bg-card border border-border rounded
                                  opacity-0 group-hover:opacity-100 hover:text-brand hover:border-brand/30
                                  transition-all"
                              >
                                {t('agentCreation.edit')}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
