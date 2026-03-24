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

/** Channel 绑定信息 */
interface ChannelBinding {
  channelType: string;
  agentId: string;
  agentName?: string;
}

/** Agent 简要信息 */
interface AgentInfo {
  id: string;
  name: string;
  emoji: string;
}

/** 平台元数据 */
const PLATFORMS: Record<string, { name: string; logo: string }> = {
  feishu: { name: '飞书', logo: '/logo-feishu.png' },
  wecom: { name: '企业微信', logo: '/logo-wecom.png' },
  weixin: { name: '微信', logo: '/logo-weixin.png' },
  dingtalk: { name: '钉钉', logo: '/logo-dingtalk.png' },
  qq: { name: 'QQ', logo: '/logo-qq.png' },
};

const PLATFORM_ORDER = ['weixin', 'feishu', 'wecom', 'dingtalk', 'qq'];

export default function ChannelPage() {
  const [channels, setChannels] = useState<ChannelStatus[]>([]);
  const [bindings, setBindings] = useState<ChannelBinding[]>([]);
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, bindingsRes, agentsRes] = await Promise.all([
        get<{ channels: ChannelStatus[] }>('/channel/status'),
        get<{ bindings: ChannelBinding[] }>('/channel/bindings').catch(() => ({ bindings: [] as ChannelBinding[] })),
        get<{ agents: AgentInfo[] }>('/agents').catch(() => ({ agents: [] as AgentInfo[] })),
      ]);
      setChannels(statusRes.channels);
      setBindings(bindingsRes.bindings);
      setAgents(agentsRes.agents);
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

  const getChannelStatus = (type: string) => channels.find(ch => ch.type === type);
  const getBinding = (type: string) => bindings.find(b => b.channelType === type);

  const getAgentDisplayName = (binding: ChannelBinding | undefined): string | null => {
    if (!binding) return null;
    if (binding.agentName) return binding.agentName;
    const agent = agents.find(a => a.id === binding.agentId);
    return agent ? agent.name : binding.agentId;
  };

  const connectedCount = channels.filter(ch => ch.status === 'connected' && ch.type !== 'local').length;

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-5 pb-4 shrink-0">
        <h2 className="text-lg font-bold text-slate-900">连接总览</h2>
        <p className="text-sm text-slate-400 mt-1">
          查看所有渠道的连接与绑定状态
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {loading ? (
          <div className="text-center text-slate-400 mt-20">
            <span className="w-5 h-5 border-2 border-slate-300 border-t-brand rounded-full animate-spin inline-block" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* 统计 */}
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span>共 {PLATFORM_ORDER.length} 个渠道</span>
              <span className="text-slate-300">|</span>
              <span className="text-green-500">{connectedCount} 个已连接</span>
            </div>

            {/* 渠道列表 */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden divide-y divide-slate-100">
              {PLATFORM_ORDER.map((type) => {
                const platform = PLATFORMS[type];
                if (!platform) return null;

                const status = getChannelStatus(type);
                const binding = getBinding(type);
                const isConnected = status?.status === 'connected';
                const boundAgentName = getAgentDisplayName(binding);

                return (
                  <div
                    key={type}
                    className="flex items-center gap-4 px-5 py-4"
                  >
                    {/* 状态指示灯 + 图标 */}
                    <div className="relative shrink-0">
                      <img src={platform.logo} alt={platform.name} className="w-9 h-9 object-contain" />
                      <span
                        className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${
                          isConnected ? 'bg-green-400' : 'bg-slate-300'
                        }`}
                      />
                    </div>

                    {/* 名称 + 状态 */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-slate-800">{platform.name}</p>
                      <p className={`text-xs mt-0.5 ${isConnected ? 'text-green-600' : 'text-slate-400'}`}>
                        {isConnected ? '已连接' : '未连接'}
                      </p>
                    </div>

                    {/* 绑定的专家 */}
                    <div className="min-w-[100px] text-right">
                      {boundAgentName ? (
                        <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium
                          bg-brand/5 text-brand rounded-lg">
                          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.54a4.5 4.5 0 00-1.242-7.244l4.5-4.5a4.5 4.5 0 016.364 6.364l-1.757 1.757" />
                          </svg>
                          {boundAgentName}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-300">--</span>
                      )}
                    </div>

                    {/* 操作按钮 */}
                    <div className="shrink-0">
                      {isConnected ? (
                        <button
                          onClick={() => handleDisconnect(type)}
                          className="px-3 py-1.5 text-xs font-medium text-red-500 border border-red-200
                            rounded-lg hover:bg-red-50 transition-colors"
                        >
                          断开
                        </button>
                      ) : (
                        <span className="px-3 py-1.5 text-xs text-slate-300">--</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 提示 */}
            <div className="flex items-center gap-2 px-4 py-3 bg-slate-50 rounded-xl">
              <svg className="w-4 h-4 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
              <p className="text-xs text-slate-500">
                在专家设置中连接和绑定渠道到具体的专家
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
