/**
 * 团队计划页面 (M13 多 Agent 团队协作 - PR4 占位)
 *
 * 本期只占位路由 + 空壳，Phase 2 落地：
 *   - active / completed / cancelled plan 列表
 *   - DAG 可视化（react-flow）
 *   - artifact 预览
 *   - feature flag 开关
 *
 * 详见 docs/architecture/team-mode-frontend-plan.md
 */

// TODO(team-mode/ui): Phase 2 实现项目看板页
//   - GET /team/plans + GET /team/plans/:id (后端已支持，见 task-plan-service)
//   - WebSocket /team/plans/:id/events 订阅状态变化
//   - DAG 节点点击展开 task 详情 + artifact 列表
//   - artifact 内容预览（image/markdown/file）

export default function PlansPage() {
  return (
    <div className="p-8 text-gray-500 dark:text-gray-400">
      <h1 className="text-2xl font-semibold mb-4">团队计划</h1>
      <p className="text-base">
        多 Agent 团队协作（M13）正在开发中。本期 plan 在飞书群里以
        <code className="mx-1 px-1 bg-gray-100 dark:bg-gray-800 rounded">看板卡片</code>
        形式展示，桌面前端的可视化版本将在下一期上线。
      </p>
      <ul className="mt-4 list-disc pl-6 text-sm">
        <li>用 <code className="px-1 bg-gray-100 dark:bg-gray-800 rounded">create_task_plan</code> 工具拆解任务</li>
        <li>用 <code className="px-1 bg-gray-100 dark:bg-gray-800 rounded">/pause</code> /
          <code className="mx-1 px-1 bg-gray-100 dark:bg-gray-800 rounded">/cancel</code> /
          <code className="px-1 bg-gray-100 dark:bg-gray-800 rounded">/revise</code> 在群里直接打断</li>
        <li>详见 <code className="px-1 bg-gray-100 dark:bg-gray-800 rounded">docs/architecture/team-mode-frontend-plan.md</code></li>
      </ul>
    </div>
  );
}
