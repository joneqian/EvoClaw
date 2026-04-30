/**
 * 飞书项目看板卡片渲染（M13 PR3）
 *
 * 当前 PR3 提供两种渲染：
 *   - renderTaskBoardCard(plan): 纯文本（fallback / 测试断言）
 *   - renderTaskBoardCardJson(plan): 飞书 interactive card JSON（手测可见）
 *
 * 暂不接 CardKit streaming，PR4 再做原地更新。本期下游 mention_peer 走 fallbackText
 * 通道，看板卡片仅在 task-plan 创建/状态变化时单发一条。
 */

import type { TaskNodeSnapshot, TaskPlanSnapshot, TaskStatus } from '../../../team-mode/team-channel.js';

const STATUS_ICON: Record<TaskStatus, string> = {
  pending: '⏳',
  in_progress: '🚧',
  done: '✅',
  cancelled: '❌',
  blocked: '🔗',
  needs_help: '🆘',
  blocked_on_clarification: '❓',
  paused: '⏸',
  stalled: '💤',
};

const STALE_BADGE: Record<NonNullable<TaskNodeSnapshot['staleMarker']>, string> = {
  yellow_15min: '🟡 15min+',
  red_30min: '🔴 30min+',
};

/** 纯文本渲染（fallback / 测试 / 不支持卡片的渠道也能复用） */
export function renderTaskBoardCard(plan: TaskPlanSnapshot): string {
  const lines: string[] = [];
  lines.push(`📋 团队项目看板`);
  lines.push(`目标：${plan.goal}`);
  lines.push(`状态：${plan.status}　发起人：${plan.createdBy.emoji} ${plan.createdBy.name}`);
  lines.push(`──────────────`);
  for (const t of plan.tasks) {
    const icon = STATUS_ICON[t.status] ?? '•';
    const stale = t.staleMarker ? `  ${STALE_BADGE[t.staleMarker]}` : '';
    const deps = t.dependsOn.length > 0 ? `（依赖：${t.dependsOn.join('，')}）` : '';
    lines.push(`${icon} ${t.localId} · ${t.title} → ${t.assignee.emoji} ${t.assignee.name}${deps}${stale}`);
    if (t.artifacts.length > 0) {
      const visibleArtifacts = t.artifacts.slice(0, 3); // 看板上每任务最多展 3 件，更多去 list_task_artifacts
      for (const art of visibleArtifacts) {
        lines.push(`   📎 ${art.title} [${art.kind}]`);
      }
      if (t.artifacts.length > 3) {
        lines.push(`   …还有 ${t.artifacts.length - 3} 个产出，用 list_task_artifacts 查看`);
      }
    }
  }
  lines.push(`──────────────`);
  lines.push(`plan_id: ${plan.id}`);
  return lines.join('\n');
}

/**
 * 飞书 interactive 卡片 JSON
 *
 * 卡片格式参考 https://open.feishu.cn/document/uAjLw4CM/ukTMukTMukTM/interactive-card/intro
 * 这里用最小可用结构（header + 正文 div + 任务节点 div），不走 schema 2.0 elements。
 */
export function renderTaskBoardCardJson(plan: TaskPlanSnapshot): unknown {
  const headerColor = planHeaderColor(plan.status);
  return {
    config: { wide_screen_mode: true },
    header: {
      title: { tag: 'plain_text', content: `📋 ${plan.goal}` },
      template: headerColor,
    },
    elements: [
      {
        tag: 'div',
        text: {
          tag: 'lark_md',
          content: [
            `**状态**：${plan.status}　**发起人**：${plan.createdBy.emoji} ${escapeMd(plan.createdBy.name)}`,
            `**plan_id**: \`${plan.id}\``,
          ].join('\n'),
        },
      },
      { tag: 'hr' },
      ...plan.tasks.map((t) => taskNodeBlock(t)),
      { tag: 'hr' },
      {
        tag: 'note',
        elements: [
          {
            tag: 'plain_text',
            content:
              '完成请调 update_task_status；要看产出详情请调 fetch_artifact；要修订请发 /revise <新需求>。',
          },
        ],
      },
    ],
  };
}

function taskNodeBlock(t: TaskNodeSnapshot): unknown {
  const icon = STATUS_ICON[t.status] ?? '•';
  const stale = t.staleMarker ? `  ${STALE_BADGE[t.staleMarker]}` : '';
  const deps = t.dependsOn.length > 0 ? `（依赖 ${t.dependsOn.join('，')}）` : '';
  const lines = [
    `${icon} **${escapeMd(t.localId)}** · ${escapeMd(t.title)}${stale}`,
    `→ ${t.assignee.emoji} ${escapeMd(t.assignee.name)} ${deps}`,
  ];
  if (t.artifacts.length > 0) {
    const visible = t.artifacts.slice(0, 3);
    for (const art of visible) {
      lines.push(`📎 ${escapeMd(art.title)} _[${art.kind}]_`);
    }
    if (t.artifacts.length > 3) {
      lines.push(`…还有 ${t.artifacts.length - 3} 个产出`);
    }
  }
  return {
    tag: 'div',
    text: { tag: 'lark_md', content: lines.join('\n') },
  };
}

function planHeaderColor(status: TaskPlanSnapshot['status']): string {
  switch (status) {
    case 'active': return 'blue';
    case 'paused': return 'yellow';
    case 'completed': return 'green';
    case 'cancelled': return 'grey';
    default: return 'blue';
  }
}

function escapeMd(s: string): string {
  // lark_md 的简易转义（不深究，避免破坏正常字符）
  return s.replace(/\*/g, '\\*').replace(/_/g, '\\_').replace(/`/g, '\\`');
}
