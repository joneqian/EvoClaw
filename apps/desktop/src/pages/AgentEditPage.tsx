import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAgentStore } from '../stores/agent-store';
import AgentAvatar from '../components/AgentAvatar';

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

/** 文件显示顺序 */
const FILE_ORDER = ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'BOOTSTRAP.md', 'TOOLS.md', 'HEARTBEAT.md', 'USER.md', 'MEMORY.md'];

export default function AgentEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { agents, fetchAgents, updateAgent, fetchWorkspaceFiles, updateWorkspaceFile } = useAgentStore();

  const [loading, setLoading] = useState(true);
  const [editName, setEditName] = useState('');
  const [editEmoji, setEditEmoji] = useState('');
  const [files, setFiles] = useState<Record<string, string>>({});
  const [expandedFile, setExpandedFile] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null); // null | 'basic' | filename
  const [savedHint, setSavedHint] = useState<string | null>(null);

  const agent = agents.find((a) => a.id === id);

  // 加载数据
  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      await fetchAgents();
      try {
        const ws = await fetchWorkspaceFiles(id);
        setFiles(ws);
      } catch (err) {
        console.error('加载工作区文件失败:', err);
      }
      setLoading(false);
    })();
  }, [id, fetchAgents, fetchWorkspaceFiles]);

  // agent 加载后同步 name/emoji
  useEffect(() => {
    if (agent) {
      setEditName(agent.name);
      setEditEmoji(agent.emoji);
    }
  }, [agent]);

  /** 保存后的短暂提示 */
  const showSaved = useCallback((label: string) => {
    setSavedHint(label);
    setTimeout(() => setSavedHint(null), 2000);
  }, []);

  /** 保存基本信息 */
  const handleSaveBasic = useCallback(async () => {
    if (!id) return;
    setSaving('basic');
    try {
      await updateAgent(id, { name: editName, emoji: editEmoji });
      showSaved('基本信息已保存');
    } catch (err) {
      console.error('保存失败:', err);
    }
    setSaving(null);
  }, [id, editName, editEmoji, updateAgent, showSaved]);

  /** 保存单个文件 */
  const handleSaveFile = useCallback(async (filename: string) => {
    if (!id) return;
    setSaving(filename);
    try {
      await updateWorkspaceFile(id, filename, files[filename] ?? '');
      showSaved(`${filename} 已保存`);
    } catch (err) {
      console.error('保存文件失败:', err);
    }
    setSaving(null);
  }, [id, files, updateWorkspaceFile, showSaved]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400">
        <p className="text-sm">加载中...</p>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-4xl mb-3">404</p>
          <p className="text-sm text-slate-400 mb-4">Agent 不存在</p>
          <button onClick={() => navigate('/agents')} className="text-sm text-brand">
            返回 Agent 管理
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 顶栏 */}
      <div className="shrink-0 flex items-center justify-between px-6 py-4 border-b border-slate-200">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/agents')}
            className="text-slate-400 hover:text-slate-600 text-sm"
          >
            ← 返回
          </button>
          <div className="w-px h-5 bg-slate-200" />
          <AgentAvatar name={agent.name} size="md" />
          <h2 className="text-lg font-bold text-slate-800">{agent.name}</h2>
          <span className={`text-xs px-2 py-0.5 rounded-full ${
            agent.status === 'active'
              ? 'bg-green-50 text-green-600'
              : 'bg-yellow-50 text-yellow-600'
          }`}>
            {agent.status === 'active' ? '活跃' : agent.status === 'draft' ? '草稿' : agent.status}
          </span>
        </div>
        {savedHint && (
          <span className="text-xs text-green-500 animate-pulse">{savedHint}</span>
        )}
      </div>

      {/* 主体 */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* 左侧：基本信息 */}
        <div className="w-72 shrink-0 border-r border-slate-200 p-5 space-y-5 overflow-y-auto">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
            基本信息
          </h3>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">Emoji</label>
            <input
              value={editEmoji}
              onChange={(e) => setEditEmoji(e.target.value)}
              className="w-full px-3 py-2.5 text-2xl text-center border border-slate-200 rounded-lg
                bg-white focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
              maxLength={4}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">名称</label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg
                bg-white text-slate-900
                focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand"
            />
          </div>

          <button
            onClick={handleSaveBasic}
            disabled={saving === 'basic'}
            className="w-full px-4 py-2 text-sm font-medium text-white bg-brand
              rounded-lg hover:bg-brand-hover transition-colors disabled:opacity-50"
          >
            {saving === 'basic' ? '保存中...' : '保存'}
          </button>

          <div className="pt-4 border-t border-slate-100">
            <p className="text-[10px] text-slate-400">
              创建于 {new Date(agent.createdAt).toLocaleString('zh-CN')}
            </p>
            <p className="text-[10px] text-slate-400 mt-1">
              ID: <code className="font-mono">{agent.id.slice(0, 8)}...</code>
            </p>
          </div>
        </div>

        {/* 右侧：工作区文件 */}
        <div className="flex-1 flex flex-col min-h-0">
          <div className="px-5 pt-5 pb-3 shrink-0">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
              工作区文件
            </h3>
            <p className="text-[10px] text-slate-400 mt-1">
              这些文件定义了 Agent 的人格、行为和能力。运行时 Agent 会自动进化部分文件。
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-5 pb-5 space-y-2">
            {FILE_ORDER.map((filename) => {
              const content = files[filename];
              if (content === undefined) return null;
              const meta = FILE_LABELS[filename] || { icon: '📄', label: filename, desc: '', editable: false };
              const isExpanded = expandedFile === filename;
              const isRuntime = !meta.editable;

              return (
                <div key={filename} className={`border rounded-lg overflow-hidden transition-colors ${
                  isExpanded && !isRuntime
                    ? 'border-brand/40 ring-1 ring-brand/15'
                    : 'border-slate-200'
                }`}>
                  {/* 文件头 */}
                  <button
                    onClick={() => setExpandedFile(isExpanded ? null : filename)}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-left
                      hover:bg-slate-50 transition-colors"
                  >
                    <span className="text-base">{meta.icon}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-slate-700">{meta.label}</span>
                        <code className="text-[10px] px-1 py-0.5 bg-slate-100 text-slate-500 rounded font-mono">
                          {filename}
                        </code>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{meta.desc}</div>
                    </div>
                    {isRuntime ? (
                      <span className="text-[10px] text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full shrink-0">
                        运行时生成
                      </span>
                    ) : (
                      <span className={`text-slate-400 text-xs transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}>
                        ▶
                      </span>
                    )}
                  </button>

                  {/* 展开内容 */}
                  {isExpanded && (
                    <div className="px-4 pb-3 border-t border-slate-100">
                      {isRuntime ? (
                        <pre className="mt-2 text-[11px] text-slate-500 bg-slate-50
                          rounded p-3 overflow-x-auto max-h-40 overflow-y-auto whitespace-pre-wrap font-mono leading-relaxed italic">
                          {content || '(空 — 运行时从记忆数据动态渲染)'}
                        </pre>
                      ) : (
                        <>
                          <textarea
                            value={content}
                            onChange={(e) => setFiles((prev) => ({ ...prev, [filename]: e.target.value }))}
                            className="mt-2 w-full text-xs text-slate-700 bg-white
                              border border-slate-200 rounded-lg p-3 font-mono leading-relaxed
                              focus:outline-none focus:ring-1 focus:ring-brand/40 focus:border-brand
                              resize-y"
                            style={{ minHeight: '160px', maxHeight: '400px' }}
                          />
                          <div className="flex justify-end mt-2">
                            <button
                              onClick={() => handleSaveFile(filename)}
                              disabled={saving === filename}
                              className="text-xs px-3 py-1.5 text-white bg-brand rounded-lg hover:bg-brand-hover
                                disabled:opacity-50 transition-colors"
                            >
                              {saving === filename ? '保存中...' : '保存'}
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
