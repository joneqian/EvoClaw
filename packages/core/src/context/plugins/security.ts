/**
 * SecurityPlugin — 输入层安全检测
 * Priority: 5（最高优先级，在所有其他插件之前执行）
 *
 * beforeTurn: 扫描最后一条用户消息 → 设置 securityFlags
 * 不阻断对话，只设标志，由下游消费者决定行为
 */

import type { ContextPlugin, TurnContext } from '../plugin.interface.js';
import type { SqliteStore } from '../../infrastructure/db/sqlite-store.js';
import { detectInjection } from '../../security/injection-detector.js';
import { detectUnicodeConfusion } from '../../security/unicode-detector.js';
import { createLogger } from '../../infrastructure/logger.js';

const log = createLogger('security-plugin');

/** 创建安全检测插件 */
export function createSecurityPlugin(db: SqliteStore): ContextPlugin {
  return {
    name: 'security',
    priority: 5,

    async beforeTurn(ctx: TurnContext) {
      // 找到最后一条用户消息
      const lastUserMsg = [...ctx.messages].reverse().find(m => m.role === 'user');
      if (!lastUserMsg?.content) return;

      const text = lastUserMsg.content;

      // 执行检测
      const injection = detectInjection(text);
      const unicode = detectUnicodeConfusion(text);

      // 设置标志
      ctx.securityFlags = {
        injectionDetected: injection.detected,
        injectionPatterns: injection.patterns,
        injectionSeverity: injection.severity,
        unicodeDetected: unicode.detected,
        unicodeIssues: unicode.issues,
      };

      // 有检测结果时写审计日志
      if (injection.detected || unicode.detected) {
        const details: string[] = [];
        if (injection.detected) {
          details.push(`注入(${injection.severity}): ${injection.patterns.join(', ')}`);
        }
        if (unicode.detected) {
          details.push(`Unicode: ${unicode.issues.join(', ')}`);
        }

        log.warn(`安全检测: agent=${ctx.agentId}, ${details.join(' | ')}`);

        try {
          db.run(
            `INSERT INTO audit_log (id, agent_id, action, category, resource, result, details, created_at)
             VALUES (?, ?, 'security_detection', 'input', ?, ?, ?, datetime('now'))`,
            crypto.randomUUID(),
            ctx.agentId,
            `message:${lastUserMsg.id ?? 'unknown'}`,
            injection.detected ? injection.severity : 'info',
            JSON.stringify({
              injection: injection.detected ? { patterns: injection.patterns, severity: injection.severity } : null,
              unicode: unicode.detected ? { issues: unicode.issues } : null,
            }),
          );
        } catch (err) {
          log.error('审计日志写入失败:', err);
        }
      }
    },
  };
}
