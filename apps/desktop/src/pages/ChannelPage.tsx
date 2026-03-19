import { useState, useEffect, useCallback } from 'react';
import { useAgentStore } from '../stores/agent-store';
import AgentAvatar from '../components/AgentAvatar';
import { get, post, del } from '../lib/api';

/** Channel 状态信息 */
interface ChannelStatus {
  type: string;
  name: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error?: string;
  connectedAt?: string;
}

/** Binding 记录 */
interface BindingRecord {
  id: string;
  agentId: string;
  channel: string;
  accountId: string | null;
  peerId: string | null;
  priority: number;
  isDefault: boolean;
  createdAt: string;
}

/** 状态标签 */
const STATUS_STYLES: Record<string, { label: string; color: string }> = {
  disconnected: { label: '未连接', color: 'bg-slate-100 text-slate-500' },
  connecting: { label: '连接中', color: 'bg-yellow-100 text-yellow-700' },
  connected: { label: '已连接', color: 'bg-green-100 text-green-700' },
  error: { label: '错误', color: 'bg-red-100 text-red-600' },
};

/** Channel 类型标签 */
const CHANNEL_LABELS: Record<string, string> = {
  local: '桌面',
  feishu: '飞书',
  wecom: '企业微信',
  dingtalk: '钉钉',
  qq: 'QQ',
};

/** 飞书连接表单 */
function FeishuConnectForm({ onConnect }: { onConnect: () => void }) {
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
      });
      onConnect();
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接失败');
    } finally {
      setConnecting(false);
    }
  }, [appId, appSecret, onConnect]);

  return (
    <div className="space-y-2">
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

/** 企微连接表单 */
function WecomConnectForm({ onConnect }: { onConnect: () => void }) {
  const [corpId, setCorpId] = useState('');
  const [agentId, setAgentId] = useState('');
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
        credentials: { corpId: corpId.trim(), agentId: agentId.trim(), secret: secret.trim() },
      });
      onConnect();
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接失败');
    } finally {
      setConnecting(false);
    }
  }, [corpId, agentId, secret, onConnect]);

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={corpId}
        onChange={(e) => setCorpId(e.target.value)}
        placeholder="Corp ID"
        className="w-full px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand"
      />
      <input
        type="text"
        value={agentId}
        onChange={(e) => setAgentId(e.target.value)}
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

export default function ChannelPage() {
  const { agents } = useAgentStore();
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [bindings, setBindings] = useState<BindingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFeishu, setShowFeishu] = useState(false);
  const [showWecom, setShowWecom] = useState(false);

  // Binding 创建表单
  const [showBindingForm, setShowBindingForm] = useState(false);
  const [bindingForm, setBindingForm] = useState({
    agentId: '',
    channel: 'feishu',
    accountId: '',
    peerId: '',
    isDefault: false,
  });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, bindingRes] = await Promise.all([
        get<{ channels: ChannelStatus[] }>('/channel/status'),
        get<{ bindings: BindingRecord[] }>('/binding'),
      ]);
      setChannels(statusRes.channels);
      setBindings(bindingRes.bindings);
    } catch {
      // 容错
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // 默认选中第一个 agent
  useEffect(() => {
    if (agents.length > 0 && !bindingForm.agentId) {
      setBindingForm((f) => ({ ...f, agentId: agents[0].id }));
    }
  }, [agents, bindingForm.agentId]);

  const handleDisconnect = useCallback(async (type: string) => {
    await post('/channel/disconnect', { type });
    fetchData();
  }, [fetchData]);

  const createBinding = useCallback(async () => {
    if (!bindingForm.agentId) return;
    try {
      await post('/binding', {
        agentId: bindingForm.agentId,
        channel: bindingForm.channel,
        accountId: bindingForm.accountId || undefined,
        peerId: bindingForm.peerId || undefined,
        isDefault: bindingForm.isDefault,
      });
      setBindingForm({ agentId: agents[0]?.id ?? '', channel: 'feishu', accountId: '', peerId: '', isDefault: false });
      setShowBindingForm(false);
      fetchData();
    } catch {
      // 错误处理
    }
  }, [bindingForm, agents, fetchData]);

  const deleteBinding = useCallback(async (id: string) => {
    await del(`/binding/${id}`);
    fetchData();
  }, [fetchData]);

  /** 可连接平台列表 */
  const PLATFORMS = [
    { type: 'feishu', name: '飞书', logo: '/logo-feishu.png', desc: '接入飞书企业内部应用，实现自动化群聊与私信交互。' },
    { type: 'wecom', name: '企业微信', logo: '/logo-wecom.png', desc: '使用 BotID 和 Secret 连接企业微信官方机器人。' },
    { type: 'qq', name: 'QQ', logo: '/logo-qq.png', desc: '接入 QQ 官方机器人，覆盖群聊、频道与私信全场景互动。' },
    { type: 'dingtalk', name: '钉钉', logo: '/logo-dingtalk.png', desc: '接入钉钉企业内部机器人，通过 Stream 模式实现稳定的群聊与私信交互。' },
  ];

  /** 获取某平台的连接状态 */
  const getChannelStatus = (type: string) => channels.find(ch => ch.type === type);

  /** 点击连接/断开 */
  const handlePlatformAction = (type: string) => {
    const status = getChannelStatus(type);
    if (status?.status === 'connected') {
      handleDisconnect(type);
    } else if (type === 'feishu') {
      setShowFeishu(!showFeishu); setShowWecom(false);
    } else if (type === 'wecom') {
      setShowWecom(!showWecom); setShowFeishu(false);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-5 pb-4 shrink-0">
        <h2 className="text-lg font-bold text-slate-900">连接</h2>
        <p className="text-sm text-slate-400 mt-1">接入第三方平台，让专家跨平台服务</p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {loading ? (
          <div className="text-center text-slate-400 mt-20">
            <span className="w-5 h-5 border-2 border-slate-300 border-t-brand rounded-full animate-spin inline-block" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* 平台卡片网格 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {PLATFORMS.map((p) => {
                const status = getChannelStatus(p.type);
                const isConnected = status?.status === 'connected';
                const hasForm = (p.type === 'feishu' && showFeishu) || (p.type === 'wecom' && showWecom);
                return (
                  <div
                    key={p.type}
                    className={`bg-white rounded-2xl border p-5 transition-all duration-200 flex flex-col ${
                      isConnected
                        ? 'border-green-200 bg-green-50/30'
                        : 'border-slate-200 hover:border-brand/30 hover:shadow-md'
                    }`}
                  >
                    {/* 图标 + 状态 */}
                    <div className="flex items-start justify-between mb-3">
                      <img src={p.logo} alt={p.name} className="w-10 h-10 object-contain" />
                      {isConnected && (
                        <span className="px-2 py-0.5 text-[11px] font-medium bg-green-100 text-green-600 rounded-full">
                          已连接
                        </span>
                      )}
                    </div>
                    {/* 名称 + 描述 */}
                    <h4 className="text-sm font-bold text-slate-800 mb-1">{p.name}</h4>
                    <p className="text-xs text-slate-400 leading-relaxed flex-1 mb-4">{p.desc}</p>
                    {/* 连接表单（展开时） */}
                    {hasForm && (
                      <div className="mb-3 p-3 bg-slate-50 rounded-xl">
                        {p.type === 'feishu' && (
                          <FeishuConnectForm onConnect={() => { setShowFeishu(false); fetchData(); }} />
                        )}
                        {p.type === 'wecom' && (
                          <WecomConnectForm onConnect={() => { setShowWecom(false); fetchData(); }} />
                        )}
                      </div>
                    )}
                    {/* 操作按钮 */}
                    <button
                      onClick={() => handlePlatformAction(p.type)}
                      className={`w-full py-2 text-sm font-medium rounded-xl border transition-all duration-150 ${
                        isConnected
                          ? 'border-red-200 text-red-500 hover:bg-red-50'
                          : 'border-brand/30 text-brand hover:bg-brand/5'
                      }`}
                    >
                      {isConnected ? '断开' : hasForm ? '取消' : '连接'}
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Binding 管理 */}
            <div className="bg-white rounded-lg border border-slate-200 p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-medium text-slate-700">绑定规则</h3>
                <button
                  onClick={() => setShowBindingForm(!showBindingForm)}
                  className="px-3 py-1 text-xs font-medium text-white bg-brand rounded-lg hover:bg-brand-active transition-colors"
                >
                  {showBindingForm ? '取消' : '新建'}
                </button>
              </div>

              {/* 创建表单 */}
              {showBindingForm && (
                <div className="mb-4 p-3 bg-slate-50 rounded-lg space-y-2">
                  <div className="flex gap-2">
                    <select
                      value={bindingForm.agentId}
                      onChange={(e) => setBindingForm({ ...bindingForm, agentId: e.target.value })}
                      className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand"
                    >
                      {agents.map((a) => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                      ))}
                    </select>
                    <select
                      value={bindingForm.channel}
                      onChange={(e) => setBindingForm({ ...bindingForm, channel: e.target.value })}
                      className="px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand"
                    >
                      <option value="feishu">飞书</option>
                      <option value="wecom">企微</option>
                      <option value="local">桌面</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={bindingForm.peerId}
                      onChange={(e) => setBindingForm({ ...bindingForm, peerId: e.target.value })}
                      placeholder="Peer ID（可选，精确匹配）"
                      className="flex-1 px-3 py-1.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-brand"
                    />
                    <label className="flex items-center gap-1.5 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={bindingForm.isDefault}
                        onChange={(e) => setBindingForm({ ...bindingForm, isDefault: e.target.checked })}
                        className="rounded border-slate-300 text-brand"
                      />
                      默认
                    </label>
                  </div>
                  <button
                    onClick={createBinding}
                    disabled={!bindingForm.agentId}
                    className="px-4 py-1.5 text-sm font-medium text-white bg-brand rounded-lg hover:bg-brand-active disabled:opacity-50 transition-colors"
                  >
                    创建
                  </button>
                </div>
              )}

              {/* Binding 列表 */}
              {bindings.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-4">暂无绑定规则</p>
              ) : (
                <div className="space-y-2">
                  {bindings.map((b) => {
                    const agent = agents.find((a) => a.id === b.agentId);
                    return (
                      <div key={b.id} className="flex items-center justify-between px-3 py-2 rounded bg-slate-50">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-slate-700 flex items-center gap-1.5">
                              {agent ? <><AgentAvatar name={agent.name} size="xs" />{agent.name}</> : b.agentId.slice(0, 8)}
                            </span>
                            <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 text-blue-600">
                              {CHANNEL_LABELS[b.channel] ?? b.channel}
                            </span>
                            {b.isDefault && (
                              <span className="text-xs px-1.5 py-0.5 rounded bg-brand/10 text-brand-active">默认</span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {b.peerId ? `Peer: ${b.peerId}` : b.accountId ? `Account: ${b.accountId}` : '全局'}
                            {' · '}优先级 {b.priority}
                          </p>
                        </div>
                        <button
                          onClick={() => deleteBinding(b.id)}
                          className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
