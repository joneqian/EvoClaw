import { useState, useCallback, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAgentStore, type BuilderStage } from '../stores/agent-store';
import AgentAvatar from '../components/AgentAvatar';

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
  'SOUL.md': { icon: '💎', label: '行为哲学', desc: '核心真理 + 角色人格 — Agent 的灵魂', editable: true },
  'IDENTITY.md': { icon: '🪪', label: '身份配置', desc: '名称、气质、标志 — 外在表现', editable: true },
  'AGENTS.md': { icon: '📋', label: '操作规程', desc: '通用准则 + 角色工作规范', editable: true },
  'BOOTSTRAP.md': { icon: '🌅', label: '首次对话引导', desc: 'Agent 醒来后的"出生仪式"', editable: true },
  'TOOLS.md': { icon: '🔧', label: '环境笔记', desc: '你的环境特有的备忘信息', editable: true },
  'HEARTBEAT.md': { icon: '💓', label: '定时检查', desc: '周期性自动执行的检查清单', editable: true },
  'USER.md': { icon: '👤', label: '用户画像', desc: '运行时从记忆中动态渲染', editable: false },
  'MEMORY.md': { icon: '🧠', label: '长期记忆', desc: '运行时从记忆中动态渲染', editable: false },
};

export default function AgentsPage() {
  const {
    agents, loading, fetchAgents, deleteAgent,
    builderMessages, builderStage, builderPreview, builderLoading, builderCreatedAgentId,
    startGuidedCreation, sendBuilderMessage, resetBuilder, updatePreviewFile,
  } = useAgentStore();
  const navigate = useNavigate();

  const [showBuilder, setShowBuilder] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [editingFile, setEditingFile] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);


  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  // 自动滚动到最新消息
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [builderMessages]);

  /** 开始创建 */
  const handleStartCreate = useCallback(() => {
    setShowBuilder(true);
    startGuidedCreation();
  }, [startGuidedCreation]);

  /** 关闭创建面板 */
  const handleCloseBuilder = useCallback(() => {
    setShowBuilder(false);
    resetBuilder();
    setInputValue('');
    setExpandedFile(null);
    setEditingFile(null);
  }, [resetBuilder]);

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

  /** 进入 Agent 主页 */
  const openAgent = useCallback((agentId: string) => {
    navigate(`/agents/${agentId}`);
  }, [navigate]);

  /** 删除 Agent */
  const handleDelete = useCallback(async (id: string) => {
    try { await deleteAgent(id); } catch (err) { console.error('删除 Agent 失败:', err); }
    setDeleteConfirmId(null);
  }, [deleteAgent]);

  /** 创建完成，跳转 Agent 主页 */
  const handleGoChat = useCallback(() => {
    if (builderCreatedAgentId) {
      handleCloseBuilder();
      navigate(`/agents/${builderCreatedAgentId}`);
    }
  }, [builderCreatedAgentId, handleCloseBuilder, navigate]);

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

  // 当前阶段的建议
  const suggestions = builderStage ? STAGE_SUGGESTIONS[builderStage] : undefined;

  return (
    <div className="h-full flex flex-col p-6">
      {/* 页头 */}
      <div className="flex items-center justify-between mb-6 shrink-0">
        <h2 className="text-xl font-bold text-slate-800">Agent 管理</h2>
        <button
          onClick={handleStartCreate}
          className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg
            hover:bg-brand-hover transition-colors"
        >
          + 创建 Agent
        </button>
      </div>

      {/* 引导式创建面板 */}
      {showBuilder && (
        <div className="mb-6 bg-white rounded-xl border border-slate-200
          shadow-sm overflow-hidden flex flex-col min-h-0"
          style={{ maxHeight: 'calc(100vh - 180px)' }}
        >
          {/* 头部 + 进度条 */}
          <div className="px-5 pt-4 pb-3 border-b border-slate-100 shrink-0">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700">创建新 Agent</h3>
              <button
                onClick={handleCloseBuilder}
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
                      <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] ${
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
                          <span>AI 正在为你的 Agent 生成个性化工作区文件...</span>
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
                {builderCreatedAgentId ? (
                  <div className="flex gap-2">
                    <button
                      onClick={handleGoChat}
                      className="flex-1 px-4 py-2 text-sm font-medium text-white bg-brand
                        rounded-lg hover:bg-brand-hover transition-colors"
                    >
                      开始对话
                    </button>
                    <button
                      onClick={handleCloseBuilder}
                      className="px-4 py-2 text-sm text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg"
                    >
                      返回列表
                    </button>
                  </div>
                ) : builderStage === 'preview' ? (
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
                              <code className="text-[10px] px-1 py-0.5 bg-slate-100 text-slate-500 rounded font-mono">{filename}</code>
                            </div>
                            <div className="text-[10px] text-slate-400 truncate mt-0.5">{meta.desc}</div>
                          </div>
                          {isRuntime ? (
                            <span className="text-[10px] text-slate-400 italic shrink-0">运行时生成</span>
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
                                  className="w-full text-[11px] text-slate-700 bg-white
                                    border border-slate-200 rounded p-2 font-mono leading-relaxed
                                    focus:outline-none focus:ring-1 focus:ring-brand/40 focus:border-brand
                                    resize-y"
                                  style={{ minHeight: '120px', maxHeight: '300px' }}
                                />
                                <div className="flex justify-end mt-1">
                                  <button
                                    onClick={() => setEditingFile(null)}
                                    className="text-[10px] text-brand hover:text-brand-hover"
                                  >
                                    完成编辑
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div className="group relative">
                                <pre className="text-[11px] text-slate-600 bg-slate-50
                                  rounded p-2 overflow-x-auto max-h-48 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed">
                                  {content}
                                </pre>
                                <button
                                  onClick={(e) => { e.stopPropagation(); setEditingFile(filename); }}
                                  className="absolute top-1.5 right-1.5 px-1.5 py-0.5 text-[10px] text-slate-400
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
      )}

      {/* Agent 卡片网格 — 滚动区域 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="text-center py-16 text-slate-400">
            <p className="text-sm">加载中...</p>
          </div>
        ) : agents.length === 0 && !showBuilder ? (
          <div className="text-center py-16">
            <img src="/brand-logo.png" alt="Logo" className="w-14 h-14 mx-auto mb-4 object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            <h3 className="text-lg font-semibold text-slate-700 mb-2">
              创建你的第一个 Agent
            </h3>
            <p className="text-sm text-slate-400 mb-4">
              通过对话引导，定制拥有独立人格、专长和记忆的 AI 伴侣
            </p>
            <button
              onClick={handleStartCreate}
              className="px-5 py-2.5 bg-brand text-white text-sm font-medium rounded-lg
                hover:bg-brand-hover transition-colors"
            >
              + 开始创建
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="bg-white rounded-xl border border-slate-200 p-4 hover:shadow-md transition-shadow"
              >
                {/* 卡片头部 */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <AgentAvatar name={agent.name} size="md" />
                    <div>
                      <h4 className="font-medium text-sm text-slate-800">{agent.name}</h4>
                      <p className="text-xs text-slate-400">
                        {new Date(agent.createdAt).toLocaleDateString('zh-CN')}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${
                      agent.status === 'active'
                        ? 'bg-green-50 text-green-600'
                        : agent.status === 'draft'
                          ? 'bg-yellow-50 text-yellow-600'
                          : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {agent.status === 'active' ? '活跃' : agent.status === 'draft' ? '草稿' : agent.status}
                  </span>
                </div>

                {/* 卡片操作 */}
                <div className="flex gap-2 pt-2 border-t border-slate-100">
                  <button
                    onClick={() => openAgent(agent.id)}
                    className="flex-1 text-xs py-1.5 text-brand hover:bg-brand/5 rounded-md transition-colors"
                  >
                    打开
                  </button>
                  <button
                    onClick={() => navigate(`/agents/${agent.id}/edit`)}
                    className="text-xs py-1.5 px-3 text-slate-500 hover:text-brand hover:bg-brand/5 rounded-md transition-colors"
                  >
                    编辑
                  </button>
                  {deleteConfirmId === agent.id ? (
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleDelete(agent.id)}
                        className="text-xs py-1.5 px-2 text-red-500 hover:bg-red-50 rounded-md transition-colors"
                      >
                        确认
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="text-xs py-1.5 px-2 text-slate-400 hover:bg-slate-50 rounded-md transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirmId(agent.id)}
                      className="text-xs py-1.5 px-3 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                    >
                      删除
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
