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
import { Sparkles, Pencil, Eye, X as XIcon, Settings as SettingsIcon, MoreVertical } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { useAgentStore } from '../stores/agent-store';
import { get, post, put } from '../lib/api';
import { parseUtcDate } from '../lib/date';
import AgentAvatar from './AgentAvatar';
import type { HeartbeatConfig, CronJobConfig } from '@evoclaw/shared';

/** 面板标签页 */
type TabId = 'channels' | 'skills' | 'automation' | 'settings';

interface ExpertSettingsPanelProps {
  agentId: string;
  isOpen: boolean;
  onClose: () => void;
}

/** Channel 连接状态 */
interface ChannelStatus {
  type: string;
  /** 多账号改造：同 channel 可能有多个账号，UI 按 (type, accountId) 索引 */
  accountId?: string;
  name: string;
  status: 'disconnected' | 'connecting' | 'connected' | 'error';
  error?: string;
}

/**
 * Channel 绑定信息
 *
 * 对齐后端 `/channel/bindings` 返回的字段（见 routing/binding-router.ts）。
 * 历史上前端用过 `channelType`，但后端始终是 `channel`，导致 `getBinding`
 * 永远找不到匹配 → `isBoundToMe` 永假 → 飞书"编辑配置"按钮不显示。
 */
interface ChannelBinding {
  channel: string;
  /** 多账号改造：标识该绑定关联的具体应用 ID（飞书=appId / 企微=corpId） */
  accountId?: string | null;
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
  'BOOTSTRAP.md': { icon: '🌅', label: '首次对话引导', desc: '专家的"出生仪式"', editable: false },
  'TOOLS.md': { icon: '🔧', label: '环境笔记', desc: '环境特有的备忘信息', editable: true },
  'HEARTBEAT.md': { icon: '💓', label: '定时检查', desc: '周期性自动检查清单', editable: true },
  'USER.md': { icon: '👤', label: '用户画像', desc: '运行时动态渲染', editable: false },
  'MEMORY.md': { icon: '🧠', label: '长期记忆', desc: '运行时动态渲染', editable: false },
};

const FILE_ORDER = ['SOUL.md', 'IDENTITY.md', 'AGENTS.md', 'BOOTSTRAP.md', 'TOOLS.md', 'HEARTBEAT.md', 'USER.md', 'MEMORY.md'];

const TABS: { id: TabId; labelKey: string }[] = [
  { id: 'channels', labelKey: 'expertSettings.tabChannels' },
  { id: 'skills', labelKey: 'expertSettings.tabSkills' },
  { id: 'automation', labelKey: 'expertSettings.tabAutomation' },
  { id: 'settings', labelKey: 'expertSettings.tabSettings' },
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
    <div className="space-y-3 text-center p-3 bg-muted rounded-xl">
      {step === 'loading' && (
        <p className="text-xs text-muted-foreground">正在获取二维码...</p>
      )}
      {(step === 'scanning' || step === 'scanned') && qrDataUrl && (
        <>
          <img
            src={qrDataUrl}
            alt="微信扫码登录"
            className="w-40 h-40 mx-auto rounded-xl border border-border"
          />
          <p className="text-xs text-muted-foreground">
            {step === 'scanned' ? '已扫描，请在手机上确认...' : '请使用微信扫描二维码'}
          </p>
        </>
      )}
      {step === 'error' && (
        <>
          <p className="text-xs text-danger">{error}</p>
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

type GroupScope = 'group' | 'group_sender' | 'group_topic' | 'group_topic_sender';
// M13 Phase 1 PR-1A 改默认为 group_topic（员工用话题功能时多任务自动按话题隔离）
const GROUP_SCOPE_OPTIONS: Array<{ value: GroupScope; label: string }> = [
  { value: 'group', label: '整群共享一个会话' },
  { value: 'group_sender', label: '群内按成员分离' },
  { value: 'group_topic', label: '群内按话题分离（默认）' },
  { value: 'group_topic_sender', label: '群内按「话题 × 成员」分离' },
];

function InlineFeishuConnect({
  agentId,
  isBound,
  accountId,
  onConnect,
}: {
  agentId: string;
  /** 当前 Agent 是否已绑定飞书（决定是否预填） */
  isBound: boolean;
  /** 多账号场景下该 Agent 自己 binding 的 accountId（= appId）；
      老单账号数据可能为 null/undefined，此时走 legacy 路径取首条。 */
  accountId?: string;
  onConnect: () => void;
}) {
  const [appId, setAppId] = useState('');
  const [appSecret, setAppSecret] = useState('');
  // M13 Phase 1 PR-1A: 默认 group_topic（与后端 schema default 对齐）
  const [groupScope, setGroupScope] = useState<GroupScope>('group_topic');
  // 群旁听缓冲（多机器人协作），默认开启
  const [historyEnabled, setHistoryEnabled] = useState(true);
  const [historyLimit, setHistoryLimit] = useState(20);
  const [historyTtl, setHistoryTtl] = useState(30);
  // 广播模式（一条消息 fanout 到多机器人），默认关闭
  const [broadcastEnabled, setBroadcastEnabled] = useState(false);
  const [broadcastTriggerMode, setBroadcastTriggerMode] = useState<
    'mention-first' | 'any-mention' | 'always'
  >('any-mention');
  const [broadcastPeerAgentsJson, setBroadcastPeerAgentsJson] = useState('');
  const [broadcastJsonError, setBroadcastJsonError] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [encryptKey, setEncryptKey] = useState('');
  const [verificationToken, setVerificationToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');
  // 挂载时拉取已存配置预填（重连 / 编辑配置场景）
  const [hasSavedSecret, setHasSavedSecret] = useState(false);
  const [loadingPrefill, setLoadingPrefill] = useState(true);

  useEffect(() => {
    // 未绑定：跳过预填，保持空表单，避免拉到其他 Agent 的凭据
    if (!isBound) {
      setLoadingPrefill(false);
      return;
    }
    // 已绑定：优先按 accountId 精确拉；老数据无 accountId 时走 legacy 路径（首条）
    const url = accountId
      ? `/channel/credentials/feishu/${encodeURIComponent(accountId)}`
      : '/channel/credentials/feishu';
    let cancelled = false;
    (async () => {
      try {
        const resp = await get<{
          credentials: Record<string, string> | null;
          hasSecret: boolean;
          name?: string;
        }>(url);
        if (cancelled) return;
        const creds = resp.credentials;
        if (creds) {
          if (typeof creds['appId'] === 'string') setAppId(creds['appId']);
          if (
            typeof creds['groupSessionScope'] === 'string' &&
            GROUP_SCOPE_OPTIONS.some((o) => o.value === creds['groupSessionScope'])
          ) {
            setGroupScope(creds['groupSessionScope'] as GroupScope);
          }
          if (typeof creds['groupHistoryEnabled'] === 'string') {
            setHistoryEnabled(creds['groupHistoryEnabled'] !== 'false');
          }
          if (typeof creds['groupHistoryLimit'] === 'string') {
            const n = Number(creds['groupHistoryLimit']);
            if (Number.isFinite(n) && n > 0) setHistoryLimit(n);
          }
          if (typeof creds['groupHistoryTtlMinutes'] === 'string') {
            const n = Number(creds['groupHistoryTtlMinutes']);
            if (Number.isFinite(n) && n > 0) setHistoryTtl(n);
          }
          if (typeof creds['broadcastEnabled'] === 'string') {
            setBroadcastEnabled(creds['broadcastEnabled'] === 'true');
          }
          const mode = creds['broadcastTriggerMode'];
          if (mode === 'mention-first' || mode === 'any-mention' || mode === 'always') {
            setBroadcastTriggerMode(mode);
          }
          if (typeof creds['broadcastPeerAgents'] === 'string') {
            setBroadcastPeerAgentsJson(creds['broadcastPeerAgents']);
          }
        }
        setHasSavedSecret(resp.hasSecret === true);
      } catch {
        // 拉取失败不阻塞，用户正常填写即可
      } finally {
        if (!cancelled) setLoadingPrefill(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isBound, accountId]);

  const handleConnect = useCallback(async () => {
    // appSecret 留空时允许沿用已保存值
    if (!appId.trim()) return;
    if (!appSecret.trim() && !hasSavedSecret) return;
    // 广播启用时校验 JSON 合法性（避免无效配置悄悄丢失）
    if (broadcastEnabled && broadcastPeerAgentsJson.trim()) {
      try {
        const parsed = JSON.parse(broadcastPeerAgentsJson);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error('需为对象：{"chatId": ["agent-a"]}');
        }
        setBroadcastJsonError('');
      } catch (err) {
        setBroadcastJsonError(
          err instanceof Error ? err.message : '广播 JSON 格式错误',
        );
        return;
      }
    }
    setConnecting(true);
    setError('');
    try {
      const credentials: Record<string, string> = {
        appId: appId.trim(),
        // 留空时后端沿用已保存的 appSecret（见 /channel/connect 路由）
        appSecret: appSecret.trim(),
        groupSessionScope: groupScope,
        groupHistoryEnabled: historyEnabled ? 'true' : 'false',
        groupHistoryLimit: String(historyLimit),
        groupHistoryTtlMinutes: String(historyTtl),
        broadcastEnabled: broadcastEnabled ? 'true' : 'false',
        broadcastTriggerMode,
      };
      if (broadcastEnabled && broadcastPeerAgentsJson.trim()) {
        credentials['broadcastPeerAgents'] = broadcastPeerAgentsJson.trim();
      }
      if (encryptKey.trim()) credentials['encryptKey'] = encryptKey.trim();
      if (verificationToken.trim()) credentials['verificationToken'] = verificationToken.trim();

      await post('/channel/connect', {
        type: 'feishu',
        name: '飞书',
        credentials,
        agentId,
      });
      onConnect();
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接失败');
    } finally {
      setConnecting(false);
    }
  }, [
    appId,
    appSecret,
    groupScope,
    historyEnabled,
    historyLimit,
    historyTtl,
    broadcastEnabled,
    broadcastTriggerMode,
    broadcastPeerAgentsJson,
    encryptKey,
    verificationToken,
    agentId,
    onConnect,
    hasSavedSecret,
  ]);

  return (
    <div className="space-y-2 p-3 bg-muted rounded-xl">
      <input
        type="text"
        value={appId}
        onChange={(e) => setAppId(e.target.value)}
        placeholder="App ID"
        className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
      />
      <input
        type="password"
        value={appSecret}
        onChange={(e) => setAppSecret(e.target.value)}
        placeholder={hasSavedSecret ? 'App Secret（已保存，留空沿用）' : 'App Secret'}
        className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
      />
      {loadingPrefill && (
        <p className="text-[11px] text-muted-foreground">正在读取已保存的配置...</p>
      )}

      {/* 群会话隔离策略 */}
      <label className="block text-xs text-muted-foreground">
        <span className="block mb-1">群聊会话策略</span>
        <select
          value={groupScope}
          onChange={(e) => setGroupScope(e.target.value as GroupScope)}
          className="w-full px-2 py-1.5 text-sm border border-border rounded-lg bg-card focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
        >
          {GROUP_SCOPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
      </label>

      {/* 多机器人协作：群旁听缓冲 */}
      <div className="rounded-lg border border-border bg-card p-2 space-y-1.5">
        <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={historyEnabled}
            onChange={(e) => setHistoryEnabled(e.target.checked)}
            className="accent-brand"
          />
          <span className="font-medium">开启群聊前情提要（多机器人协作）</span>
        </label>
        <p className="text-[11px] text-muted-foreground leading-relaxed pl-6">
          未 @ 机器人的群消息会进入旁听缓冲，下次被 @ 时自动作为前情提要注入，
          让多个机器人在群里能看到彼此的上下文。默认开启。
        </p>
        {historyEnabled && (
          <div className="grid grid-cols-2 gap-2 pl-6">
            <label className="text-[11px] text-muted-foreground">
              <span className="block mb-0.5">保留条数（1-100）</span>
              <input
                type="number"
                min={1}
                max={100}
                value={historyLimit}
                onChange={(e) =>
                  setHistoryLimit(
                    Math.max(1, Math.min(100, Number(e.target.value) || 20)),
                  )
                }
                className="w-full px-2 py-1 text-xs border border-border rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
              />
            </label>
            <label className="text-[11px] text-muted-foreground">
              <span className="block mb-0.5">过期时间（分钟）</span>
              <input
                type="number"
                min={1}
                max={1440}
                value={historyTtl}
                onChange={(e) =>
                  setHistoryTtl(
                    Math.max(1, Math.min(1440, Number(e.target.value) || 30)),
                  )
                }
                className="w-full px-2 py-1 text-xs border border-border rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
              />
            </label>
          </div>
        )}
      </div>

      {/* 多机器人圆桌：广播模式 */}
      <div className="rounded-lg border border-border bg-card p-2 space-y-1.5">
        <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={broadcastEnabled}
            onChange={(e) => setBroadcastEnabled(e.target.checked)}
            className="accent-brand"
          />
          <span className="font-medium">开启广播模式（一条消息触发多机器人）</span>
        </label>
        <p className="text-[11px] text-muted-foreground leading-relaxed pl-6">
          为指定群配置 <code>chatId → [agentId, ...]</code>，一条消息在该群里
          会同时派发到所有配置的 Agent（各自独立 session、独立回复）。默认关闭。
        </p>
        {broadcastEnabled && (
          <div className="pl-6 space-y-1.5">
            <label className="block text-[11px] text-muted-foreground">
              <span className="block mb-0.5">激活策略</span>
              <select
                value={broadcastTriggerMode}
                onChange={(e) =>
                  setBroadcastTriggerMode(
                    e.target.value as 'mention-first' | 'any-mention' | 'always',
                  )
                }
                className="w-full px-2 py-1 text-xs border border-border rounded bg-card focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
              >
                <option value="any-mention">任一机器人被 @ 时激活全体（默认）</option>
                <option value="mention-first">只激活被 @ 到的机器人</option>
                <option value="always">任何消息都激活全体</option>
              </select>
            </label>
            <label className="block text-[11px] text-muted-foreground">
              <span className="block mb-0.5">
                群/机器人映射（JSON，可留空）
              </span>
              <textarea
                value={broadcastPeerAgentsJson}
                onChange={(e) => {
                  setBroadcastPeerAgentsJson(e.target.value);
                  setBroadcastJsonError('');
                }}
                placeholder={'{\n  "oc_xxxxx": ["agent-strategy", "agent-finance"]\n}'}
                rows={4}
                className="w-full px-2 py-1 text-xs border border-border rounded bg-card font-mono focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
              />
              {broadcastJsonError && (
                <span className="block mt-0.5 text-danger">
                  {broadcastJsonError}
                </span>
              )}
            </label>
          </div>
        )}
      </div>

      {/* 高级选项 */}
      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="text-xs text-muted-foreground hover:text-muted-foreground transition-colors"
      >
        {showAdvanced ? '▼ 隐藏高级选项' : '▶ 高级选项（Encrypt Key / Verification Token）'}
      </button>

      {showAdvanced && (
        <>
          <input
            type="password"
            value={encryptKey}
            onChange={(e) => setEncryptKey(e.target.value)}
            placeholder="Encrypt Key（可选）"
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
          />
          <input
            type="password"
            value={verificationToken}
            onChange={(e) => setVerificationToken(e.target.value)}
            placeholder="Verification Token（可选）"
            className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
          />
        </>
      )}

      {error && <p className="text-xs text-danger">{error}</p>}

      {/* M13 Phase 1 PR-1C: 多 bot 同群协作的头像/昵称区分提示
          飞书 bot 头像/昵称在飞书开放平台后台配置（EvoClaw 无权改），
          多 Agent 同群时让员工可视区分需要主动配置。 */}
      <div className="rounded-lg bg-warning/10 border border-warning/30 p-2.5 text-[11px] text-warning leading-relaxed">
        <div className="font-semibold mb-1">💡 多 Agent 同群协作小贴士</div>
        <p>
          多个 Agent 在同一飞书群协作时，为让员工区分各 Agent 身份，建议：
        </p>
        <ol className="list-decimal pl-4 mt-1 space-y-0.5">
          <li>
            EvoClaw 内每个 Agent 配 <b>不同 emoji</b>（如 PM 🎯、设计 🎨、文案 ✍️）
          </li>
          <li>
            飞书开放平台后台（<a href="https://open.feishu.cn" target="_blank" rel="noreferrer" className="underline">open.feishu.cn</a>）
            为各应用配 <b>不同头像 + 昵称</b>（飞书侧元数据，EvoClaw 无权改）
          </li>
        </ol>
      </div>

      <button
        onClick={handleConnect}
        disabled={
          connecting || !appId.trim() || (!appSecret.trim() && !hasSavedSecret)
        }
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
    <div className="space-y-2 p-3 bg-muted rounded-xl">
      <input
        type="text"
        value={corpId}
        onChange={(e) => setCorpId(e.target.value)}
        placeholder="Corp ID"
        className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
      />
      <input
        type="text"
        value={wecomAgentId}
        onChange={(e) => setWecomAgentId(e.target.value)}
        placeholder="Agent ID"
        className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
      />
      <input
        type="password"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        placeholder="Secret"
        className="w-full px-3 py-1.5 text-sm border border-border rounded-lg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
      />
      {error && <p className="text-xs text-danger">{error}</p>}
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
  const { t } = useTranslation();
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

  /**
   * 取**当前 Agent 自己的** binding（多账号场景下，不同 Agent 可能各绑各的应用）
   *
   * 老代码用 `bindings.find(b => b.channel === type)` 取全局第一条，多账号下会
   * 误把其他 Agent 的绑定认成"本专家绑定"。现在按 (channel, agentId) 精确匹配。
   */
  const getChannelStatus = (type: string) => {
    const myBinding = bindings.find((b) => b.channel === type && b.agentId === agentId);
    if (myBinding) {
      const withAcc = channels.find(
        (ch) => ch.type === type && (ch.accountId ?? '') === (myBinding.accountId ?? ''),
      );
      if (withAcc) return withAcc;
    }
    return channels.find((ch) => ch.type === type);
  };
  const getBinding = (type: string) =>
    bindings.find((b) => b.channel === type && b.agentId === agentId);

  const handleDisconnect = useCallback(async (type: string) => {
    // 只断开该 Agent 自己绑定的那个账号，不影响其他 Agent 同 type 的账号
    const myBinding = bindings.find((b) => b.channel === type && b.agentId === agentId);
    const accountId = myBinding?.accountId ?? '';
    await post('/channel/disconnect', { type, accountId });
    setConnectingChannel(null);
    fetchData();
  }, [fetchData, bindings, agentId]);

  const handleUnbind = useCallback(async (type: string) => {
    const myBinding = bindings.find((b) => b.channel === type && b.agentId === agentId);
    const accountId = myBinding?.accountId ?? '';
    await post('/channel/disconnect', { type, accountId });
    setConnectingChannel(null);
    fetchData();
  }, [fetchData, bindings, agentId]);

  const handleConnectSuccess = useCallback(() => {
    setConnectingChannel(null);
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <span className="w-5 h-5 border-2 border-border border-t-brand rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm text-muted-foreground">
          连接渠道并绑定到当前专家，实现跨平台通信。
        </p>
        <p className="text-xs text-muted-foreground mt-1">{t('expertSettings.channelsTotal', { count: connectedCount })}</p>
      </div>

      <div className="space-y-2">
        {PLATFORMS.map((p) => {
          const status = getChannelStatus(p.type);
          const binding = getBinding(p.type);
          const isBoundToMe = binding?.agentId === agentId;
          // 多账号下 "是否连接" 必须按**当前 Agent 自己的**账号判断，不能用全局
          // 第一个 feishu adapter 的状态，否则 Agent B 会误操作 Agent A 的应用。
          const isConnected = isBoundToMe && status?.status === 'connected';
          // 多账号并存后，其他 Agent 用的只是另一个飞书应用，不阻塞本专家连自己的账号
          const isBoundToOther = false;
          const isShowingForm = connectingChannel === p.type;

          return (
            <div key={p.type} className="rounded-xl border transition-colors overflow-hidden">
              {/* 平台行 */}
              <div
                className={`flex items-center gap-3 px-4 py-3 ${
                  isBoundToMe
                    ? 'border-success/30 bg-success/10/50'
                    : isBoundToOther
                      ? 'border-warning/30 bg-warning/10/30'
                      : 'border-border'
                }`}
              >
                <img src={p.logo} alt={p.name} className="w-8 h-8 object-contain shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-foreground">{p.name}</p>
                    {isBoundToMe && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium bg-success/15 text-success rounded-full">
                        已绑定到此专家
                      </span>
                    )}
                    {isBoundToOther && (
                      <span className="px-1.5 py-0.5 text-[10px] font-medium bg-warning/15 text-warning rounded-full">
                        已绑定到 {binding?.agentName ?? '其他专家'}
                      </span>
                    )}
                  </div>
                  {isConnected && !isBoundToMe && !isBoundToOther && (
                    <p className="text-xs text-success">{t('expertSettings.channelConnected')}</p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {isBoundToMe ? (
                    <>
                      {/* 飞书支持不断开直接编辑配置；其他渠道暂时按旧逻辑 */}
                      {p.type === 'feishu' && (
                        <button
                          onClick={() =>
                            setConnectingChannel(isShowingForm ? null : p.type)
                          }
                          className="px-3 py-1.5 text-xs font-medium text-brand border border-brand/30
                            rounded-lg hover:bg-brand/5 transition-colors"
                        >
                          {isShowingForm ? '取消' : '编辑配置'}
                        </button>
                      )}
                      <button
                        onClick={() => handleUnbind(p.type)}
                        className="px-3 py-1.5 text-xs font-medium text-danger border border-danger/30
                          rounded-lg hover:bg-danger/10 transition-colors"
                      >
                        解绑
                      </button>
                    </>
                  ) : isConnected && isBoundToOther ? (
                    <span className="text-xs text-muted-foreground">{t('expertSettings.channelInUse')}</span>
                  ) : isConnected ? (
                    <button
                      onClick={() => handleDisconnect(p.type)}
                      className="px-3 py-1.5 text-xs font-medium text-danger border border-danger/30
                        rounded-lg hover:bg-danger/10 transition-colors"
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
                    <InlineFeishuConnect
                      agentId={agentId}
                      isBound={isBoundToMe}
                      accountId={binding?.accountId ?? undefined}
                      onConnect={handleConnectSuccess}
                    />
                  )}
                  {p.type === 'wecom' && (
                    <InlineWecomConnect agentId={agentId} onConnect={handleConnectSuccess} />
                  )}
                  {(p.type === 'dingtalk' || p.type === 'qq') && (
                    <div className="p-3 bg-muted rounded-xl">
                      <p className="text-xs text-muted-foreground text-center">{t('expertSettings.channelComingSoon')}</p>
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
  const { t } = useTranslation();
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
        <span className="w-5 h-5 border-2 border-border border-t-brand rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {skills.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-12 h-12 rounded-2xl bg-accent flex items-center justify-center mb-3">
            <Sparkles className="w-6 h-6 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
          </div>
          <p className="text-sm text-muted-foreground mb-1">{t('expertSettings.skillsEmpty')}</p>
          <p className="text-xs text-muted-foreground mb-4">{t('expertSettings.skillsEmptyHint')}</p>
          <button className="px-4 py-2 text-sm font-medium text-brand border border-brand/30
            rounded-lg hover:bg-brand/5 transition-colors">
            去技能商店
          </button>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">
            管理当前专家可使用的技能，关闭后该专家将不会调用对应技能。
          </p>
          <div className="space-y-2">
            {skills.map((skill) => (
              <div key={skill.name} className="flex items-center gap-3 px-4 py-3 rounded-xl border border-border">
                <div className="w-8 h-8 rounded-lg bg-accent flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">{skill.name}</p>
                  {skill.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{skill.description}</p>
                  )}
                </div>
                <button
                  onClick={() => toggleSkill(skill.name, !skill.enabled)}
                  disabled={toggling === skill.name}
                  className={`w-10 h-6 rounded-full transition-colors relative shrink-0 ${
                    skill.enabled ? 'bg-brand' : 'bg-accent'
                  } ${toggling === skill.name ? 'opacity-50' : ''}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 bg-card rounded-full shadow transition-transform ${
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

// ─── 自动化标签页（只读状态面板） ───

function AutomationTab({ agentId }: { agentId: string }) {
  const { t } = useTranslation();
  const [heartbeat, setHeartbeat] = useState<HeartbeatConfig>({
    intervalMinutes: 30,
    activeHours: { start: '08:00', end: '22:00' },
    enabled: true,
  });
  const [cronJobs, setCronJobs] = useState<CronJobConfig[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [hbRes, cronRes] = await Promise.all([
        get<{ config: HeartbeatConfig }>(`/evolution/${agentId}/heartbeat`),
        get<{ jobs: CronJobConfig[] }>(`/cron?agentId=${agentId}`),
      ]);
      setHeartbeat(hbRes.config);
      setCronJobs(cronRes.jobs);
    } catch { /* 容错 */ }
    finally { setLoading(false); }
  }, [agentId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  if (loading) {
    return <div className="text-center text-muted-foreground mt-10"><p className="text-sm">{t('expertSettings.loading')}</p></div>;
  }

  return (
    <div className="space-y-5">
      {/* 心跳状态 */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-2">💓 {t('expertSettings.tabAutomation')}</h3>
        <div className="p-3 bg-muted rounded-lg space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t('expertSettings.autoStatus')}</span>
            <span className="text-xs font-medium text-success">{t('expertSettings.autoStatusRunning')}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t('expertSettings.autoInterval')}</span>
            <span className="text-xs text-foreground">{t('expertSettings.autoIntervalUnit', { minutes: heartbeat.intervalMinutes })}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t('expertSettings.autoActiveHours')}</span>
            <span className="text-xs text-foreground">{heartbeat.activeHours.start} - {heartbeat.activeHours.end}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{t('expertSettings.autoAlertDelivery')}</span>
            <span className="text-xs text-foreground">
              {heartbeat.target === 'last' ? '最近渠道' : heartbeat.target === 'none' || !heartbeat.target ? '不投递' : heartbeat.target}
            </span>
          </div>
        </div>
      </div>

      <div className="border-t border-border" />

      {/* 定时任务列表 */}
      <div>
        <h3 className="text-sm font-medium text-foreground mb-2">⏰ {t('nav.cron')}</h3>
        {cronJobs.length === 0 ? (
          <div className="p-3 bg-muted rounded-lg">
            <p className="text-xs text-muted-foreground text-center">{t('expertSettings.autoCronEmpty')}</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {cronJobs.map((job) => (
              <div key={job.id} className="px-3 py-2 rounded-lg bg-muted">
                <p className="text-sm font-medium text-foreground truncate">{job.name}</p>
                <p className="text-xs text-muted-foreground truncate">
                  <span className="font-mono">{job.cronExpression}</span>
                  {' · '}{job.actionType === 'event' ? '事件注入' : '独立执行'}
                  {' · '}{job.enabled ? t('cronPage.enabled') : t('cronPage.paused')}
                  {job.nextRunAt && ` · 下次: ${parseUtcDate(job.nextRunAt).toLocaleString()}`}
                </p>
              </div>
            ))}
          </div>
        )}
        <p className="text-xs text-muted-foreground mt-2">
          {t('expertSettings.autoCronTipHint')}
        </p>
      </div>
    </div>
  );
}

// ─── 设置标签页 ───

function SettingsTab({ agentId }: { agentId: string }) {
  const { t } = useTranslation();
  const { agents, updateAgent, fetchWorkspaceFiles, updateWorkspaceFile } = useAgentStore();
  const agent = agents.find((a) => a.id === agentId);

  const [editName, setEditName] = useState(agent?.name ?? '');
  const [editEmoji, setEditEmoji] = useState(agent?.emoji ?? '');
  // M13 修改组 3：协调者标志（配置驱动 — 团队协作 prompt 自动拼装）
  const [editIsCoordinator, setEditIsCoordinator] = useState(agent?.isTeamCoordinator === true);
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
      setEditIsCoordinator(agent.isTeamCoordinator === true);
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

  /**
   * 即时保存指定字段（M13 修改组 3 — UX 优化：去掉"保存修改"按钮）
   *
   * 触发时机：
   *   - name / emoji 输入框 onBlur（失焦时与原值不同才保存）
   *   - 协调者 checkbox onChange（勾选立即保存）
   * 失败回滚：把本地 state 还原回服务端原值，避免 UI/DB 不一致
   */
  const persistField = useCallback(
    async (patch: { name?: string; emoji?: string; isTeamCoordinator?: boolean }, label: string) => {
      setSaving(true);
      try {
        await updateAgent(agentId, patch);
        showSaved(label);
      } catch (err) {
        console.error('保存失败:', err);
        // 失败时把 local state 拉回 agent 真实值
        if (agent) {
          if (patch.name !== undefined) setEditName(agent.name);
          if (patch.emoji !== undefined) setEditEmoji(agent.emoji);
          if (patch.isTeamCoordinator !== undefined) setEditIsCoordinator(agent.isTeamCoordinator === true);
        }
      }
      setSaving(false);
    },
    [agentId, agent, updateAgent, showSaved],
  );

  const handleNameBlur = useCallback(() => {
    if (!agent || editName === agent.name) return;
    if (editName.trim() === '') {
      // 空名字不保存，回退
      setEditName(agent.name);
      return;
    }
    void persistField({ name: editName }, '名称已保存');
  }, [agent, editName, persistField]);

  const handleEmojiBlur = useCallback(() => {
    if (!agent || editEmoji === agent.emoji) return;
    void persistField({ emoji: editEmoji }, 'Emoji 已保存');
  }, [agent, editEmoji, persistField]);

  const handleCoordinatorChange = useCallback(
    (checked: boolean) => {
      setEditIsCoordinator(checked);
      void persistField(
        { isTeamCoordinator: checked },
        checked ? '已设为本群协调中心' : '已取消协调中心',
      );
    },
    [persistField],
  );

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

  return (
    <div className="space-y-6">
      {/* 基本信息 */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('expertSettings.settingsBasic')}</h4>
          {savedHint && (
            <span className="text-xs text-success animate-pulse">{savedHint}</span>
          )}
        </div>

        <div className="flex gap-3">
          <div className="w-20">
            <label className="block text-xs font-medium text-muted-foreground mb-1">Emoji</label>
            <input
              value={editEmoji}
              onChange={(e) => setEditEmoji(e.target.value)}
              onBlur={handleEmojiBlur}
              disabled={saving}
              className="w-full px-2 py-2 text-xl text-center border border-border rounded-lg
                bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand
                disabled:opacity-50"
              maxLength={4}
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs font-medium text-muted-foreground mb-1">{t('expertSettings.settingsName')}</label>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onBlur={handleNameBlur}
              disabled={saving}
              className="w-full px-3 py-2 text-sm border border-border rounded-lg
                bg-card text-foreground
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand
                disabled:opacity-50"
            />
          </div>
        </div>

        {/* M13 修改组 3：协调者 toggle — 即时保存（勾选立刻生效，无需保存按钮） */}
        <div className="pt-3 border-t border-border">
          <label className="flex items-start gap-2.5 cursor-pointer group">
            <input
              type="checkbox"
              checked={editIsCoordinator}
              onChange={(e) => handleCoordinatorChange(e.target.checked)}
              disabled={saving}
              className="mt-0.5 h-4 w-4 rounded border-border text-brand
                focus-visible:ring-2 focus-visible:ring-brand/40 cursor-pointer disabled:opacity-50"
            />
            <div className="flex-1">
              <span className="text-xs font-medium text-foreground group-hover:text-foreground">
                作为本群组协调中心
              </span>
              <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">
                开启后，群里其他 Agent 会被引导通过 @ 本 Agent 协调跨角色任务。适合 PM、组长、客服派单员、辩论主持人等中心节点角色；扁平协作团队请保持关闭。
              </p>
            </div>
          </label>
        </div>
      </div>

      {/* 工作区文件 */}
      <div className="space-y-3">
        <div>
          <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t('expertSettings.settingsWorkspaceFiles')}</h4>
          <p className="text-xs text-muted-foreground mt-1">{t('expertSettings.settingsWorkspaceFilesDesc')}</p>
        </div>

        {filesLoading ? (
          <div className="flex items-center justify-center py-6">
            <span className="w-4 h-4 border-2 border-border border-t-brand rounded-full animate-spin" />
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
                    bg-muted hover:bg-accent transition-colors group"
                >
                  <span className="text-sm">{meta.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium text-foreground">{meta.label}</span>
                      {!meta.editable && (
                        <span className="text-[10px] text-muted-foreground bg-accent/60 px-1.5 py-0.5 rounded-full">
                          运行时
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {charCount > 0 ? `${meta.desc} · ${charCount} 字` : meta.desc}
                      {mtimes[filename] && <span className="ml-1.5 text-muted-foreground">· {formatDateTime(mtimes[filename])}</span>}
                    </p>
                  </div>
                  {/* 编辑/查看图标 */}
                  <span className="text-muted-foreground group-hover:text-muted-foreground transition-colors shrink-0">
                    {meta.editable ? (
                      <Pencil className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
                    ) : (
                      <Eye className="w-4 h-4" strokeWidth={1.5} aria-hidden="true" />
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
            <div className="relative w-[90vw] max-w-3xl h-[80vh] bg-card rounded-2xl shadow-2xl flex flex-col">
              {/* 头部 */}
              <div className="shrink-0 flex items-center justify-between px-5 py-3.5 border-b border-border gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-lg shrink-0">{meta.icon}</span>
                  <h3 className="text-sm font-bold text-foreground whitespace-nowrap">{meta.label}</h3>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">{modalFile}</span>
                  {!meta.editable && (
                    <span className="text-[10px] text-muted-foreground bg-accent/60 px-1.5 py-0.5 rounded-full whitespace-nowrap">{t('expertSettings.settingsReadOnly')}</span>
                  )}
                  {mtimes[modalFile] && (
                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">{formatDateTime(mtimes[modalFile])}</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {meta.editable && (
                    <button
                      onClick={handleModalSave}
                      disabled={modalSaving || !isDirty}
                      className={`px-4 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                        isDirty
                          ? 'text-white bg-brand hover:bg-brand-hover'
                          : 'text-muted-foreground bg-accent'
                      } disabled:opacity-60`}
                    >
                      {modalSaving ? '保存中...' : isDirty ? '保存' : '未修改'}
                    </button>
                  )}
                  <button
                    onClick={() => !modalSaving && setModalFile(null)}
                    aria-label={t('common.close')}
                    className="w-7 h-7 flex items-center justify-center rounded-lg
                      hover:bg-accent transition-colors text-muted-foreground hover:text-muted-foreground"
                  >
                    <XIcon className="w-4 h-4" strokeWidth={2} aria-hidden="true" />
                  </button>
                </div>
              </div>
              {/* 内容 */}
              <div className="flex-1 overflow-hidden p-4">
                {meta.editable ? (
                  <textarea
                    value={modalContent}
                    onChange={(e) => setModalContent(e.target.value)}
                    className="w-full h-full px-4 py-3 text-sm font-mono text-foreground bg-muted border border-border
                      rounded-xl resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:border-brand
                      leading-relaxed"
                    autoFocus
                  />
                ) : (
                  <pre className="w-full h-full px-4 py-3 text-sm font-mono text-muted-foreground bg-muted border border-border
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
  const { t } = useTranslation();
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
          className={`absolute top-0 right-0 w-[480px] h-full bg-card shadow-xl
            flex flex-col transition-transform duration-300 ease-out ${
            isOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          {/* Header */}
          <div className="shrink-0 flex items-center justify-between px-5 py-4 border-b border-border">
            <div className="flex items-center gap-2">
              <SettingsIcon className="w-5 h-5 text-muted-foreground" strokeWidth={1.5} aria-hidden="true" />
              <h2 className="text-base font-bold text-foreground">{t('expertSettings.panelTitle')}</h2>
            </div>
            <button
              onClick={onClose}
              aria-label={t('common.close')}
              className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground hover:text-muted-foreground"
            >
              <XIcon className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
            </button>
          </div>

          {/* Agent 信息 */}
          <div className="shrink-0 px-5 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <AgentAvatar name={agent.name} size="lg" />
              <div className="flex-1 min-w-0">
                <h3 className="text-sm font-bold text-foreground truncate">{agent.name}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {agent.status === 'active' ? t('expertSettings.statusActive') : agent.status === 'draft' ? t('expertSettings.statusDraft') : agent.status}
                </p>
              </div>
              {/* 更多菜单 */}
              <div className="relative" ref={menuRef}>
                <button
                  onClick={() => setShowMenu(!showMenu)}
                  aria-label={t('expertSettings.menuEditExpert')}
                  aria-haspopup="menu"
                  aria-expanded={showMenu}
                  className="p-1.5 rounded-lg hover:bg-accent transition-colors text-muted-foreground"
                >
                  <MoreVertical className="w-5 h-5" strokeWidth={2} aria-hidden="true" />
                </button>
                {showMenu && (
                  <div className="absolute right-0 top-full mt-1 w-36 bg-card
                    border border-border rounded-xl shadow-lg z-10 py-1 overflow-hidden"
                  >
                    <button
                      onClick={() => { setShowMenu(false); setActiveTab('settings'); }}
                      className="w-full text-left px-4 py-2 text-sm text-foreground
                        hover:bg-muted transition-colors"
                    >
                      {t('expertSettings.menuEditExpert')}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Tab 栏 */}
          <div className="shrink-0 flex border-b border-border px-5">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-3 text-sm font-medium transition-colors relative ${
                  activeTab === tab.id
                    ? 'text-brand'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {t(tab.labelKey)}
                {activeTab === tab.id && (
                  <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-brand rounded-full" />
                )}
              </button>
            ))}
          </div>

          {/* Tab 内容 — key={agentId} 确保切换 Agent 时子组件重新挂载，
              清掉上一个 Agent 残留的本地 state（如渠道展开表单、输入框内容）。*/}
          <div key={agentId} className="flex-1 overflow-y-auto px-5 py-4">
            {activeTab === 'channels' && <ChannelsTab agentId={agentId} />}
            {activeTab === 'skills' && <SkillsTab agentId={agentId} />}
            {activeTab === 'automation' && <AutomationTab agentId={agentId} />}
            {activeTab === 'settings' && <SettingsTab agentId={agentId} />}
          </div>
        </div>
      </div>
    </>
  );
}
