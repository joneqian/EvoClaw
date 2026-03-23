import { useState, useCallback, useEffect, useRef } from 'react';
import { useAgentStore, type BuilderStage } from '../stores/agent-store';

/** 每个阶段的快捷建议 */
const STAGE_SUGGESTIONS: Partial<Record<BuilderStage, string[]>> = {
  role: ['资深程序员', '英语老师', '数据分析师', '创意写手', '产品经理', '日语学习伙伴'],
  expertise: ['编程与软件开发', '英语口语与写作', '数据可视化与统计', '文案创作与营销', '项目管理', '日语 N1 考试辅导'],
  style: ['专业严谨', '轻松幽默', '简洁高效', '耐心教学', '苏格拉底式引导', '温暖鼓励'],
  constraints: ['不要使用英文术语', '回答控制在 200 字以内', '必须附带参考来源', '无'],
};

/** 阶段进度指示器配置 */
const STAGE_STEPS: { key: BuilderStage; label: string }[] = [
  { key: 'role', label: '角色' },
  { key: 'expertise', label: '专长' },
  { key: 'style', label: '风格' },
  { key: 'constraints', label: '约束' },
  { key: 'preview', label: '预览' },
];

/** 工作区文件图标和标签 */
const FILE_LABELS: Record<string, { icon: string; label: string; desc: string; editable: boolean }> = {
  'SOUL.md': { icon: '💎', label: '行为哲学', desc: '核心真理 + 角色人格 — 专家的灵魂', editable: true },
  'IDENTITY.md': { icon: '🪪', label: '身份配置', desc: '名称、气质、标志 — 外在表现', editable: true },
  'AGENTS.md': { icon: '📋', label: '操作规程', desc: '通用准则 + 角色工作规范', editable: true },
  'BOOTSTRAP.md': { icon: '🌅', label: '首次对话引导', desc: '专家醒来后的"出生仪式"', editable: true },
  'TOOLS.md': { icon: '🔧', label: '环境笔记', desc: '你的环境特有的备忘信息', editable: true },
  'HEARTBEAT.md': { icon: '💓', label: '定时检查', desc: '周期性自动执行的检查清单', editable: true },
  'USER.md': { icon: '👤', label: '用户画像', desc: '运行时从记忆中动态渲染', editable: false },
  'MEMORY.md': { icon: '🧠', label: '长期记忆', desc: '运行时从记忆中动态渲染', editable: false },
};

interface AgentCreationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated?: (agentId: string) => void;
  /** 打开后自动发送的初始消息（如从模板创建） */
  initialMessage?: string;
}

export default function AgentCreationModal({ isOpen, onClose, onCreated, initialMessage }: AgentCreationModalProps) {
  const {
    builderMessages, builderStage, builderPreview, builderLoading, builderCreatedAgentId,
    startGuidedCreation, sendBuilderMessage, resetBuilder, updatePreviewFile,
  } = useAgentStore();

  const [inputValue, setInputValue] = useState('');
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const initialMessageSentRef = useRef(false);

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

  /** 发送消息 */
  const handleSend = useCallback(() => {
    const msg = inputValue.trim();
    if (!msg || builderLoading) return;
    setInputValue('');
    sendBuilderMessage(msg);
  }, [inputValue, builderLoading, sendBuilderMessage]);

  /** 点击建议标签 */
  const handleSuggestion = useCallback((text: string) => {
    if (builderLoading) return;
    setInputValue('');
    sendBuilderMessage(text);
  }, [builderLoading, sendBuilderMessage]);

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

  // 当前阶段的建议
  const suggestions = builderStage ? STAGE_SUGGESTIONS[builderStage] : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        className="w-[90vw] max-w-[900px] h-[80vh] bg-white rounded-xl shadow-xl
          overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 + 进度条 */}
        <div className="px-5 pt-4 pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-slate-700">创建新专家</h3>
            <button
              onClick={handleClose}
              className="text-slate-400 hover:text-slate-600 text-lg leading-none"
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
                        ? 'text-green-500'
                        : 'text-slate-400'
                  }`}>
                    <span className={`w-4 h-4 rounded-full flex items-center justify-center text-xs ${
                      isDone
                        ? 'bg-green-500 text-white'
                        : isActive
                          ? 'bg-brand text-white'
                          : 'bg-slate-200 text-slate-500'
                    }`}>
                      {isDone ? '✓' : i + 1}
                    </span>
                    <span className="hidden sm:inline">{step.label}</span>
                  </div>
                  {i < STAGE_STEPS.length - 1 && (
                    <div className={`flex-1 h-px ${isDone ? 'bg-green-300' : 'bg-slate-200'}`} />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* 对话区域 — flex 填充剩余高度 */}
        <div className="flex min-h-0 flex-1">
          {/* 左侧：对话 */}
          <div className={`flex-1 flex flex-col min-h-0 ${builderPreview ? 'border-r border-slate-100' : ''}`}>
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
                      : 'bg-slate-50 text-slate-700 rounded-bl-sm'
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
                  <div className="px-3 py-2 bg-slate-50 rounded-lg rounded-bl-sm">
                    {builderStage === 'constraints' ? (
                      <div className="flex items-center gap-2 text-sm text-slate-500">
                        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                        </svg>
                        <span>AI 正在为你的专家生成个性化工作区文件...</span>
                      </div>
                    ) : (
                      <span className="inline-flex gap-1">
                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
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
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleSuggestion(s)}
                      disabled={builderLoading}
                      className="px-2.5 py-1 text-xs bg-slate-50 text-slate-600
                        border border-slate-200 rounded-full
                        hover:bg-brand/5 hover:border-brand/30 hover:text-brand
                        disabled:opacity-50 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 输入区域 / 完成操作 */}
            <div className="p-3 border-t border-slate-100 shrink-0">
              {builderStage === 'preview' && !builderCreatedAgentId ? (
                <div className="flex gap-2">
                  <button
                    onClick={() => handleSuggestion('确认')}
                    disabled={builderLoading}
                    className="flex-1 px-4 py-2 text-sm font-medium text-white bg-brand
                      rounded-lg hover:bg-brand-hover transition-colors
                      disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {builderLoading ? '创建中...' : '确认创建'}
                  </button>
                  <button
                    onClick={() => handleSuggestion('重来')}
                    disabled={builderLoading}
                    className="px-4 py-2 text-sm text-slate-500
                      hover:text-slate-700
                      border border-slate-200 rounded-lg
                      disabled:opacity-50"
                  >
                    重新开始
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSend(); }}
                    placeholder="输入你的回答..."
                    disabled={builderLoading}
                    className="flex-1 px-3 py-2 text-sm border border-slate-200 rounded-lg
                      bg-white text-slate-900
                      focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand
                      disabled:opacity-50"
                    autoFocus
                  />
                  <button
                    onClick={handleSend}
                    disabled={!inputValue.trim() || builderLoading}
                    className="px-4 py-2 text-sm font-medium text-white bg-brand
                      rounded-lg hover:bg-brand-hover transition-colors
                      disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    发送
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* 右侧：工作区文件预览 + 编辑 */}
          {builderPreview && (
            <div className="w-80 lg:w-96 flex flex-col min-h-0 shrink-0">
              <div className="px-4 pt-4 pb-2 shrink-0">
                <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                  工作区文件预览
                </h4>
              </div>
              <div className="px-4 pb-4 overflow-y-auto flex-1 space-y-2">
                {Object.entries(builderPreview).map(([filename, content]) => {
                  const meta = FILE_LABELS[filename] || { icon: '📄', label: filename, desc: '', editable: false };
                  const isExpanded = expandedFile === filename;
                  const isEditing = editingFile === filename;
                  const hasContent = content.trim().length > 0;
                  const isRuntime = !meta.editable;
                  return (
                    <div key={filename} className={`border rounded-lg overflow-hidden transition-colors ${
                      isEditing
                        ? 'border-brand/50 ring-1 ring-brand/20'
                        : 'border-slate-100'
                    }`}>
                      <button
                        onClick={() => toggleFile(filename)}
                        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 transition-colors"
                      >
                        <span className="text-sm">{meta.icon}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-medium text-slate-700">{meta.label}</span>
                            <code className="text-xs px-1 py-0.5 bg-slate-100 text-slate-500 rounded font-mono">{filename}</code>
                          </div>
                          <div className="text-xs text-slate-400 truncate mt-0.5">{meta.desc}</div>
                        </div>
                        {isRuntime ? (
                          <span className="text-xs text-slate-400 italic shrink-0">运行时生成</span>
                        ) : hasContent ? (
                          <span className={`text-slate-400 text-xs transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}>
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
                                className="w-full text-xs text-slate-700 bg-white
                                  border border-slate-200 rounded p-2 font-mono leading-relaxed
                                  focus:outline-none focus:ring-1 focus:ring-brand/40 focus:border-brand
                                  resize-y"
                                style={{ minHeight: '120px', maxHeight: '300px' }}
                              />
                              <div className="flex justify-end mt-1">
                                <button
                                  onClick={() => setEditingFile(null)}
                                  className="text-xs text-brand hover:text-brand-hover"
                                >
                                  完成编辑
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div className="group relative">
                              <pre className="text-xs text-slate-600 bg-slate-50
                                rounded p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">
                                {content}
                              </pre>
                              <button
                                onClick={(e) => { e.stopPropagation(); setEditingFile(filename); }}
                                className="absolute top-1.5 right-1.5 px-1.5 py-0.5 text-xs text-slate-400
                                  bg-white border border-slate-200 rounded
                                  opacity-0 group-hover:opacity-100 hover:text-brand hover:border-brand/30
                                  transition-all"
                              >
                                编辑
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
