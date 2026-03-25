/**
 * ExpertSettingsPanel — 右侧滑出专家设置面板
 * 包含三个标签页：连接、技能、设置
 */

/** 格式化完整时间 — yyyy-MM-dd HH:mm */
function formatDateTime(isoStr: string): string {
  const d = new Date(isoStr);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useAgentStore } from '../stores/agent-store';
import { get, post, put } from '../lib/api';
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

/** Channel 绑定信息 */
interface ChannelBinding {
  channelType: string;
  agentId: string;
  agentName?: string;
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

// ─── 微信 QR 扫码连接（内联） ───

function InlineWeixinConnect({ agentId, onConnect }: { agentId: string; onConnect: () => void }) {
  const [step, setStep] = useState<'idle' | 'loading' | 'scanning' | 'scanned' | 'error'>('idle');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [qrcode, setQrcode] = useState('');
  const [error, setError] = useState('');
  const [refreshCount, setRefreshCount] = useState(0);
  const pollingRef = useRef(false);

  const MAX_REFRESH = 3;

  const fetchQrCode = useCallback(async () => {
    setStep('loading');
    setError('');
    try {
      const data = await get<{ qrcode: string; qrcode_img_content: string }>('/channel/weixin/qrcode');
      // qrcode_img_content 是网页 URL，需要本地生成 QR 码图片
      const QRCode = await import('qrcode');
      const dataUrl = await QRCode.toDataURL(data.qrcode_img_content, { width: 300, margin: 2 });
      setQrDataUrl(dataUrl);
      setQrcode(data.qrcode);
      setStep('scanning');
      pollingRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取二维码失败');
      setStep('error');
    }
  }, []);

  useEffect(() => {
    if (step !== 'scanning' && step !== 'scanned') return;
    if (!qrcode) return;

    pollingRef.current = true;

    const poll = async () => {
      while (pollingRef.current) {
        try {
          const data = await get<{
            status: string;
            bot_token?: string;
            ilink_bot_id?: string;
            baseurl?: string;
          }>(`/channel/weixin/qrcode-status?qrcode=${encodeURIComponent(qrcode)}`);

          if (!pollingRef.current) break;

          switch (data.status) {
            case 'scaned':
              setStep('scanned');
              break;
            case 'confirmed': {
              pollingRef.current = false;
              if (data.bot_token) {
                try {
                  await invoke('credential_set', {
                    service: 'weixin',
                    account: 'bot_token',
                    value: data.bot_token,
                  });
                } catch {
                  // Keychain 存储失败时继续
                }
              }
              await post('/channel/connect', {
                type: 'weixin',
                name: '微信',
                credentials: {
                  botToken: data.bot_token ?? '',
                  ilinkBotId: data.ilink_bot_id ?? '',
                  baseUrl: data.baseurl ?? '',
                },
                agentId,
              });
              onConnect();
              return;
            }
            case 'expired': {
              if (refreshCount < MAX_REFRESH) {
                setRefreshCount(prev => prev + 1);
                pollingRef.current = false;
                await fetchQrCode();
                return;
              }
              pollingRef.current = false;
              setError('二维码多次过期，请重新开始');
              setStep('error');
              return;
            }
          }
        } catch {
          // 网络错误，继续重试
        }
        await new Promise(r => setTimeout(r, 2000));
      }
    };

    void poll();
    return () => { pollingRef.current = false; };
  }, [step, qrcode, refreshCount, fetchQrCode, onConnect, agentId]);

  useEffect(() => {
    fetchQrCode();
    return () => { pollingRef.current = false; };
  }, [fetchQrCode]);

  return (
    <div className="space-y-3 text-center p-3 bg-slate-50 rounded-xl">
      {step === 'loading' && (
        <p className="text-xs text-slate-400">正在获取二维码...</p>
      )}
      {(step === 'scanning' || step === 'scanned') && qrDataUrl && (
        <>
          <img
            src={qrDataUrl}
            alt="微信扫码登录"
            className="w-40 h-40 mx-auto rounded-xl border border-slate-200"
          />
          <p className="text-xs text-slate-500">
            {step === 'scanned' ? '已扫描，请在手机上确认...' : '请使用微信扫描二维码'}
          </p>
        </>
      )}
      {step === 'error' && (
        <>
          <p className="text-xs text-red-500">{error}</p>
          <button
            onClick={() => { setRefreshCount(0); fetchQrCode(); }}
            className="px-4 py-1.5 text-sm font-medium text-brand border border-brand/30 rounded-lg hover:bg-brand/5"
          >
            重新获取
          </button>
        </>
      )}
    </div>
  );
}

// ─── 飞书连接表单（内联） ───

function InlineFeishuConnect({ agentId, onConnect }: { agentId: string; onConnect: () => void }) {
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');

  const handleConnect = useCallback(async () => {
    if (!appId.trim() || !appSecret.trim()) return;
    setConnecting(true);
    setError('');
    try {
      await post('/channel/connect', {
        type: 'feishu',
        name: '飞书',
        credentials: { appId: appId.trim(), appSecret: appSecret.trim() },
        agentId,
      });
      onConnect();
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接失败');
    } finally {
      setConnecting(false);
    }
  }, [appId, appSecret, agentId, onConnect]);

  return (
    <div className="space-y-2 p-3 bg-slate-50 rounded-xl">
      <input
        type="text"
        value={appId}
        onChange={(e) => setAppId(e.target.value)}
        placeholder="App ID"
        className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand"
      />
      <input
        type="password"
        value={appSecret}
        onChange={(e) => setAppSecret(e.target.value)}
        placeholder="App Secret"
        className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand"
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <button
        onClick={handleConnect}
        disabled={connecting || !appId.trim() || !appSecret.trim()}
        className="px-4 py-1.5 text-sm font-medium text-white bg-brand rounded-lg hover:bg-brand-active disabled:opacity-50 transition-colors"
      >
        {connecting ? '连接中...' : '连接'}
      </button>
    </div>
  );
}

// ─── 企微连接表单（内联） ───

function InlineWecomConnect({ agentId, onConnect }: { agentId: string; onConnect: () => void }) {
  const [corpId, setCorpId] = useState('');
  const [wecomAgentId, setWecomAgentId] = useState('');
  const [secret, setSecret] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');

  const handleConnect = useCallback(async () => {
    if (!corpId.trim() || !secret.trim()) return;
    setConnecting(true);
    setError('');
    try {
      await post('/channel/connect', {
        type: 'wecom',
        name: '企业微信',
        credentials: { corpId: corpId.trim(), agentId: wecomAgentId.trim(), secret: secret.trim() },
        agentId,
      });
      onConnect();
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接失败');
    } finally {
      setConnecting(false);
    }
  }, [corpId, wecomAgentId, secret, agentId, onConnect]);

  return (
    <div className="space-y-2 p-3 bg-slate-50 rounded-xl">
      <input
        type="text"
        value={corpId}
        onChange={(e) => setCorpId(e.target.value)}
        placeholder="Corp ID"
        className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand"
      />
      <input
        type="text"
        value={wecomAgentId}
        onChange={(e) => setWecomAgentId(e.target.value)}
        placeholder="Agent ID"
        className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand"
      />
      <input
        type="password"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        placeholder="Secret"
        className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand"
      />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <button
        onClick={handleConnect}
        disabled={connecting || !corpId.trim() || !secret.trim()}
        className="px-4 py-1.5 text-sm font-medium text-white bg-brand rounded-lg hover:bg-brand-active disabled:opacity-50 transition-colors"
      >
        {connecting ? '连接中...' : '连接'}
      </button>
    </div>
  );
}

// ─── 连接标签页 ───

function ChannelsTab({ agentId }: { agentId: string }) {
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [bindings, setBindings] = useState<ChannelBinding[]>([]);
  const [loading, setLoading] = useState(true);
  const [connectingChannel, setConnectingChannel] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, bindingsRes] = await Promise.all([
        get<{ channels: ChannelStatus[] }>('/channel/status'),
        get<{ bindings: ChannelBinding[] }>('/channel/bindings').catch(() => ({ bindings: [] as ChannelBinding[] })),
      ]);
      setChannels(statusRes.channels);
      setBindings(bindingsRes.bindings);
    } catch {
      // 容错
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const connectedCount = channels.filter((ch) => ch.status === 'connected').length;

  const getChannelStatus = (type: string) => channels.find((ch) => ch.type === type);
  const getBinding = (type: string) => bindings.find((b) => b.channelType === type);

  const handleDisconnect = useCallback(async (type: string) => {
    await post('/channel/disconnect', { type });
    setConnectingChannel(null);
    fetchData();
  }, [fetchData]);

  const handleUnbind = useCallback(async (type: string) => {
    await post('/channel/disconnect', { type });
    setConnectingChannel(null);
    fetchData();
  }, [fetchData]);

  const handleConnectSuccess = useCallback(() => {
    setConnectingChannel(null);
    fetchData();
  }, [fetchData]);

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
          连接渠道并绑定到当前专家，实现跨平台通信。
        </p>
        <p className="text-xs text-slate-400 mt-1">已连接: {connectedCount}</p>
      </div>

      <div className="space-y-2">
        {PLATFORMS.map((p) => {
          const status = getChannelStatus(p.type);
          const binding = getBinding(p.type);
          const isConnected = status?.status === 'connected';
          const isBoundToMe = binding?.agentId === agentId;
          const isBoundToOther = isConnected && binding != null && binding.agentId !== agentId;
          const isShowingForm = connectingChannel === p.type;

          return (
            <div key={p.type} className="rounded-xl border transition-colors overflow-hidden">
              {/* 平台行 */}
              <div
                className={`flex items-center gap-3 px-4 py-3 ${
                  isBoundToMe
                    ? 'border-green-200 bg-green-50/50'
                    : isBoundToOther
                      ? 'border-orange-200 bg-orange-50/30'
                      : 'border-slate-200'
                }`}
              >
                <img src={p.logo} alt={p.name} className="w-8 h-8 object-contain shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-slate-800">{p.name}</p>
                    {isBoundToMe && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium bg-green-100 text-green-700 rounded-full">
                        已绑定到此专家
                      </span>
                    )}
                    {isBoundToOther && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium bg-orange-100 text-orange-700 rounded-full">
                        已绑定到 {binding.agentName ?? '其他专家'}
                      </span>
                    )}
                  </div>
                  {isConnected && !isBoundToMe && !isBoundToOther && (
                    <p className="text-xs text-green-600">已连接</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {isBoundToMe ? (
                    <button
                      onClick={() => handleUnbind(p.type)}
                      className="px-3 py-1.5 text-xs font-medium text-red-500 border border-red-200
                        rounded-lg hover:bg-red-50 transition-colors"
                    >
                      解绑
                    </button>
                  ) : isConnected && isBoundToOther ? (
                    <span className="text-xs text-slate-400">已占用</span>
                  ) : isConnected ? (
                    <button
                      onClick={() => handleDisconnect(p.type)}
                      className="px-3 py-1.5 text-xs font-medium text-red-500 border border-red-200
                        rounded-lg hover:bg-red-50 transition-colors"
                    >
                      断开
                    </button>
                  ) : (
                    <button
                      onClick={() => setConnectingChannel(isShowingForm ? null : p.type)}
                      className="px-3 py-1.5 text-xs font-medium text-brand border border-brand/30
                        rounded-lg hover:bg-brand/5 transition-colors"
                    >
                      {isShowingForm ? '取消' : '连接'}
                    </button>
                  )}
                </div>
              </div>

              {/* 内联连接表单 */}
              {isShowingForm && (
                <div className="px-4 pb-3">
                  {p.type === 'weixin' && (
                    <InlineWeixinConnect agentId={agentId} onConnect={handleConnectSuccess} />
                  )}
                  {p.type === 'feishu' && (
                    <InlineFeishuConnect agentId={agentId} onConnect={handleConnectSuccess} />
                  )}
                  {p.type === 'wecom' && (
                    <InlineWecomConnect agentId={agentId} onConnect={handleConnectSuccess} />
                  )}
                  {(p.type === 'dingtalk' || p.type === 'qq') && (
                    <div className="p-3 bg-slate-50 rounded-xl">
                      <p className="text-xs text-slate-400 text-center">即将支持，敬请期待</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── 技能标签页 ───

/** Agent 技能项（含启用状态） */
interface AgentSkillItem {
  name: string;
  slug?: string;
  description: string;
  enabled: boolean;
}

function SkillsTab({ agentId }: { agentId: string }) {
  const [skills, setSkills] = useState<AgentSkillItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);

  const fetchSkills = useCallback(async () => {
    setLoading(true);
    try {
      const res = await get<{ skills: AgentSkillItem[] }>(`/agents/${agentId}/skills`);
      setSkills(res.skills);
    } catch {
      // 容错
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchSkills();
  }, [fetchSkills]);

  const toggleSkill = useCallback(async (skillName: string, enabled: boolean) => {
    setToggling(skillName);
    try {
      await put(`/agents/${agentId}/skills/${encodeURIComponent(skillName)}`, { enabled });
      // 乐观更新本地状态
      setSkills(prev => prev.map(s => s.name === skillName ? { ...s, enabled } : s));
    } catch (err) {
      console.error('技能切换失败:', err);
    } finally {
      setToggling(null);
    }
  }, [agentId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="w-5 h-5 border-2 border-slate-300 border-t-brand rounded-full animate-spin" />
      </div>
    );
  }

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
        <>
          <p className="text-sm text-slate-500">
            管理当前专家可使用的技能，关闭后该专家将不会调用对应技能。
          </p>
          <div className="space-y-2">
            {skills.map((skill) => (
              <div key={skill.name} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200">
                <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800">{skill.name}</p>
                  {skill.description && (
                    <p className="text-xs text-slate-400 mt-0.5 truncate">{skill.description}</p>
                  )}
                </div>
                <button
                  onClick={() => toggleSkill(skill.name, !skill.enabled)}
                  disabled={toggling === skill.name}
                  className={`w-10 h-6 rounded-full transition-colors relative shrink-0 ${
                    skill.enabled ? 'bg-brand' : 'bg-slate-200'
                  } ${toggling === skill.name ? 'opacity-50' : ''}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    skill.enabled ? 'left-[18px]' : 'left-0.5'
                  }`} />
                </button>
              </div>
            ))}
          </div>
          <div className="pt-2">
            <button className="w-full px-4 py-2.5 text-sm font-medium text-brand border border-brand/30
              rounded-lg hover:bg-brand/5 transition-colors">
              去技能商店
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── 设置标签页 ───

function SettingsTab({ agentId }: { agentId: string }) {
  const { agents, updateAgent, fetchWorkspaceFiles, updateWorkspaceFile } = useAgentStore();
  const agent = agents.find((a) => a.id === agentId);

  const [editName, setEditName] = useState(agent?.name ?? '');
  const [editEmoji, setEditEmoji] = useState(agent?.emoji ?? '');
  const [saving, setSaving] = useState(false);
  const [savedHint, setSavedHint] = useState<string | null>(null);
  const [files, setFiles] = useState<Record<string, string>>({});
  const [mtimes, setMtimes] = useState<Record<string, string>>({});
  const [filesLoading, setFilesLoading] = useState(true);
  // Modal 编辑器状态
  const [modalFile, setModalFile] = useState<string | null>(null);
  const [modalContent, setModalContent] = useState('');
  const [modalSaving, setModalSaving] = useState(false);

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
      .then((ws) => { setFiles(ws.files); setMtimes(ws.mtimes); })
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

  const openFileModal = useCallback((filename: string) => {
    setModalFile(filename);
    setModalContent(files[filename] ?? '');
  }, [files]);

  const handleModalSave = useCallback(async () => {
    if (!modalFile) return;
    setModalSaving(true);
    try {
      await updateWorkspaceFile(agentId, modalFile, modalContent);
      setFiles((prev) => ({ ...prev, [modalFile]: modalContent }));
      showSaved(`${FILE_LABELS[modalFile]?.label ?? modalFile} 已保存`);
      setModalFile(null);
    } catch (err) {
      console.error(`保存 ${modalFile} 失败:`, err);
    }
    setModalSaving(false);
  }, [agentId, modalFile, modalContent, updateWorkspaceFile, showSaved]);

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
              const charCount = content.trim().length;

              return (
                <button
                  key={filename}
                  onClick={() => openFileModal(filename)}
                  className="w-full text-left flex items-center gap-2.5 px-3 py-2.5 rounded-xl
                    bg-slate-50 hover:bg-slate-100 transition-colors group"
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
                    <p className="text-xs text-slate-400 mt-0.5 truncate">
                      {charCount > 0 ? `${meta.desc} · ${charCount} 字` : meta.desc}
                      {mtimes[filename] && <span className="ml-1.5 text-slate-300">· {formatDateTime(mtimes[filename])}</span>}
                    </p>
                  </div>
                  {/* 编辑/查看图标 */}
                  <span className="text-slate-300 group-hover:text-slate-500 transition-colors shrink-0">
                    {meta.editable ? (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Z" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 0 1 0-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178Z" />
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                      </svg>
                    )}
                  </span>
                </button>
              );
            })}
          </div>

        )}
      </div>

      {/* 文件编辑弹窗 — 独立于 filesLoading 条件 */}
      {modalFile && (() => {
        const meta = FILE_LABELS[modalFile] ?? { icon: '📄', label: modalFile, desc: '', editable: false };
        const isDirty = modalContent !== (files[modalFile] ?? '');
        return (
          <div className="fixed inset-0 z-[100] flex items-center justify-center">
            {/* 遮罩 */}
            <div className="absolute inset-0 bg-black/40" onClick={() => !modalSaving && setModalFile(null)} />
            {/* 弹窗 */}
            <div className="relative w-[90vw] max-w-3xl h-[80vh] bg-white rounded-2xl shadow-2xl flex flex-col">
              {/* 头部 */}
              <div className="shrink-0 flex items-center justify-between px-5 py-3.5 border-b border-slate-200">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{meta.icon}</span>
                  <h3 className="text-sm font-bold text-slate-800">{meta.label}</h3>
                  <span className="text-xs text-slate-400">{modalFile}</span>
                  {!meta.editable && (
                    <span className="text-[10px] text-slate-400 bg-slate-200/60 px-1.5 py-0.5 rounded-full">只读</span>
                  )}
                  {mtimes[modalFile] && (
                    <span className="text-[10px] text-slate-400">修改于 {formatDateTime(mtimes[modalFile])}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {meta.editable && (
                    <button
                      onClick={handleModalSave}
                      disabled={modalSaving || !isDirty}
                      className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors disabled:opacity-40 ${
                        isDirty
                          ? 'text-white bg-brand hover:bg-brand-hover'
                          : 'text-slate-400 bg-slate-100'
                      }`}
                    >
                      {modalSaving ? '保存中...' : isDirty ? '保存' : '未修改'}
                    </button>
                  )}
                  <button
                    onClick={() => !modalSaving && setModalFile(null)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg
                      hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              </div>
              {/* 内容 */}
              <div className="flex-1 overflow-hidden p-4">
                {meta.editable ? (
                  <textarea
                    value={modalContent}
                    onChange={(e) => setModalContent(e.target.value)}
                    className="w-full h-full px-4 py-3 text-sm font-mono text-slate-700 bg-slate-50 border border-slate-200
                      rounded-xl resize-none focus:outline-none focus:ring-2 focus:ring-brand/40 focus:border-brand
                      leading-relaxed"
                    autoFocus
                  />
                ) : (
                  <pre className="w-full h-full px-4 py-3 text-sm font-mono text-slate-500 bg-slate-50 border border-slate-200
                    rounded-xl overflow-y-auto whitespace-pre-wrap leading-relaxed">
                    {files[modalFile] || '（空）'}
                  </pre>
                )}
              </div>
            </div>
          </div>
        );
      })()}
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
