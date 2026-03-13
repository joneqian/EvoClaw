import type { ContextPlugin, BootstrapContext, TurnContext, CompactContext, ShutdownContext } from './plugin.interface.js';
import type { ChatMessage } from '@evoclaw/shared';

/** Token 使用超限阈值 (85%) */
const TOKEN_THRESHOLD = 0.85;

/**
 * ContextEngine — 插件调度引擎
 * 管理多个 ContextPlugin 的生命周期和执行顺序
 */
export class ContextEngine {
  private plugins: ContextPlugin[] = [];

  /** 注册插件 */
  register(plugin: ContextPlugin): void {
    this.plugins.push(plugin);
    // 按 priority 排序
    this.plugins.sort((a, b) => a.priority - b.priority);
  }

  /** 注销插件 */
  unregister(name: string): void {
    this.plugins = this.plugins.filter(p => p.name !== name);
  }

  /** 获取所有已注册插件 */
  getPlugins(): readonly ContextPlugin[] {
    return this.plugins;
  }

  /** Bootstrap 阶段 — 串行执行 */
  async bootstrap(ctx: BootstrapContext): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.bootstrap) {
        await plugin.bootstrap(ctx);
      }
    }
  }

  /** BeforeTurn 阶段 — 串行执行（按 priority 排序） */
  async beforeTurn(ctx: TurnContext): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.beforeTurn) {
        await plugin.beforeTurn(ctx);
      }
    }

    // Token 预算检查 — 超过 85% 则触发 compact
    if (ctx.estimatedTokens > ctx.tokenLimit * TOKEN_THRESHOLD) {
      await this.triggerCompact({
        agentId: ctx.agentId,
        sessionKey: ctx.sessionKey,
        messages: ctx.messages,
        tokenUsageRatio: ctx.estimatedTokens / ctx.tokenLimit,
      });
    }
  }

  /** Compact 阶段 — 逆序执行，返回压缩后的消息列表 */
  async triggerCompact(ctx: CompactContext): Promise<ChatMessage[]> {
    let messages = ctx.messages;
    // 逆序：低优先级（高 priority 数值）的插件先执行 compact
    const reversed = [...this.plugins].reverse();
    for (const plugin of reversed) {
      if (plugin.compact) {
        messages = await plugin.compact({ ...ctx, messages });
      }
    }
    return messages;
  }

  /** AfterTurn 阶段 — 并行执行 (Promise.allSettled) */
  async afterTurn(ctx: TurnContext): Promise<void> {
    const promises = this.plugins
      .filter(p => p.afterTurn)
      .map(p => p.afterTurn!(ctx).catch(err => {
        console.error(`[ContextEngine] afterTurn 插件 ${p.name} 执行失败:`, err);
      }));
    await Promise.allSettled(promises);
  }

  /** Shutdown 阶段 — 串行执行 */
  async shutdown(ctx: ShutdownContext): Promise<void> {
    for (const plugin of this.plugins) {
      if (plugin.shutdown) {
        await plugin.shutdown(ctx);
      }
    }
  }

  /** forceTruncate 兜底 — 保留最近 N 条消息 */
  forceTruncate(messages: ChatMessage[], keepRecent: number = 6): ChatMessage[] {
    if (messages.length <= keepRecent) return messages;
    return messages.slice(-keepRecent);
  }
}
