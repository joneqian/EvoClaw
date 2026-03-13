import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAgentStore, type Agent } from '../stores/agent-store';
import { useChatStore } from '../stores/chat-store';

/** 可选的 emoji 列表 */
const EMOJI_OPTIONS = ['🤖', '🧠', '🎯', '🦊', '🐱', '🌟', '💡', '🔮', '🎭', '📚', '🛡️', '⚡'];

/** 创建向导步骤 */
type WizardStep = 'name' | 'emoji' | 'confirm';

/** 生成简单 ID */
function uid(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export default function AgentsPage() {
  const { agents, addAgent, removeAgent } = useAgentStore();
  const { setCurrentAgent } = useChatStore();
  const navigate = useNavigate();

  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState<WizardStep>('name');
  const [newName, setNewName] = useState('');
  const [newEmoji, setNewEmoji] = useState('🤖');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  /** 重置向导 */
  const resetWizard = useCallback(() => {
    setShowWizard(false);
    setWizardStep('name');
    setNewName('');
    setNewEmoji('🤖');
  }, []);

  /** 完成创建 */
  const finishCreate = useCallback(() => {
    const agent: Agent = {
      id: uid(),
      name: newName.trim(),
      emoji: newEmoji,
      status: 'active',
      createdAt: new Date().toISOString(),
    };
    addAgent(agent);
    resetWizard();
  }, [newName, newEmoji, addAgent, resetWizard]);

  /** 开始对话 */
  const startChat = useCallback(
    (agentId: string) => {
      setCurrentAgent(agentId);
      navigate('/chat');
    },
    [setCurrentAgent, navigate],
  );

  /** 删除 Agent */
  const handleDelete = useCallback(
    (id: string) => {
      removeAgent(id);
      setDeleteConfirmId(null);
    },
    [removeAgent],
  );

  return (
    <div className="p-6 max-w-4xl">
      {/* 页头 */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-gray-800">Agent 管理</h2>
        <button
          onClick={() => setShowWizard(true)}
          className="px-4 py-2 bg-[#00d4aa] text-white text-sm font-medium rounded-lg
            hover:bg-[#00b894] transition-colors"
        >
          + 创建 Agent
        </button>
      </div>

      {/* 创建向导 */}
      {showWizard && (
        <div className="mb-6 bg-white rounded-xl border border-gray-200 p-5 shadow-sm">
          <h3 className="text-sm font-semibold text-gray-600 mb-4">创建新 Agent</h3>

          {/* 对话式向导 */}
          <div className="space-y-4">
            {/* 步骤 1: 名称 */}
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs shrink-0">
                🤖
              </div>
              <div className="flex-1">
                <p className="text-sm text-gray-600 mb-2">给你的 Agent 取一个名字吧：</p>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="例如：小助手、代码专家..."
                  className="w-full max-w-xs px-3 py-2 text-sm border border-gray-200 rounded-lg
                    focus:outline-none focus:ring-2 focus:ring-[#00d4aa]/40 focus:border-[#00d4aa]"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && newName.trim()) setWizardStep('emoji');
                  }}
                  autoFocus
                />
                {wizardStep === 'name' && newName.trim() && (
                  <button
                    onClick={() => setWizardStep('emoji')}
                    className="mt-2 text-sm text-[#00d4aa] hover:text-[#00b894]"
                  >
                    下一步 →
                  </button>
                )}
              </div>
            </div>

            {/* 步骤 2: Emoji */}
            {(wizardStep === 'emoji' || wizardStep === 'confirm') && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs shrink-0">
                  🤖
                </div>
                <div className="flex-1">
                  <p className="text-sm text-gray-600 mb-2">选择一个代表图标：</p>
                  <div className="flex flex-wrap gap-2">
                    {EMOJI_OPTIONS.map((e) => (
                      <button
                        key={e}
                        onClick={() => {
                          setNewEmoji(e);
                          setWizardStep('confirm');
                        }}
                        className={`w-9 h-9 rounded-lg text-lg flex items-center justify-center transition-colors ${
                          newEmoji === e
                            ? 'bg-[#00d4aa]/10 ring-2 ring-[#00d4aa]'
                            : 'bg-gray-50 hover:bg-gray-100'
                        }`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* 步骤 3: 确认 */}
            {wizardStep === 'confirm' && (
              <div className="flex gap-3">
                <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs shrink-0">
                  🤖
                </div>
                <div className="flex-1">
                  <p className="text-sm text-gray-600 mb-3">
                    确认创建 Agent「{newEmoji} {newName}」？
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={finishCreate}
                      className="px-4 py-1.5 text-sm font-medium text-white bg-[#00d4aa]
                        rounded-lg hover:bg-[#00b894] transition-colors"
                    >
                      确认创建
                    </button>
                    <button
                      onClick={resetWizard}
                      className="px-4 py-1.5 text-sm text-gray-500 hover:text-gray-700"
                    >
                      取消
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Agent 卡片网格 */}
      {agents.length === 0 && !showWizard ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-4xl mb-3">🤖</p>
          <p className="text-sm">暂无 Agent，点击上方按钮创建一个</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {agents.map((agent) => (
            <div
              key={agent.id}
              className="bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md transition-shadow"
            >
              {/* 卡片头部 */}
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{agent.emoji}</span>
                  <div>
                    <h4 className="font-medium text-sm text-gray-800">{agent.name}</h4>
                    <p className="text-xs text-gray-400">
                      {new Date(agent.createdAt).toLocaleDateString('zh-CN')}
                    </p>
                  </div>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    agent.status === 'active'
                      ? 'bg-green-50 text-green-600'
                      : 'bg-gray-100 text-gray-500'
                  }`}
                >
                  {agent.status === 'active' ? '活跃' : agent.status}
                </span>
              </div>

              {/* 卡片操作 */}
              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <button
                  onClick={() => startChat(agent.id)}
                  className="flex-1 text-xs py-1.5 text-[#00d4aa] hover:bg-[#00d4aa]/5 rounded-md transition-colors"
                >
                  开始对话
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
                      className="text-xs py-1.5 px-2 text-gray-400 hover:bg-gray-50 rounded-md transition-colors"
                    >
                      取消
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setDeleteConfirmId(agent.id)}
                    className="text-xs py-1.5 px-3 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
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
  );
}
