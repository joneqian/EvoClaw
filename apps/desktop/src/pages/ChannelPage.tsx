import { useState, useEffect, useCallback } from 'react';
import { Link2, Info } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { get, post } from '../lib/api';

/** Channel 状态信息 */
interface ChannelStatus {
  type: string;
  accountId?: string;
  name: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error?: string;
  connectedAt?: string;
}

/** Channel 绑定信息（对齐后端 routing/binding-router.ts 返回字段） */
interface ChannelBinding {
  channel: string;
  accountId?: string | null;
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
  const { t } = useTranslation();
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

  const handleDisconnect = useCallback(async (type: string, accountId: string) => {
    await post('/channel/disconnect', { type, accountId });
    fetchData();
  }, [fetchData]);

  /** 列出某渠道类型下的所有已注册账号（若为 0 条返回 1 条"占位未连接"） */
  const listAccountsFor = (type: string): ChannelStatus[] => {
    const matched = channels.filter((ch) => ch.type === type);
    if (matched.length === 0) {
      return [{ type, accountId: '', name: PLATFORMS[type]?.name ?? type, status: 'disconnected' }];
    }
    return matched;
  };

  /** 按 (channel, accountId) 精确匹配 binding；accountId 缺省时退回仅按 channel */
  const getBinding = (type: string, accountId: string | undefined): ChannelBinding | undefined => {
    if (accountId) {
      const exact = bindings.find((b) => b.channel === type && (b.accountId ?? '') === accountId);
      if (exact) return exact;
    }
    return bindings.find((b) => b.channel === type);
  };

  const getAgentDisplayName = (binding: ChannelBinding | undefined): string | null => {
    if (!binding) return null;
    if (binding.agentName) return binding.agentName;
    const agent = agents.find(a => a.id === binding.agentId);
    return agent ? agent.name : binding.agentId;
  };

  const connectedCount = channels.filter(ch => ch.status === 'connected' && ch.type !== 'local').length;

  /** 账号 ID 脱敏展示（用后 8 位，前置省略号） */
  const displayAccountId = (accountId: string | undefined): string => {
    if (!accountId) return '';
    if (accountId.length <= 10) return accountId;
    return `...${accountId.slice(-8)}`;
  };

  return (
    <div className="h-full flex flex-col">
      <div className="px-6 pt-5 pb-4 shrink-0">
        <h2 className="text-lg font-bold text-foreground">{t('channelPage.title')}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {t('channelPage.desc')}
        </p>
      </div>

      <div className="flex-1 overflow-y-auto px-6 pb-6">
        {loading ? (
          <div className="text-center text-muted-foreground mt-20">
            <span className="w-5 h-5 border-2 border-border border-t-brand rounded-full animate-spin inline-block" />
          </div>
        ) : (
          <div className="space-y-4">
            {/* 统计 */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>共 {PLATFORM_ORDER.length} 个渠道</span>
              <span className="text-muted-foreground">|</span>
              <span className="text-success">{t('channelPage.connectedCount', { count: connectedCount })}</span>
            </div>

            {/* 渠道列表 */}
            <div className="bg-card rounded-2xl border border-border overflow-hidden divide-y divide-border">
              {PLATFORM_ORDER.flatMap((type) => {
                const platform = PLATFORMS[type];
                if (!platform) return [];
                const accounts = listAccountsFor(type);

                return accounts.map((status, idx) => {
                  const accountId = status.accountId ?? '';
                  const binding = getBinding(type, accountId);
                  const isConnected = status.status === 'connected';
                  const boundAgentName = getAgentDisplayName(binding);
                  const isFirstAccount = idx === 0;
                  const isMultiAccount = accounts.length > 1;

                  return (
                    <div
                      key={`${type}:${accountId}:${idx}`}
                      className="flex items-center gap-4 px-5 py-4"
                    >
                      {/* 状态指示灯 + 图标（多账号时只第一个显示 logo，其余缩进对齐） */}
                      <div className="relative shrink-0 w-9">
                        {isFirstAccount && (
                          <>
                            <img src={platform.logo} alt={platform.name} className="w-9 h-9 object-contain" />
                            <span
                              className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-background ${
                                isConnected ? 'bg-success' : 'bg-border'
                              }`}
                            />
                          </>
                        )}
                        {!isFirstAccount && (
                          <span className={`block w-3 h-3 mt-3 ml-3 rounded-full ${isConnected ? 'bg-success' : 'bg-border'}`} />
                        )}
                      </div>

                      {/* 名称 + accountId + 状态 */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium text-foreground">{platform.name}</p>
                          {isMultiAccount && accountId && (
                            <span className="text-xs font-mono text-muted-foreground">{displayAccountId(accountId)}</span>
                          )}
                        </div>
                        <p className={`text-xs mt-0.5 ${isConnected ? 'text-success' : 'text-muted-foreground'}`}>
                          {isConnected ? t('channelPage.connected') : t('channelPage.disconnected')}
                        </p>
                      </div>

                      {/* 绑定的专家 */}
                      <div className="min-w-[100px] text-right">
                        {boundAgentName ? (
                          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium
                            bg-brand/5 text-brand rounded-lg">
                            <Link2 className="w-3 h-3" strokeWidth={2} aria-hidden="true" />
                            {boundAgentName}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">--</span>
                        )}
                      </div>

                      {/* 操作按钮 */}
                      <div className="shrink-0">
                        {isConnected ? (
                          <button
                            onClick={() => handleDisconnect(type, accountId)}
                            className="px-3 py-1.5 text-xs font-medium text-danger border border-danger/30
                              rounded-lg hover:bg-danger/10 transition-colors"
                          >
                            断开
                          </button>
                        ) : (
                          <span className="px-3 py-1.5 text-xs text-muted-foreground">--</span>
                        )}
                      </div>
                    </div>
                  );
                });
              })}
            </div>

            {/* 提示 */}
            <div className="flex items-center gap-2 px-4 py-3 bg-muted rounded-xl">
              <Info className="w-4 h-4 text-muted-foreground shrink-0" strokeWidth={1.5} aria-hidden="true" />
              <p className="text-xs text-muted-foreground">
                在专家设置中连接和绑定渠道到具体的专家
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
