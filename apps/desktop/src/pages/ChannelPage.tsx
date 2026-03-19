import { useState, useEffect, useCallback } from 'react';
import { get, post } from '../lib/api';

/** Channel 状态信息 */
interface ChannelStatus {
  type: string;
  name: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error?: string;
  connectedAt?: string;
}


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
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFeishu, setShowFeishu] = useState(false);
  const [showWecom, setShowWecom] = useState(false);

  const fetchData = useCallback(async () => {
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
    fetchData();
  }, [fetchData]);

  const handleDisconnect = useCallback(async (type: string) => {
    await post('/channel/disconnect', { type });
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

          </div>
        )}
      </div>
    </div>
  );
}
