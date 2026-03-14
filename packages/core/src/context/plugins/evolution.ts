import type { ContextPlugin, TurnContext } from '../plugin.interface.js';
import type { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { CapabilityGraph } from '../../evolution/capability-graph.js';
import { detectSatisfaction } from '../../evolution/feedback-detector.js';
import { GrowthTracker } from '../../evolution/growth-tracker.js';

/** 创建进化插件（afterTurn 阶段） */
export function createEvolutionPlugin(db: SqliteStore): ContextPlugin {
  const capGraph = new CapabilityGraph(db);
  const tracker = new GrowthTracker(db);

  return {
    name: 'evolution',
    priority: 70,

    async afterTurn(ctx: TurnContext) {
      try {
        // 1. 识别本轮能力维度
        const capabilities = capGraph.detectCapabilities(ctx.messages);
        if (capabilities.length === 0) return;

        // 2. 检测满意度
        const satisfaction = detectSatisfaction(ctx.messages);
        const success = satisfaction.score > 0.5;

        const now = new Date().toISOString();

        // 3. 更新每个检测到的能力
        for (const cap of capabilities) {
          const before = capGraph.getCapabilityGraph(ctx.agentId)
            .find((n) => n.name === cap);
          const beforeLevel = before?.level ?? 0;

          capGraph.updateCapability(ctx.agentId, cap, success);

          const after = capGraph.getCapabilityGraph(ctx.agentId)
            .find((n) => n.name === cap);
          const afterLevel = after?.level ?? 0;

          const delta = afterLevel - beforeLevel;

          // 4. 记录成长事件
          tracker.recordEvent(ctx.agentId, {
            type: beforeLevel === 0 ? 'new_capability' : delta > 0 ? 'capability_up' : 'capability_down',
            capability: cap,
            delta,
            timestamp: now,
          });
        }
      } catch (err) {
        // 进化追踪失败不影响对话流程
        console.error('[evolution] 进化追踪失败:', err);
      }
    },
  };
}
