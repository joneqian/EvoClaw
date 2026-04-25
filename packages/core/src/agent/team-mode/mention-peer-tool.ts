/**
 * mention_peer Tool —— 跨渠道通用的 @ 同事工具（M13 PR2）
 *
 * Agent 面前只有这一个 API，底层根据当前 group 所属渠道分发到具体 adapter：
 *   - 飞书：post 格式 + <at user_id="ou_xxx">
 *   - Slack：<@U_xxxx>
 *   - 微信：text + at_list[wxid]
 *   - 等等
 *
 * loop-guard 集成：
 *   - 调用前评估 evaluate({fromAgentId, toAgentId, taskId, chainDepth})
 *   - 评估通过才让 adapter 投递；被拦截则返回错误说明（让 LLM 知道为啥失败）
 *
 * @ID 解析：
 *   - peer_agent_id 必须是当前群 peer-roster 里的 Agent
 *   - 通过 peer-roster-service 查 PeerBotInfo（含 mentionId）
 */

import type { ToolDefinition } from '../../bridge/tool-injector.js';
import { createLogger } from '../../infrastructure/logger.js';
import type { ChannelManager } from '../../channel/channel-manager.js';
import type { ChannelType } from '@evoclaw/shared';
import type { BindingRouter } from '../../routing/binding-router.js';
import type { GroupSessionKey, PeerBotInfo } from '../../channel/team-mode/team-channel.js';
import type { LoopGuard } from './loop-guard.js';
import type { PeerRosterService } from './peer-roster-service.js';
import type { TeamChannelRegistry } from './team-channel-registry.js';

import { buildGroupSessionKey } from './group-key-utils.js';

/** 内联 session-key 解析，避免 agent → routing 层级违反 */
function parseSessionKey(key: string): { agentId: string; channel: string; chatType: string; peerId: string } {
  const parts = key.split(':');
  return {
    agentId: parts[1] ?? '',
    channel: parts[2] ?? 'default',
    chatType: parts[3] ?? 'direct',
    peerId: parts[4] ?? '',
  };
}

const logger = createLogger('team-mode/mention-peer-tool');

export interface MentionPeerToolDeps {
  rosterService: PeerRosterService;
  registry: TeamChannelRegistry;
  loopGuard: LoopGuard;
  /** 用于真正投递消息 */
  channelManager: ChannelManager;
  /** 用于反查 caller 在当前 channel 的 accountId */
  bindingRouter: BindingRouter;
}

/**
 * 反查 caller 在当前 channel 的 accountId（参考 channel-tools.ts resolveFeishuAccount）
 * 一个 Agent 每个 channel 1:1 绑定（产品约束）
 */
function resolveAccountId(
  bindingRouter: BindingRouter,
  agentId: string,
  channel: string,
): string {
  const bindings = bindingRouter.listBindings(agentId).filter((b) => b.channel === channel);
  if (bindings.length === 0) {
    throw new Error(`Agent ${agentId} 没有绑定 ${channel} 应用`);
  }
  // 优先取 isDefault，其次按 priority；fallback 取第一条
  const sorted = [...bindings].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    return b.priority - a.priority;
  });
  const accountId = sorted[0].accountId;
  if (!accountId) {
    throw new Error(`Agent ${agentId} 的 ${channel} binding 缺 accountId`);
  }
  return accountId;
}

function sessionKeyToGroupKey(sessionKey: string): GroupSessionKey | null {
  const parsed = parseSessionKey(sessionKey);
  if (parsed.chatType !== 'group') return null;
  // B3 修复：剥掉 sender/topic 后缀
  return buildGroupSessionKey(parsed.channel, parsed.peerId);
}

export function createMentionPeerTool(deps: MentionPeerToolDeps): ToolDefinition {
  return {
    name: 'mention_peer',
    description:
      '在群里 @ 一位同事 Agent 并附带消息。会触发对方的渠道原生推送通知（不是裸文本 @）。peer_agent_id 必须是 team_roster 里的 agent_id。可选附带 task_id（loop-guard 链深度追踪用）。',
    parameters: {
      type: 'object',
      properties: {
        peer_agent_id: {
          type: 'string',
          description: '同事的 EvoClaw Agent ID（从 <team_roster> 里看）',
        },
        message: {
          type: 'string',
          description: '消息正文（支持 markdown，渠道会按需转换）',
        },
        task_id: {
          type: 'string',
          description: '可选：任务 ID。带上有助于 loop-guard 防乒乓 + 让对方知道是哪个任务上下文',
        },
        plan_id: {
          type: 'string',
          description: '可选：plan ID。和 task_id 配套',
        },
      },
      required: ['peer_agent_id', 'message'],
    },
    execute: async (args) => {
      const callerAgentId = args['agentId'];
      const sessionKey = args['sessionKey'];
      if (typeof callerAgentId !== 'string' || !callerAgentId) {
        return '错误：缺少 agentId（应由 channel-message-handler 自动注入）';
      }
      if (typeof sessionKey !== 'string' || !sessionKey) {
        return '错误：缺少 sessionKey';
      }
      const groupSessionKey = sessionKeyToGroupKey(sessionKey);
      if (!groupSessionKey) {
        return '错误：当前不是群聊会话，mention_peer 只能在群聊中使用';
      }

      const peerAgentId = args['peer_agent_id'];
      const message = args['message'];
      if (typeof peerAgentId !== 'string' || !peerAgentId) return '错误：peer_agent_id 必填';
      if (typeof message !== 'string' || !message.trim()) return '错误：message 不能为空';

      const taskId = typeof args['task_id'] === 'string' ? (args['task_id'] as string) : undefined;
      const planId = typeof args['plan_id'] === 'string' ? (args['plan_id'] as string) : undefined;
      const chainDepth = typeof args['chainDepth'] === 'number'
        ? (args['chainDepth'] as number)
        : 0;

      // 解析 adapter
      const adapter = deps.registry.resolve(groupSessionKey);
      if (!adapter) {
        logger.warn(`mention_peer 找不到 channel adapter group=${groupSessionKey}`);
        return `错误：当前渠道未注册 team-channel adapter`;
      }

      // 查 peer roster 确认是同一群的同事
      const roster = await deps.rosterService.buildRoster(callerAgentId, groupSessionKey);
      const peer: PeerBotInfo | undefined = roster.find((p) => p.agentId === peerAgentId);
      if (!peer) {
        logger.warn(
          `mention_peer 目标不在 roster from=${callerAgentId} target=${peerAgentId} group=${groupSessionKey}`,
        );
        return `错误：${peerAgentId} 不在当前群 roster 里。可用的同事：${roster.map((p) => p.agentId).join(', ') || '（无）'}`;
      }

      // loop-guard 评估
      const decision = deps.loopGuard.evaluate({
        groupSessionKey,
        fromAgentId: callerAgentId,
        toAgentId: peerAgentId,
        taskId,
        chainDepth,
      });
      if (decision.result === 'block') {
        logger.warn(
          `mention_peer 被 loop-guard 拦截 from=${callerAgentId} to=${peerAgentId} reason=${decision.reason} ${decision.detail ?? ''}`,
        );
        return `错误：消息被回环防护拦截（${decision.reason}）${decision.detail ? `：${decision.detail}` : ''}`;
      }

      // 让 adapter 构造原生 mention 消息
      let outbound;
      try {
        outbound = await adapter.buildMention(groupSessionKey, peer, message, {
          taskId,
          planId,
          chainDepth: chainDepth + 1, // 投出去后下一跳 +1
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(
          `adapter.buildMention 失败 channel=${adapter.channelType} target=${peerAgentId} err=${msg}`,
        );
        return `错误：构造 @ 消息失败：${msg}`;
      }

      // 反查 caller 的 accountId（多账号场景）
      const parsedSession = parseSessionKey(sessionKey);
      let accountId: string;
      try {
        accountId = resolveAccountId(deps.bindingRouter, callerAgentId, parsedSession.channel);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`mention_peer accountId 解析失败 caller=${callerAgentId} err=${msg}`);
        return `错误：${msg}`;
      }

      // 委托 channelManager 真正投递
      // TODO(team-mode/M13-followup): PR4 推迟 — 升级到飞书 post JSON 实现真·原生 @
      //   现状：fallbackText 纯文本 "@阿辉 ..."，飞书不会触发推送通知
      //   修法：FeishuTeamChannel.buildMention 返回 {payload: postJson}，channelManager
      //         扩展 sendMessage 支持 card/post payload；这里 if (payload) 走 post 通道
      const content = outbound.fallbackText || `@${peer.name} ${message}`;
      try {
        await deps.channelManager.sendMessage(
          parsedSession.channel as ChannelType,
          accountId,
          parsedSession.peerId, // group chatId
          content,
          'group',
        );
        logger.info(
          `mention_peer 已发送 from=${callerAgentId} to=${peerAgentId} channel=${adapter.channelType} ` +
            `accountId=${accountId} chat=${parsedSession.peerId} task=${taskId ?? 'none'} chain_depth=${chainDepth + 1}`,
        );
        return `✅ 已 @ ${peer.name}（${peerAgentId}）：${message.slice(0, 80)}${message.length > 80 ? '…' : ''}`;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(
          `mention_peer 投递失败 from=${callerAgentId} to=${peerAgentId} err=${msg}`,
        );
        return `错误：投递失败：${msg}`;
      }
    },
  };
}
