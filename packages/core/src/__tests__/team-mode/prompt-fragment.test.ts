/**
 * prompt-fragment 单测（M13 修复 — 问题 2）
 *
 * 覆盖：
 *   - 空入参（无 roster / 无 task / 无 plan）→ 返回 null
 *   - 仅有 active_plans 也注入（防 PM 二次唤醒看不到 plan）
 *   - <active_plans> 渲染：进度计数、依赖、状态图标、"你的任务"标记、"plan 创建者"标记
 *   - <rules> 含新增的 3 条（重述 WBS / peer @ / 双 @ 提醒）
 *   - 不再注入 emoji（前次修复回归）
 */

import { describe, it, expect } from 'vitest';
import { renderTeamModePrompt } from '../../agent/team-mode/prompt-fragment.js';
import type { PeerBotInfo, TaskPlanSnapshot } from '../../channel/team-mode/team-channel.js';

function makePeer(agentId: string, name: string, isCoordinator = false): PeerBotInfo {
  return {
    agentId,
    mentionId: `ou_${agentId}`,
    name,
    emoji: '🤖',
    role: 'general',
    isCoordinator,
  };
}

function makePlan(overrides: Partial<TaskPlanSnapshot> = {}): TaskPlanSnapshot {
  return {
    id: 'plan-uuid',
    groupSessionKey: 'feishu:chat:oc_x',
    channelType: 'feishu',
    goal: '健康领域 H5 商城首页',
    status: 'active',
    tasks: [
      {
        id: 'task-1',
        localId: 't1',
        title: '需求梳理',
        assignee: { agentId: 'a-prod', name: '产品经理', emoji: '📈' },
        status: 'done',
        dependsOn: [],
        artifacts: [],
      },
      {
        id: 'task-2',
        localId: 't2',
        title: 'UI 设计',
        assignee: { agentId: 'a-ui', name: 'UI/UX设计师', emoji: '🎨' },
        status: 'in_progress',
        dependsOn: ['t1'],
        artifacts: [],
      },
      {
        id: 'task-3',
        localId: 't3',
        title: '架构设计',
        assignee: { agentId: 'a-arch', name: '系统架构师', emoji: '🏗️' },
        status: 'pending',
        dependsOn: ['t1'],
        artifacts: [],
      },
    ],
    createdBy: { agentId: 'a-pm', name: '项目经理', emoji: '🤖' },
    createdAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

describe('renderTeamModePrompt', () => {
  it('roster + tasks + active_plans 全空 → 返回 null', () => {
    const result = renderTeamModePrompt({
      channelType: 'feishu',
      groupSessionKey: 'feishu:chat:oc_x',
      roster: [],
      myOpenTasks: [],
    });
    expect(result).toBeNull();
  });

  it('仅有 active_plans 也要注入（PM 二次唤醒场景）', () => {
    const result = renderTeamModePrompt({
      channelType: 'feishu',
      groupSessionKey: 'feishu:chat:oc_x',
      roster: [],
      myOpenTasks: [],
      activePlans: [makePlan()],
      myAgentId: 'a-pm',
    });
    expect(result).not.toBeNull();
    expect(result).toContain('<active_plans>');
    expect(result).toContain('健康领域 H5 商城首页');
  });

  it('<active_plans> 渲染进度计数 + 状态图标', () => {
    const result = renderTeamModePrompt({
      channelType: 'feishu',
      groupSessionKey: 'feishu:chat:oc_x',
      roster: [makePeer('a-prod', '产品经理')],
      myOpenTasks: [],
      activePlans: [makePlan()],
      myAgentId: 'a-pm',
    });
    // 进度：1/3 done · 1 in_progress
    expect(result).toContain('1/3 done');
    expect(result).toContain('1 in_progress');
    // 状态图标
    expect(result).toContain('✅'); // t1 done
    expect(result).toContain('🚧'); // t2 in_progress
    expect(result).toContain('⏳'); // t3 pending
    // 依赖关系
    expect(result).toContain('(依赖 t1)');
  });

  it('<active_plans> 标注当前 agent 的角色（plan 创建者）', () => {
    const result = renderTeamModePrompt({
      channelType: 'feishu',
      groupSessionKey: 'feishu:chat:oc_x',
      roster: [makePeer('a-prod', '产品经理')],
      myOpenTasks: [],
      activePlans: [makePlan()],
      myAgentId: 'a-pm', // PM 是 plan 创建者
    });
    expect(result).toContain('plan 创建者');
    expect(result).toContain('兜底责任人');
  });

  it('<active_plans> 标注当前 agent 名下任务（assignee 视角）', () => {
    const result = renderTeamModePrompt({
      channelType: 'feishu',
      groupSessionKey: 'feishu:chat:oc_x',
      roster: [makePeer('a-pm', '项目经理')],
      myOpenTasks: [],
      activePlans: [makePlan()],
      myAgentId: 'a-prod', // 产品经理视角
    });
    expect(result).toContain('👈 你的任务'); // t1 是产品经理的
    expect(result).toContain('分管 t1');
  });

  it('<active_plans> 当前 agent 不在 plan 中 → 提醒别抢活', () => {
    const result = renderTeamModePrompt({
      channelType: 'feishu',
      groupSessionKey: 'feishu:chat:oc_x',
      roster: [makePeer('a-pm', '项目经理')],
      myOpenTasks: [],
      activePlans: [makePlan()],
      myAgentId: 'a-stranger', // 不在 plan 任务里
    });
    expect(result).toContain('（你不在本计划中——别抢活）');
  });

  it('<rules> 通用守则始终注入（不预设 task_plan）', () => {
    const result = renderTeamModePrompt({
      channelType: 'feishu',
      groupSessionKey: 'feishu:chat:oc_x',
      roster: [makePeer('a-prod', '产品经理')],
      myOpenTasks: [],
      // 不传 activePlans
    });
    // 通用守则
    expect(result).toContain('只处理你被 @ 的任务');
    expect(result).toContain('mention_peer 工具');
    expect(result).toContain('team_roster 里同事的 role');
    expect(result).toMatch(/同事 Agent @ 你的消息不是新任务/);
    // 注：之前的"被同事 @ 时必须 @ 回提问者"已删除——
    // 协议层 reply-to 兜底（applyAtFallbackPrefix）替代了 prompt 教导
    expect(result).not.toMatch(/被同事 @ 时必须 @ 回提问者/);
    expect(result).not.toContain('未 @ 的 bot 收不到推送');
    // M13 修改组 2：peer @ 允许 NO_REPLY 配套引导
    expect(result).toMatch(/peer mention.*NO_REPLY/s);
    // task_plan 专用守则不应出现（无 plan / 无 task）
    expect(result).not.toContain('禁止再 createPlan');
    expect(result).not.toContain('update_task_status');
    expect(result).not.toContain('request_clarification');
  });

  it('<rules> 仅在有 active_plans 时注入 createPlan 守则', () => {
    const result = renderTeamModePrompt({
      channelType: 'feishu',
      groupSessionKey: 'feishu:chat:oc_x',
      roster: [makePeer('a-prod', '产品经理')],
      myOpenTasks: [],
      activePlans: [makePlan()],
      myAgentId: 'a-pm',
    });
    expect(result).toMatch(/已存在覆盖当前用户请求的 plan 时.*禁止再 createPlan/);
  });

  it('<rules> 仅在有 my_open_tasks 时注入 update_task_status 守则', () => {
    const result = renderTeamModePrompt({
      channelType: 'feishu',
      groupSessionKey: 'feishu:chat:oc_x',
      roster: [makePeer('a-prod', '产品经理')],
      myOpenTasks: [
        { localId: 't1', title: 'PRD', status: 'in_progress', dependsOn: [] },
      ],
    });
    expect(result).toContain('update_task_status');
    expect(result).toContain('request_clarification');
    expect(result).toContain('needs_help');
    // M13 修复：工具熔断 → blocked 上报引导
    expect(result).toMatch(/工具调用被熔断.*update_task_status\('blocked'/);
    // active_plans 没传 → createPlan 守则不应出现
    expect(result).not.toContain('禁止再 createPlan');
  });

  it('不再注入 emoji 字符到 <peer>（前次回归保证）', () => {
    const result = renderTeamModePrompt({
      channelType: 'feishu',
      groupSessionKey: 'feishu:chat:oc_x',
      roster: [makePeer('a-prod', '产品经理')],
      myOpenTasks: [],
    });
    expect(result).toContain('产品经理');
    expect(result).not.toContain('🤖 产品经理'); // emoji+name 紧贴的格式不应出现
  });

  it('多个 active plan 全部渲染', () => {
    const plan2 = makePlan({
      id: 'plan-2',
      goal: '另一个 plan',
      tasks: [{
        id: 'task-x',
        localId: 'x1',
        title: '任务 X',
        assignee: { agentId: 'a-prod', name: '产品经理', emoji: '📈' },
        status: 'pending',
        dependsOn: [],
        artifacts: [],
      }],
    });
    const result = renderTeamModePrompt({
      channelType: 'feishu',
      groupSessionKey: 'feishu:chat:oc_x',
      roster: [makePeer('a-prod', '产品经理')],
      myOpenTasks: [],
      activePlans: [makePlan(), plan2],
      myAgentId: 'a-pm',
    });
    expect(result).toContain('健康领域 H5 商城首页');
    expect(result).toContain('另一个 plan');
  });

  // ─── M13 修改组 3：协调者配置驱动 prompt ─────────────────────────
  it('myIsCoordinator=true → 注入 <my_coordination_role>', () => {
    const result = renderTeamModePrompt({
      channelType: 'feishu',
      groupSessionKey: 'feishu:chat:oc_x',
      roster: [makePeer('a-prod', '产品经理'), makePeer('a-ui', 'UI/UX')],
      myOpenTasks: [],
      myIsCoordinator: true,
    });
    expect(result).toContain('<my_coordination_role>');
    expect(result).toContain('你是本群的协调中心');
    // 同事视角不应出现（自己是协调者；roster 里没人 isCoordinator=true）
    expect(result).not.toContain('<team_coordinator>');
  });

  it('roster 里有同事 isCoordinator → 注入 <team_coordinator>，自己不是协调者', () => {
    const result = renderTeamModePrompt({
      channelType: 'feishu',
      groupSessionKey: 'feishu:chat:oc_x',
      roster: [
        makePeer('a-pm', '项目经理', true), // 协调者
        makePeer('a-ui', 'UI/UX', false),
      ],
      myOpenTasks: [],
      myIsCoordinator: false,
    });
    expect(result).toContain('<team_coordinator>');
    expect(result).toContain('项目经理');
    expect(result).toContain('a-pm');
    expect(result).toContain('跨角色对接');
    // 自己不是协调者 → 自身视角不注入
    expect(result).not.toContain('<my_coordination_role>');
  });

  it('多个同事都开了 isCoordinator → 全部列在 <team_coordinator> 里', () => {
    const result = renderTeamModePrompt({
      channelType: 'feishu',
      groupSessionKey: 'feishu:chat:oc_x',
      roster: [
        makePeer('a-c1', '协调者一号', true),
        makePeer('a-c2', '协调者二号', true),
        makePeer('a-ui', 'UI/UX', false),
      ],
      myOpenTasks: [],
      myIsCoordinator: false,
    });
    expect(result).toContain('协调者一号');
    expect(result).toContain('协调者二号');
    expect(result).toContain('a-c1');
    expect(result).toContain('a-c2');
  });

  it('群里没人是协调者 → 平行协作模式，两段都不注入', () => {
    const result = renderTeamModePrompt({
      channelType: 'feishu',
      groupSessionKey: 'feishu:chat:oc_x',
      roster: [
        makePeer('a-prod', '产品经理'),
        makePeer('a-ui', 'UI/UX'),
      ],
      myOpenTasks: [],
      myIsCoordinator: false,
    });
    expect(result).not.toContain('<my_coordination_role>');
    expect(result).not.toContain('<team_coordinator>');
  });

  // ─── M13 Roster 驱动懒加载 ─────────────────────────────────────
  describe('M13 工作流懒加载', () => {
    it('协调者 + teamWorkflow 为空 → 注入 <workflow_bootstrap_required>，禁止直接 createPlan', () => {
      const result = renderTeamModePrompt({
        channelType: 'feishu',
        groupSessionKey: 'feishu:chat:oc_x',
        roster: [makePeer('a-prod', '产品经理'), makePeer('a-ui', 'UI/UX')],
        myOpenTasks: [],
        myIsCoordinator: true,
        // myTeamWorkflow 不传
      });
      expect(result).toContain('<workflow_bootstrap_required>');
      expect(result).toContain('禁止调 create_task_plan');
      expect(result).toContain('propose_team_workflow');
      expect(result).toContain('看 <team_roster>');
      // 不应同时注入 workflow_template
      expect(result).not.toContain('<workflow_template>');
    });

    it('协调者 + teamWorkflow 已设置 → 注入 <workflow_template> 不再注 bootstrap', () => {
      const result = renderTeamModePrompt({
        channelType: 'feishu',
        groupSessionKey: 'feishu:chat:oc_x',
        roster: [makePeer('a-prod', '产品经理'), makePeer('a-ui', 'UI/UX')],
        myOpenTasks: [],
        myIsCoordinator: true,
        myTeamWorkflow: {
          whenToUse: '产品功能/页面/系统类需求',
          phases: [
            {
              name: '需求',
              roleHints: ['产品经理'],
              expectedArtifactKinds: ['markdown'],
              description: '产品经理产出 PRD',
            },
            {
              name: '视觉',
              roleHints: ['UI/UX'],
              expectedArtifactKinds: ['image', 'file'],
              description: 'UI/UX 出视觉稿',
            },
          ],
          createdAt: '2026-04-28T01:00:00.000Z',
        },
      });
      expect(result).toContain('<workflow_template>');
      expect(result).toContain('适用场景：产品功能/页面/系统类需求');
      expect(result).toContain('1. 需求');
      expect(result).toContain('角色 [产品经理]');
      expect(result).toContain('产出 [markdown]');
      expect(result).toContain('2. 视觉');
      expect(result).toContain('产出 [image,file]');
      // bootstrap 已隐去
      expect(result).not.toContain('<workflow_bootstrap_required>');
    });

    it('非协调者 → bootstrap 和 template 都不注入（PM-agnostic）', () => {
      const result = renderTeamModePrompt({
        channelType: 'feishu',
        groupSessionKey: 'feishu:chat:oc_x',
        roster: [makePeer('a-prod', '产品经理')],
        myOpenTasks: [],
        myIsCoordinator: false,
        myTeamWorkflow: {
          whenToUse: 'should not show',
          phases: [
            { name: 'x', roleHints: ['x'], expectedArtifactKinds: ['markdown'], description: 'x' },
          ],
          createdAt: '2026-04-28T01:00:00.000Z',
        },
      });
      expect(result).not.toContain('<workflow_bootstrap_required>');
      expect(result).not.toContain('<workflow_template>');
    });

    it('teamWorkflow.phases 为空数组 → 视作未设置，注入 bootstrap', () => {
      const result = renderTeamModePrompt({
        channelType: 'feishu',
        groupSessionKey: 'feishu:chat:oc_x',
        roster: [makePeer('a-prod', '产品经理')],
        myOpenTasks: [],
        myIsCoordinator: true,
        myTeamWorkflow: {
          whenToUse: 'whatever',
          phases: [],
          createdAt: '2026-04-28T01:00:00.000Z',
        },
      });
      expect(result).toContain('<workflow_bootstrap_required>');
      expect(result).not.toContain('<workflow_template>');
    });

    it('<active_plans> 渲染期望/实际产物对账（已交付）', () => {
      const planWithArtifacts = makePlan({
        tasks: [
          {
            id: 'task-1',
            localId: 't1',
            title: '撰写 PRD',
            assignee: { agentId: 'a-prod', name: '产品经理', emoji: '📈' },
            status: 'done',
            dependsOn: [],
            artifacts: [
              {
                id: 'art-1',
                kind: 'markdown',
                title: 'PRD v1',
                uri: 'evoclaw-artifact://art-1',
                summary: 'H5 商城首页 PRD',
              },
            ],
            expectedArtifactKinds: ['markdown'],
          },
        ],
      });
      const result = renderTeamModePrompt({
        channelType: 'feishu',
        groupSessionKey: 'feishu:chat:oc_x',
        roster: [makePeer('a-prod', '产品经理')],
        myOpenTasks: [],
        activePlans: [planWithArtifacts],
        myAgentId: 'a-pm',
      });
      expect(result).toContain('期望[markdown]');
      expect(result).toContain('实际[markdown ✅]');
    });

    it('<active_plans> 渲染期望/实际产物对账（未交付显示 ⏳）', () => {
      const planMissingArtifact = makePlan({
        tasks: [
          {
            id: 'task-1',
            localId: 't1',
            title: '撰写 PRD',
            assignee: { agentId: 'a-prod', name: '产品经理', emoji: '📈' },
            status: 'in_progress',
            dependsOn: [],
            artifacts: [], // 没产出
            expectedArtifactKinds: ['markdown', 'doc'],
          },
        ],
      });
      const result = renderTeamModePrompt({
        channelType: 'feishu',
        groupSessionKey: 'feishu:chat:oc_x',
        roster: [makePeer('a-prod', '产品经理')],
        myOpenTasks: [],
        activePlans: [planMissingArtifact],
        myAgentId: 'a-pm',
      });
      expect(result).toContain('期望[markdown,doc]');
      expect(result).toContain('实际[markdown ⏳,doc ⏳]');
    });

    it('<active_plans> 任务未声明 expectedArtifactKinds → task 行不渲染对账段（保持中性）', () => {
      const planNoExpectations = makePlan(); // makePlan 默认 task 无 expectedArtifactKinds
      const result = renderTeamModePrompt({
        channelType: 'feishu',
        groupSessionKey: 'feishu:chat:oc_x',
        roster: [makePeer('a-prod', '产品经理')],
        myOpenTasks: [],
        activePlans: [planNoExpectations],
        myAgentId: 'a-pm',
      });
      // task 行（以 "      - t" 开头）不应包含 "期望["
      // 注：rules 段含 "期望[X]" 作示例文本，不算对账渲染
      const taskLines = (result ?? '').split('\n').filter((line) => /^\s*-\s+t\d/.test(line));
      expect(taskLines.length).toBeGreaterThan(0);
      for (const line of taskLines) {
        expect(line).not.toMatch(/期望\[[a-z,]+\]/);
        expect(line).not.toMatch(/实际\[[a-z,✅⏳ ]+\]/);
      }
    });

    it('<rules> 含工作流懒加载新增的 attach_artifact 提醒（hasMyOpenTasks）', () => {
      const result = renderTeamModePrompt({
        channelType: 'feishu',
        groupSessionKey: 'feishu:chat:oc_x',
        roster: [makePeer('a-prod', '产品经理')],
        myOpenTasks: [
          { localId: 't1', title: 'PRD', status: 'in_progress', dependsOn: [] },
        ],
      });
      // M13"先派活后宣告"修复：标准三步 + outputSummary 必填且会被广播
      expect(result).toMatch(/先调 attach_artifact 落盘产物/);
      expect(result).toMatch(/再调 update_task_status\('done'/);
      expect(result).toMatch(/outputSummary 必填且 ≥30 字/);
      expect(result).toMatch(/以你的身份.*自动发到群里告知所有同事/);
    });

    it('<rules> 含工作流懒加载的"虚构产物"提醒（hasActivePlans）', () => {
      const result = renderTeamModePrompt({
        channelType: 'feishu',
        groupSessionKey: 'feishu:chat:oc_x',
        roster: [makePeer('a-prod', '产品经理')],
        myOpenTasks: [],
        activePlans: [makePlan()],
        myAgentId: 'a-pm',
      });
      expect(result).toMatch(/期望.*实际.*对账/);
      expect(result).toMatch(/不要在自己任务描述\/回复里引用那个虚构产物/);
    });
  });
});
