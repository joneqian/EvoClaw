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
  'SOUL.md': { icon: '💎', label: '行为哲学', desc: '核心真理 + 角色人格 — 专家的灵魂', editable: true },
  'IDENTITY.md': { icon: '🪪', label: '身份配置', desc: '名称、气质、标志 — 外在表现', editable: true },
  'AGENTS.md': { icon: '📋', label: '操作规程', desc: '通用准则 + 角色工作规范', editable: true },
  'BOOTSTRAP.md': { icon: '🌅', label: '首次对话引导', desc: '专家醒来后的"出生仪式"', editable: true },
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

  const [activeTab, setActiveTab] = useState<'store' | 'mine'>('store');

  // 专家商店：健康领域预设模板（后续可从 API 加载）
  const storeAgents = [
    { id: 'tpl-nutrition', name: '营养膳食专家', desc: '专业营养师，根据个人体质、健康目标和饮食偏好，定制科学膳食方案，提供营养搭配和食谱推荐。', avatar: '🥗' },
    { id: 'tpl-tcm', name: '中医养生顾问', desc: '传统中医理论与现代养生结合，提供体质辨识、经络调理、药膳食疗和四季养生方案指导。', avatar: '🌿' },
    { id: 'tpl-fitness', name: '运动健身教练', desc: '根据身体状况和健身目标，制定个性化训练计划，提供动作指导、运动损伤预防和体能评估。', avatar: '💪' },
    { id: 'tpl-mental', name: '心理健康顾问', desc: '心理咨询与情绪管理专家，提供压力疏导、睡眠改善、正念冥想指导和心理健康科普。', avatar: '🧠' },
    { id: 'tpl-chronic', name: '慢病管理助手', desc: '针对高血压、糖尿病等慢性病，提供日常监测指导、用药提醒、生活方式干预和健康数据分析。', avatar: '❤️‍🩹' },
    { id: 'tpl-maternal', name: '母婴健康顾问', desc: '覆盖备孕、孕期、产后到育儿全周期，提供科学的营养指导、发育评估和常见问题解答。', avatar: '👶' },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Tab 切换 */}
      <div className="px-6 pt-5 pb-0 shrink-0">
        <div className="inline-flex bg-slate-100 rounded-xl p-1">
          <button
            onClick={() => setActiveTab('store')}
            className={`px-5 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === 'store'
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            专家商店
          </button>
          <button
            onClick={() => setActiveTab('mine')}
            className={`px-5 py-2 text-sm font-medium rounded-lg transition-all ${
              activeTab === 'mine'
                ? 'bg-white text-slate-800 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            我的专家
          </button>
        </div>
        <p className="text-sm text-slate-500 mt-3 mb-4">
          {activeTab === 'store'
            ? '你的专属 AI 助理库。海量精选专家随心挑选，一键装配，即刻开工。'
            : '管理你创建和添加的专家。'}
        </p>
      </div>

      {/* ─── 专家商店 Tab ─── */}
      {activeTab === 'store' && (
        <div className="flex-1 overflow-y-auto px-6 pb-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {storeAgents.map((tpl) => (
              <div
                key={tpl.id}
                className="bg-white rounded-2xl border border-slate-200 p-5
                  hover:border-brand/30 hover:shadow-md transition-all duration-200 flex flex-col"
              >
                {/* 头像 */}
                <div className="flex justify-center mb-4">
                  <div className="w-20 h-20 rounded-full bg-gradient-to-br from-slate-100 to-slate-50
                    border-2 border-white shadow-sm flex items-center justify-center text-3xl">
                    {tpl.avatar}
                  </div>
                </div>
                {/* 名称 + 描述 */}
                <h4 className="text-base font-bold text-slate-800 text-center mb-2">{tpl.name}</h4>
                <p className="text-xs text-slate-400 leading-relaxed text-center flex-1 line-clamp-3">
                  {tpl.desc}
                </p>
                {/* 添加按钮 */}
                <button
                  onClick={() => {
                    // 用模板名称快速创建
                    setActiveTab('mine');
                    setShowBuilder(true);
                    startGuidedCreation();
                    setTimeout(() => sendBuilderMessage(tpl.name), 300);
                  }}
                  className="mt-4 w-full py-2.5 text-sm font-medium text-slate-600
                    bg-white border border-slate-200 rounded-xl
                    hover:border-brand/40 hover:text-brand hover:bg-brand/5
                    transition-all duration-150"
                >
                  + 添加
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ─── 我的专家 Tab ─── */}
      {activeTab === 'mine' && (
        <div className="flex-1 overflow-hidden flex flex-col px-6 pb-6">
          {/* 创建按钮 */}
          <div className="flex justify-end mb-4 shrink-0">
            <button
              onClick={handleStartCreate}
              className="px-4 py-2 bg-brand text-white text-sm font-medium rounded-lg
                hover:bg-brand-hover transition-colors"
            >
              + 创建专家
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
              <h3 className="text-sm font-semibold text-slate-700">创建新专家</h3>
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

      {/* 专家卡片网格 */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading ? (
          <div className="text-center py-16 text-slate-400">
            <span className="w-5 h-5 border-2 border-slate-300 border-t-brand rounded-full animate-spin inline-block" />
          </div>
        ) : agents.length === 0 && !showBuilder ? (
          <div className="flex-1 flex flex-col items-center justify-center py-16">
            <div className="w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center mb-5">
              <svg className="w-10 h-10 text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
              </svg>
            </div>
            <h3 className="text-base font-semibold text-slate-600 mb-2">还没有专家</h3>
            <p className="text-sm text-slate-400 mb-6 text-center leading-relaxed">
              从专家商店添加，或创建自定义专家
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setActiveTab('store')}
                className="px-5 py-2.5 bg-brand text-white text-sm font-medium rounded-xl
                  hover:bg-brand-hover shadow-sm transition-all"
              >
                去商店看看
              </button>
              <button
                onClick={handleStartCreate}
                className="px-5 py-2.5 text-sm font-medium text-slate-600
                  bg-white border border-slate-200 rounded-xl
                  hover:border-brand/40 hover:text-brand transition-all"
              >
                + 自定义创建
              </button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="bg-white rounded-2xl border border-slate-200 p-5
                  hover:border-brand/30 hover:shadow-md transition-all duration-200 flex flex-col"
              >
                {/* 头像 */}
                <div className="flex justify-center mb-4">
                  <div className="relative">
                    <AgentAvatar name={agent.name} size="xl" className="w-20 h-20 rounded-full text-2xl" />
                    <span className={`absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 border-white ${
                      agent.status === 'active' ? 'bg-green-400' : 'bg-slate-300'
                    }`} />
                  </div>
                </div>
                {/* 名称 */}
                <h4 className="text-base font-bold text-slate-800 text-center mb-1">{agent.name}</h4>
                <p className="text-[11px] text-slate-400 text-center mb-4">
                  创建于 {new Date(agent.createdAt).toLocaleDateString('zh-CN')}
                </p>
                {/* 操作按钮 — 与商店的 "+ 添加" 按钮风格一致 */}
                <div className="mt-auto flex gap-2">
                  <button
                    onClick={() => openAgent(agent.id)}
                    className="flex-1 py-2.5 text-sm font-medium text-slate-600
                      bg-white border border-slate-200 rounded-xl
                      hover:border-brand/40 hover:text-brand hover:bg-brand/5
                      transition-all duration-150"
                  >
                    打开
                  </button>
                  {deleteConfirmId === agent.id ? (
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleDelete(agent.id)}
                        className="px-3 py-2.5 text-sm font-medium text-red-500
                          border border-red-200 rounded-xl hover:bg-red-50 transition-colors"
                      >
                        确认
                      </button>
                      <button
                        onClick={() => setDeleteConfirmId(null)}
                        className="px-3 py-2.5 text-sm text-slate-400
                          border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setDeleteConfirmId(agent.id)}
                      className="px-3 py-2.5 text-slate-400
                        border border-slate-200 rounded-xl
                        hover:border-red-200 hover:text-red-500 hover:bg-red-50
                        transition-all duration-150"
                      title="删除"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
        </div>
      )}
    </div>
  );
}
