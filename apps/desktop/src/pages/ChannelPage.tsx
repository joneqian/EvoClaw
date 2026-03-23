import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
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

/** 微信 QR 扫码登录表单 */
function WeixinConnectForm({ onConnect }: { onConnect: () => void }) {
  const [step, setStep] = useState<'idle' | 'loading' | 'scanning' | 'scanned' | 'error'>('idle');
  const [qrUrl, setQrUrl] = useState('');
  const [qrcode, setQrcode] = useState('');
  const [error, setError] = useState('');
  const [refreshCount, setRefreshCount] = useState(0);
  const pollingRef = useRef(false);

  const MAX_REFRESH = 3;

  /** 获取二维码 */
  const fetchQrCode = useCallback(async () => {
    setStep('loading');
    setError('');
    try {
      const data = await get<{ qrcode: string; qrcode_img_content: string }>('/channel/weixin/qrcode');
      setQrUrl(data.qrcode_img_content);
      setQrcode(data.qrcode);
      setStep('scanning');
      pollingRef.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : '获取二维码失败');
      setStep('error');
    }
  }, []);

  /** 轮询扫码状态 */
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
              // 存储 token 到 Keychain
              if (data.bot_token) {
                try {
                  await invoke('credential_set', {
                    service: 'weixin',
                    account: 'bot_token',
                    value: data.bot_token,
                  });
                } catch {
                  // Keychain 存储失败时继续，token 仍通过 credentials 传给后端
                }
              }
              // 连接微信渠道
              await post('/channel/connect', {
                type: 'weixin',
                name: '微信',
                credentials: {
                  botToken: data.bot_token ?? '',
                  ilinkBotId: data.ilink_bot_id ?? '',
                  baseUrl: data.baseurl ?? '',
                },
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
            // 'wait' — 继续轮询
          }
        } catch {
          // 网络错误，继续重试
        }
        // 2s 轮询间隔
        await new Promise(r => setTimeout(r, 2000));
      }
    };

    void poll();

    return () => {
      pollingRef.current = false;
    };
  }, [step, qrcode, refreshCount, fetchQrCode, onConnect]);

  // 首次自动获取二维码
  useEffect(() => {
    fetchQrCode();
    return () => { pollingRef.current = false; };
  }, [fetchQrCode]);

  return (
    <div className="space-y-3 text-center">
      {step === 'loading' && (
        <p className="text-xs text-slate-400">正在获取二维码...</p>
      )}
      {(step === 'scanning' || step === 'scanned') && qrUrl && (
        <>
          <img
            src={qrUrl}
            alt="微信扫码登录"
            className="w-48 h-48 mx-auto rounded-xl border border-slate-200"
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

export default function ChannelPage() {
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFeishu, setShowFeishu] = useState(false);
  const [showWecom, setShowWecom] = useState(false);
  const [showWeixin, setShowWeixin] = useState(false);

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
    { type: 'weixin', name: '微信', logo: '/logo-weixin.png', desc: '通过 iLink Bot 接入微信个人号，实现 AI 助手私信对话。' },
  ];

  /** 获取某平台的连接状态 */
  const getChannelStatus = (type: string) => channels.find(ch => ch.type === type);

  /** 点击连接/断开 */
  const handlePlatformAction = (type: string) => {
    const status = getChannelStatus(type);
    if (status?.status === 'connected') {
      handleDisconnect(type);
    } else if (type === 'feishu') {
      setShowFeishu(!showFeishu); setShowWecom(false); setShowWeixin(false);
    } else if (type === 'wecom') {
      setShowWecom(!showWecom); setShowFeishu(false); setShowWeixin(false);
    } else if (type === 'weixin') {
      setShowWeixin(!showWeixin); setShowFeishu(false); setShowWecom(false);
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
                const hasForm = (p.type === 'feishu' && showFeishu) || (p.type === 'wecom' && showWecom) || (p.type === 'weixin' && showWeixin);
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
                        <span className="px-2 py-0.5 text-xs font-medium bg-green-100 text-green-600 rounded-full">
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
                        {p.type === 'weixin' && (
                          <WeixinConnectForm onConnect={() => { setShowWeixin(false); fetchData(); }} />
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
