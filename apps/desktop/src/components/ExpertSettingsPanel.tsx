/**
 * ExpertSettingsPanel — 右侧滑出专家设置面板
 * 包含三个标签页：连接、技能、设置
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useAgentStore } from '../stores/agent-store';
import { get, post } from '../lib/api';
import AgentAvatar from './AgentAvatar';

/** 面板标签页 */
type TabId = 'channels' | 'skills' | 'settings';

interface ExpertSettingsPanelProps {
  agentId: string;
  isOpen: boolean;
  onClose: () => void;
}

/** Channel 连接状态 */
interface ChannelStatus {
  type: string;
  name: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error?: string;
}

/** 可连接平台定义 */
const PLATFORMS = [
  { type: 'feishu', name: '飞书', logo: '/logo-feishu.png' },
  { type: 'wecom', name: '企业微信', logo: '/logo-wecom.png' },
  { type: 'weixin', name: '微信', logo: '/logo-weixin.png' },
  { type: 'dingtalk', name: '钉钉', logo: '/logo-dingtalk.png' },
  { type: 'qq', name: 'QQ', logo: '/logo-qq.png' },
];

/** 工作区文件元数据 */
const FILE_LABELS: Record<string, { icon: string; label: string; desc: string; editable: boolean }> = {
  'SOUL.md': { icon: '💎', label: '行为哲学', desc: '核心真理 + 角色人格', editable: true },
  'IDENTITY.md': { icon: '🪪', label: '身份配置', desc: '名称、气质、标志', editable: true },
  'AGENTS.md': { icon: '📋', label: '操作规程', desc: '通用准则 + 工作规范', editable: true },
  'BOOTSTRAP.md': { icon: '🌅', label: '首次对话引导', desc: '专家的"出生仪式"', editable: true },
  'TOOLS.md': { icon: '🔧', label: '环境笔记', desc: '环境特有的备忘信息', editable: true },
  'HEARTBEAT.md': { icon: '💓', label: '定时检查', desc: '周期性自动检查清单', editable: true },
  'USER.md': { icon: '👤', label: '用户画像', desc: '运行时动态渲染', editable: false },
  'MEMORY.md': { icon: '🧠', label: '长期记忆', desc: '运行时动态渲染', editable: false },
};

const FILE_ORDER = ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'BOOTSTRAP.md', 'TOOLS.md', 'HEARTBEAT.md', 'USER.md', 'MEMORY.md'];

const TABS: { id: TabId; label: string }[] = [
  { id: 'channels', label: '连接' },
  { id: 'skills', label: '技能' },
  { id: 'settings', label: '设置' },
];

// ─── 连接标签页 ───

function ChannelsTab({ agentId }: { agentId: string }) {
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchChannels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await get<{ channels: ChannelStatus[] }>('/channel/status');
      setChannels(res.channels);
    } catch {
      // 容错
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  const connectedCount = channels.filter((ch) => ch.status === 'connected').length;

  const getChannelStatus = (type: string) => channels.find((ch) => ch.type === type);

  const handleDisconnect = useCallback(async (type: string) => {
    await post('/channel/disconnect', { type });
    fetchChannels();
  }, [fetchChannels]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="w-5 h-5 border-2 border-slate-300 border-t-brand rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-slate-500">
          通过连接以下渠道，可以与当前专家直接建立通信。
        </p>
        <p className="text-xs text-slate-400 mt-1">已连接: {connectedCount}</p>
      </div>

      <div className="space-y-2">
        {PLATFORMS.map((p) => {
          const status = getChannelStatus(p.type);
          const isConnected = status?.status === 'connected';

          return (
            <div
              key={p.type}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-colors ${
                isConnected
                  ? 'border-green-200 bg-green-50/50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <img src={p.logo} alt={p.name} className="w-8 h-8 object-contain shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800">{p.name}</p>
                {isConnected && (
                  <p className="text-xs text-green-600">已连接</p>
                )}
              </div>
              {isConnected ? (
                <button
                  onClick={() => handleDisconnect(p.type)}
                  className="px-3 py-1.5 text-xs font-medium text-red-500 border border-red-200
                    rounded-lg hover:bg-red-50 transition-colors"
                >
                  断开
                </button>
              ) : (
                <button
                  className="px-3 py-1.5 text-xs font-medium text-brand border border-brand/30
                    rounded-lg hover:bg-brand/5 transition-colors"
                >
                  连接
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 技能标签页 ───

function SkillsTab({ agentId }: { agentId: string }) {
  // 技能列表（暂时为空态）
  const [skills] = useState<{ name: string; description: string }[]>([]);

  return (
    <div className="space-y-4">
      {skills.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-12 h-12 rounded-2xl bg-slate-100 flex items-center justify-center mb-3">
            <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
            </svg>
          </div>
          <p className="text-sm text-slate-500 mb-1">暂无已安装技能</p>
          <p className="text-xs text-slate-400 mb-4">技能可以扩展专家的能力</p>
          <button className="px-4 py-2 text-sm font-medium text-brand border border-brand/30
            rounded-lg hover:bg-brand/5 transition-colors">
            去技能商店
          </button>
        </div>
      ) : (
        <div className="space-y-2">
          {skills.map((skill) => (
            <div key={skill.name} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-slate-800">{skill.name}</p>
                <p className="text-xs text-slate-400 mt-0.5">{skill.description}</p>
              </div>
              <button className="px-3 py-1.5 text-xs font-medium text-red-500 border border-red-200
                rounded-lg hover:bg-red-50 transition-colors">
                卸载
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── 设置标签页 ───

function SettingsTab({ agentId }: { agentId: string }) {
  const { agents, updateAgent, fetchWorkspaceFiles } = useAgentStore();
  const agent = agents.find((a) => a.id === agentId);

  const [editName, setEditName] = useState(agent?.name ?? '');
  const [editEmoji, setEditEmoji] = useState(agent?.emoji ?? '');
  const [saving, setSaving] = useState(false);
  const [savedHint, setSavedHint] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, string>>({});
  const [filesLoading, setFilesLoading] = useState(true);
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  // 同步 agent 变更
  useEffect(() => {
    if (agent) {
      setEditName(agent.name);
      setEditEmoji(agent.emoji);
    }
  }, [agent]);

  // 加载工作区文件
  useEffect(() => {
    setFilesLoading(true);
    fetchWorkspaceFiles(agentId)
      .then((ws) => setFiles(ws))
      .catch(() => {})
      .finally(() => setFilesLoading(false));
  }, [agentId, fetchWorkspaceFiles]);

  const showSaved = useCallback((label: string) => {
    setSavedHint(label);
    setTimeout(() => setSavedHint(null), 2000);
  }, []);

  const handleSaveBasic = useCallback(async () => {
    setSaving(true);
    try {
      await updateAgent(agentId, { name: editName, emoji: editEmoji });
      showSaved('已保存');
    } catch (err) {
      console.error('保存失败:', err);
    }
    setSaving(false);
  }, [agentId, editName, editEmoji, updateAgent, showSaved]);

  const hasChanges = agent && (editName !== agent.name || editEmoji !== agent.emoji);

  return (
    <div className="space-y-6">
      {/* 基本信息 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">基本信息</h4>
          {savedHint && (
            <span className="text-xs text-green-500 animate-pulse">{savedHint}</span>
          )}
        </div>

        <div className="flex gap-3">
          <div className="w-20">
            <label className="block text-xs font-medium text-slate-500 mb-1">Emoji</label>
            <input
              value={editEmoji}
              onChange={(e) => setEditEmoji(e.target.value)}
              className="w-full px-2 py-2 text-xl text-center border border-slate-200 rounded-lg
                bg-white focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
              maxLength={4}
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-slate-500 mb-1">名称</label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
                bg-white text-slate-900
                focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
            />
          </div>
        </div>

        {hasChanges && (
          <button
            onClick={handleSaveBasic}
            disabled={saving}
            className="w-full px-4 py-2 text-sm font-medium text-white bg-brand
              rounded-lg hover:bg-brand-hover transition-colors disabled:opacity-50"
          >
            {saving ? '保存中...' : '保存修改'}
          </button>
        )}
      </div>

      {/* 工作区文件 */}
      <div className="space-y-3">
        <div>
          <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">工作区文件</h4>
          <p className="text-xs text-slate-400 mt-1">定义专家的人格、行为和能力</p>
        </div>

        {filesLoading ? (
          <div className="flex items-center justify-center py-6">
            <span className="w-4 h-4 border-2 border-slate-300 border-t-brand rounded-full animate-spin" />
          </div>
        ) : (
          <div className="space-y-1.5">
            {FILE_ORDER.map((filename) => {
              const content = files[filename];
              if (content === undefined) return null;
              const meta = FILE_LABELS[filename] ?? { icon: '📄', label: filename, desc: '', editable: false };
              const isExpanded = expandedFile === filename;
              const hasContent = content.trim().length > 0;

              return (
                <button
                  key={filename}
                  onClick={() => setExpandedFile(isExpanded ? null : filename)}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-xl
                    bg-slate-50 hover:bg-slate-100 transition-colors"
                >
                  <span className="text-sm">{meta.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-slate-700">{meta.label}</span>
                      {!meta.editable && (
                        <span className="text-[10px] text-slate-400 bg-slate-200/60 px-1.5 py-0.5 rounded-full">
                          运行时
                        </span>
                      )}
                    </div>
                    {isExpanded && hasContent ? (
                      <p className="text-xs text-slate-400 mt-1 whitespace-pre-wrap line-clamp-4 font-mono">
                        {content.slice(0, 200)}
                      </p>
                    ) : (
                      <p className="text-xs text-slate-400 mt-0.5">{meta.desc}</p>
                    )}
                  </div>
                  <span className={`text-slate-400 text-xs transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}>
                    ▶
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── 主面板 ───

export default function ExpertSettingsPanel({ agentId, isOpen, onClose }: ExpertSettingsPanelProps) {
  const { agents } = useAgentStore();
  const agent = agents.find((a) => a.id === agentId);
  const [activeTab, setActiveTab] = useState<TabId>('channels');
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    if (!showMenu) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showMenu]);

  // ESC 关闭面板
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // 面板关闭时重置
  useEffect(() => {
    if (!isOpen) {
      setShowMenu(false);
    }
  }, [isOpen]);

  if (!agent) return null;

  return (
    <>
      {/* 遮罩层 */}
      <div
        className={`fixed inset-0 z-50 transition-opacity duration-300 ${
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* 背景遮罩 — 点击关闭 */}
        <div
          className="absolute inset-0 bg-black/20"
          onClick={onClose}
        />

        {/* 滑出面板 */}
        <div
          ref={panelRef}
          className={`absolute top-0 right-0 w-[480px] h-full bg-white shadow-xl
            flex flex-col transition-transform duration-300 ease-out ${
            isOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          {/* Header */}
          <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-slate-200">
            <div className="flex items-center gap-2">
              <svg className="w-5 h-5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <h2 className="text-base font-bold text-slate-800">专家设置</h2>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Agent 信息 */}
          <div className="shrink-0 px-5 py-4 border-b border-slate-100">
            <div className="flex items-center gap-3">
              <AgentAvatar name={agent.name} size="lg" />
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-slate-800 truncate">{agent.name}</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  {agent.status === 'active' ? '活跃' : agent.status === 'draft' ? '草稿' : agent.status}
                </p>
              </div>
              {/* 更多菜单 */}
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400"
                >
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
                    <circle cx="12" cy="5" r="1.5" />
                    <circle cx="12" cy="12" r="1.5" />
                    <circle cx="12" cy="19" r="1.5" />
                  </svg>
                </button>
                {showMenu && (
                  <div className="absolute right-0 top-full mt-1 w-36 bg-white
                    border border-slate-200 rounded-xl shadow-lg z-10 py-1 overflow-hidden"
                  >
                    <button
                      onClick={() => { setShowMenu(false); setActiveTab('settings'); }}
                      className="w-full text-left px-4 py-2 text-sm text-slate-700
                        hover:bg-slate-50 transition-colors"
                    >
                      编辑专家
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Tab 栏 */}
          <div className="shrink-0 flex border-b border-slate-200 px-5">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 text-sm font-medium transition-colors relative ${
                  activeTab === tab.id
                    ? 'text-brand'
                    : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {tab.label}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-brand rounded-full" />
                )}
              </button>
            ))}
          </div>

          {/* Tab 内容 */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {activeTab === 'channels' && <ChannelsTab agentId={agentId} />}
            {activeTab === 'skills' && <SkillsTab agentId={agentId} />}
            {activeTab === 'settings' && <SettingsTab agentId={agentId} />}
          </div>
        </div>
      </div>
    </>
  );
}
