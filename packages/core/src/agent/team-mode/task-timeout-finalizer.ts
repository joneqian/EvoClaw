/**
 * 任务超时收尾责任链（M13 重构）
 *
 * 当 runner idle / wallclock 撞超时时，自动把 sessionKey 关联的 in_progress 任务
 * 标 blocked，避免任务永远卡 in_progress 等 escalation 15 分钟。
 *
 * 责任划分：
 *   - attempt.ts catch 块的 timeout 分支调用本 finalizer
 *   - 非团队模式（sessionKey 不是 group / 无关联 task）直接返回空数组
 *   - 失败抛错由 attempt 自行 try/catch 吞掉，不影响主流程
 *
 * 装配位置：`server.ts` 装配 channel-message-handler 时把 finalizer 注入
 * AgentRunConfig.taskTimeoutFinalizer 字段。
 */

import { createLogger } from '../../infrastructure/logger.js';
import { parseSessionKey } from '../../routing/session-key.js';
import type { TaskPlanService } from './task-plan/service.js';
import type { GroupSessionKey } from '../../channel/team-mode/team-channel.js';

const log = createLogger('task-timeout-finalizer');

export interface TaskTimeoutFinalizerDeps {
  taskPlanService: TaskPlanService;
}

/**
 * 创建 finalizer 闭包，注入到 AgentRunConfig.taskTimeoutFinalizer。
 *
 * 调用时根据 sessionKey 解析出 (assigneeAgentId, groupSessionKey)，
 * 把该 assignee 名下所有 in_progress 任务批量标 blocked。
 */
export function createTaskTimeoutFinalizer(
  deps: TaskTimeoutFinalizerDeps,
): (sessionKey: string, kind: 'idle' | 'wallclock') => Array<{ taskId: string; localId: string }> {
  return (sessionKey: string, kind: 'idle' | 'wallclock') => {
    const parsed = parseSessionKey(sessionKey);
    if (parsed.chatType !== 'group') {
      // 非群聊会话不走团队模式，没有 task_plan 体系
      return [];
    }
    if (!parsed.agentId || !parsed.channel || !parsed.peerId) {
      log.warn(`sessionKey 解析不完整 sessionKey=${sessionKey}`);
      return [];
    }

    // 重组 GroupSessionKey: "<channel>:chat:<chatId>"
    const groupSessionKey = `${parsed.channel}:chat:${parsed.peerId}` as GroupSessionKey;

    let openTasks;
    try {
      openTasks = deps.taskPlanService.listOpenTasksForAssignee(parsed.agentId, groupSessionKey);
    } catch (err) {
      log.warn(`查询 in_progress 任务失败 sessionKey=${sessionKey}: ${err instanceof Error ? err.message : String(err)}`);
      return [];
    }

    // 只标 in_progress 的任务，pending / blocked / needs_help 跳过（它们本身就不是"卡死"状态）
    const targets = openTasks.filter((t) => t.status === 'in_progress');
    if (targets.length === 0) return [];

    const reason = kind === 'idle'
      ? 'runner idle 超时（连续 120s 无新工具调用 / 输出）'
      : 'runner wallclock 超时（总运行时长 30 分钟）';

    const updated: Array<{ taskId: string; localId: string }> = [];
    for (const task of targets) {
      try {
        const result = deps.taskPlanService.updateTaskStatus(
          {
            taskId: task.id,
            status: 'blocked',
            note: reason,
          },
          parsed.agentId,
        );
        if (result.ok) {
          updated.push({ taskId: task.id, localId: task.localId });
        } else {
          log.warn(`task ${task.id} 标 blocked 失败: ${result.reason}`);
        }
      } catch (err) {
        log.warn(`task ${task.id} 标 blocked 抛错: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (updated.length > 0) {
      log.info(
        `${kind} 超时收尾: agent=${parsed.agentId} group=${parsed.peerId} 标 blocked ${updated.length} 个 (${updated.map((t) => t.localId).join(',')})`,
      );
    }
    return updated;
  };
}
