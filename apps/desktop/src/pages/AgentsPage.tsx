import { useState, useCallback, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAgentStore } from '../stores/agent-store';
import AgentAvatar from '../components/AgentAvatar';
import AgentCreationModal from '../components/AgentCreationModal';
import { parseUtcDate } from '../lib/date';

export default function AgentsPage() {
  const {
    agents, loading, fetchAgents, deleteAgent,
    startGuidedCreation, sendBuilderMessage,
  } = useAgentStore();
  const navigate = useNavigate();
  const location = useLocation();

  const [showBuilder, setShowBuilder] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [initialMessage, setInitialMessage] = useState<string | undefined>(undefined);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  /** 开始创建 */
  const handleStartCreate = useCallback(() => {
    setInitialMessage(undefined);
    setShowBuilder(true);
  }, []);

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
  const handleGoChat = useCallback((agentId: string) => {
    setShowBuilder(false);
    navigate(`/agents/${agentId}`);
  }, [navigate]);

  const [activeTab, setActiveTab] = useState<'store' | 'mine'>('store');

  // 从 URL 参数自动切换 tab 并触发创建
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('tab') === 'mine') {
      setActiveTab('mine');
      if (params.get('create') === '1') {
        setInitialMessage(undefined);
        setShowBuilder(true);
      }
    }
  }, [location.search, startGuidedCreation]);

  // 专家商店：健康领域预设模板（后续可从 API 加载）
  const storeAgents = [
    { id: 'tpl-health-copy', name: '健康文案专家', desc: '擅长健康科普、患者教育、医疗营销等内容创作，将专业医学知识转化为通俗易懂的优质文案。', avatar: '✍️' },
    { id: 'tpl-sales', name: '销售咨询专家', desc: '深谙健康产品销售策略，精准分析客户需求，提供专业话术指导和转化优化建议。', avatar: '📈' },
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
        <div className="flex items-center gap-3 mt-3 mb-4">
          <p className="text-sm text-slate-500">
            {activeTab === 'store'
              ? '你的专属 AI 专家团。从营销、转化到服务交付，各类精选各类专家供你自由选择。'
              : '管理你创建和添加的专家。'}
          </p>
          {activeTab === 'mine' && (
            <button
              onClick={handleStartCreate}
              className="shrink-0 px-3.5 py-1.5 text-xs font-medium text-white
                bg-brand rounded-lg
                hover:bg-brand-hover transition-all"
            >
              + 创建专家
            </button>
          )}
        </div>
      </div>

      {/* --- 专家商店 Tab --- */}
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
                    setActiveTab('mine');
                    setInitialMessage(tpl.name);
                    setShowBuilder(true);
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

      {/* --- 我的专家 Tab --- */}
      {activeTab === 'mine' && (
        <div className="flex-1 overflow-hidden flex flex-col px-6 pb-6">
          <div className="flex-1 overflow-y-auto min-h-0">
            {loading ? (
              <div className="text-center py-16 text-slate-400">
                <span className="w-5 h-5 border-2 border-slate-300 border-t-brand rounded-full animate-spin inline-block" />
              </div>
            ) : agents.length === 0 ? (
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
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {agents.map((agent) => (
                  <div
                    key={agent.id}
                    className="bg-white rounded-xl border border-slate-200 p-4
                      hover:border-brand/30 hover:shadow-sm transition-all duration-200
                      flex flex-col items-center h-[180px] relative"
                  >
                    {/* 删除按钮 — 右上角 */}
                    {deleteConfirmId === agent.id ? (
                      <div className="absolute top-1.5 right-1.5 flex gap-1">
                        <button onClick={() => handleDelete(agent.id)}
                          className="px-2 py-0.5 text-xs font-medium text-red-500 bg-red-50 rounded">确认</button>
                        <button onClick={() => setDeleteConfirmId(null)}
                          className="px-2 py-0.5 text-xs text-slate-400 bg-slate-50 rounded">取消</button>
                      </div>
                    ) : (
                      <button onClick={() => setDeleteConfirmId(agent.id)}
                        className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center rounded
                          text-red-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                        title="删除">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                      </button>
                    )}

                    {/* 头像 */}
                    <div className="relative mt-2 mb-2">
                      <AgentAvatar name={agent.name} size="lg" className="w-12 h-12 rounded-full text-lg" />
                      <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                        agent.status === 'active' ? 'bg-green-400' : 'bg-slate-300'
                      }`} />
                    </div>
                    {/* 名称 */}
                    <h4 className="text-sm font-bold text-slate-800 text-center truncate w-full">{agent.name}</h4>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {parseUtcDate(agent.createdAt).toLocaleDateString('zh-CN')}
                    </p>
                    {/* 操作 */}
                    <div className="mt-auto flex gap-2 w-full">
                      <button onClick={() => openAgent(agent.id)}
                        className="flex-1 py-1.5 text-xs font-medium text-brand bg-brand/5 border border-brand/20 rounded-lg
                          hover:bg-brand/10 hover:border-brand/40 transition-all">
                        对话
                      </button>
                      <button onClick={() => navigate(`/agents/${agent.id}/edit`)}
                        className="flex-1 py-1.5 text-xs text-slate-500 border border-slate-200 rounded-lg
                          hover:text-brand hover:border-brand/30 transition-colors">
                        编辑
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 创建专家弹窗 */}
      <AgentCreationModal
        isOpen={showBuilder}
        onClose={() => setShowBuilder(false)}
        onCreated={handleGoChat}
        initialMessage={initialMessage}
      />
    </div>
  );
}
