/**
 * propose_team_workflow Tool —— 协调者自助生成团队工作流模板（M13 Roster 驱动懒加载）
 *
 * 触发场景：协调者第一次被叫出来时 AgentConfig.teamWorkflow 为空，prompt 注入
 *   `<workflow_bootstrap_required>`，引导协调者：
 *     1. 看 <team_roster> 里同事的 role/capability 推一个工作流候选
 *     2. 把候选发到群里让用户确认/修订
 *     3. **用户敲定后**调本工具落盘到 AgentConfig.teamWorkflow
 *
 * 调用契约：
 *   - 仅 isTeamCoordinator=true 的 Agent 可调；非协调者拒绝（防滥用）
 *   - phases 至少 1 项；每个 phase 必填 name/roleHints/expectedArtifactKinds/description
 *   - artifact kind 仅接受 6 类合法值，过滤后空数组报错（防止水任务模板）
 *   - 不限制 phases 上限，由 LLM 自己判断
 *
 * 落盘后立即生效：下一次该协调者响应时 prompt 渲染 <workflow_template>
 *   而不是 <workflow_bootstrap_required>，协调者按 phases 顺序拆 plan。
 */

import type { ToolDefinition } from '../../../bridge/tool-injector.js';
import type {
  AgentConfig,
  ArtifactKind,
  TeamWorkflowPhase,
  TeamWorkflowTemplate,
} from '@evoclaw/shared';
import type { AgentManager } from '../../agent-manager.js';
import { createLogger } from '../../../infrastructure/logger.js';

const logger = createLogger('team-mode/team-workflow-tools');

const VALID_ARTIFACT_KINDS: ReadonlyArray<ArtifactKind> = [
  'text',
  'markdown',
  'image',
  'file',
  'doc',
  'link',
];

/**
 * 创建 propose_team_workflow 工具
 *
 * @param deps.agentManager  用于落盘 teamWorkflow 配置
 */
export function createProposeTeamWorkflowTool(deps: {
  agentManager: AgentManager;
}): ToolDefinition {
  return {
    name: 'propose_team_workflow',
    description:
      '【仅协调中心专用】把跟用户在群里对话敲定的团队工作流模板落盘到自己的 AgentConfig.teamWorkflow。\n' +
      '调用前必须：(1) 看 <team_roster> 里同事的 role/capability 推一个候选；(2) 把候选发到群里让用户确认/修订；(3) **得到用户明确确认后**才调本工具。\n' +
      '落盘后立即生效，下次响应已能看到 <workflow_template>，可以直接调 create_task_plan 派活。',
    parameters: {
      type: 'object',
      properties: {
        whenToUse: {
          type: 'string',
          description:
            '什么样的需求适用本工作流（自然语言一句话）。例："当用户提产品功能/页面/系统类需求时启用"。给未来的协调者 LLM 看。',
        },
        phases: {
          type: 'array',
          description:
            '工作流阶段顺序链（至少 1 项，越具体越好）。phases 顺序就是 dependsOn 顺序：阶段 N 必依赖阶段 N-1 完成。',
          items: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: '阶段名（中文短语，如 "需求" / "视觉设计" / "架构设计" / "实现"）',
              },
              roleHints: {
                type: 'array',
                description:
                  '该阶段适用的角色关键词（用 roster 里 peer.role 字段的实际词，不要瞎填）。可多个，模糊匹配。例 ["产品经理","PM","product"]。',
                items: { type: 'string' },
              },
              expectedArtifactKinds: {
                type: 'array',
                description:
                  '该阶段任务的预期产物类型（合法值：text/markdown/image/file/doc/link，至少 1 项）。后续派活到本阶段的任务都建议带上这些 kind 作 expectedArtifactKinds。',
                items: { type: 'string', enum: VALID_ARTIFACT_KINDS as unknown as string[] },
              },
              description: {
                type: 'string',
                description: '一句话职责说明（自然语言）。例："产品经理产出 markdown 格式的 PRD"。',
              },
            },
            required: ['name', 'roleHints', 'expectedArtifactKinds', 'description'],
          },
        },
      },
      required: ['whenToUse', 'phases'],
    },
    execute: async (args) => {
      // 1. 校验 caller 是协调者（agentId 由 channel-message-handler 注入）
      const callerAgentId = args['agentId'];
      const initiatorUserId = args['initiatorUserId'];
      if (typeof callerAgentId !== 'string' || !callerAgentId) {
        return '错误：缺少 agentId（应由 channel-message-handler 自动注入）';
      }
      const caller = deps.agentManager.getAgent(callerAgentId);
      if (!caller) return `错误：caller agent 不存在 ${callerAgentId}`;
      if (caller.isTeamCoordinator !== true) {
        logger.warn(
          `非协调者试图调 propose_team_workflow caller=${callerAgentId} name=${caller.name}`,
        );
        return '错误：仅团队协调中心可设置工作流模板。请先在 Agent 设置里勾选"作为本群协调中心"。';
      }

      // 2. 校验 whenToUse / phases 入参
      const whenToUse = args['whenToUse'];
      if (typeof whenToUse !== 'string' || !whenToUse.trim()) {
        return '错误：whenToUse 必填且为字符串（说明本工作流适用于什么类型的需求）';
      }
      const phasesRaw = args['phases'];
      if (!Array.isArray(phasesRaw) || phasesRaw.length === 0) {
        return '错误：phases 至少 1 项';
      }

      // 3. 收紧 phases 入参类型
      const phases: TeamWorkflowPhase[] = [];
      for (let i = 0; i < phasesRaw.length; i++) {
        const p = phasesRaw[i];
        if (typeof p !== 'object' || p === null) {
          return `错误：phases[${i}] 不是对象`;
        }
        const obj = p as Record<string, unknown>;
        const name = obj['name'];
        const description = obj['description'];
        const roleHints = obj['roleHints'];
        const expectedArtifactKinds = obj['expectedArtifactKinds'];

        if (typeof name !== 'string' || !name.trim()) {
          return `错误：phases[${i}].name 必填且为字符串`;
        }
        if (typeof description !== 'string' || !description.trim()) {
          return `错误：phases[${i}].description 必填且为字符串`;
        }
        if (!Array.isArray(roleHints) || roleHints.length === 0) {
          return `错误：phases[${i}].roleHints 至少 1 项`;
        }
        const roleHintsClean = roleHints.filter(
          (x): x is string => typeof x === 'string' && x.trim().length > 0,
        );
        if (roleHintsClean.length === 0) {
          return `错误：phases[${i}].roleHints 全部为空字符串`;
        }
        if (!Array.isArray(expectedArtifactKinds) || expectedArtifactKinds.length === 0) {
          return `错误：phases[${i}].expectedArtifactKinds 至少 1 项`;
        }
        const kindsClean = expectedArtifactKinds.filter(
          (x): x is ArtifactKind =>
            typeof x === 'string' && VALID_ARTIFACT_KINDS.includes(x as ArtifactKind),
        );
        if (kindsClean.length === 0) {
          return `错误：phases[${i}].expectedArtifactKinds 没有合法值（合法：${VALID_ARTIFACT_KINDS.join('/')}）`;
        }

        phases.push({
          name: name.trim(),
          roleHints: roleHintsClean,
          expectedArtifactKinds: kindsClean,
          description: description.trim(),
        });
      }

      // 4. 落盘
      const template: TeamWorkflowTemplate = {
        whenToUse: whenToUse.trim(),
        phases,
        createdAt: new Date().toISOString(),
        ...(typeof initiatorUserId === 'string' && initiatorUserId
          ? { approvedBy: initiatorUserId }
          : {}),
      };
      try {
        deps.agentManager.updateAgent(callerAgentId, {
          teamWorkflow: template,
        } as Partial<Pick<AgentConfig, 'teamWorkflow'>>);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`propose_team_workflow 落盘失败 caller=${callerAgentId} err=${msg}`);
        return `错误：落盘失败 ${msg}`;
      }

      logger.info(
        `propose_team_workflow ok caller=${callerAgentId} name=${caller.name} phases=${phases.length} ` +
          `whenToUse="${template.whenToUse.slice(0, 60)}" approvedBy=${template.approvedBy ?? '(none)'}`,
      );

      // 5. 返回成功摘要 + 引导下一步
      const lines: string[] = [];
      lines.push(`✅ 已落盘团队工作流模板（共 ${phases.length} 阶段）`);
      lines.push(`适用场景：${template.whenToUse}`);
      for (let i = 0; i < phases.length; i++) {
        const ph = phases[i]!;
        lines.push(
          `  ${i + 1}. ${ph.name} — 角色 [${ph.roleHints.join(' / ')}] → 产出 [${ph.expectedArtifactKinds.join(',')}]`,
        );
        lines.push(`     ${ph.description}`);
      }
      lines.push('');
      lines.push('现在可以调 create_task_plan 按 phases 顺序派活了。');
      lines.push('（提醒：派活时为每个 task 填 expectedArtifactKinds，从所属 phase 抄即可。）');
      return lines.join('\n');
    },
  };
}
