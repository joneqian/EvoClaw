import { MemoryStore } from './memory-store.js';
import { ConversationLogger } from './conversation-logger.js';
import type { SqliteStore } from '../infrastructure/db/sqlite-store.js';
import type { MemoryCategory } from '@evoclaw/shared';

/**
 * USER.md / MEMORY.md 动态渲染器
 * 从数据库查询记忆数据，生成 Markdown 格式的工作区文件
 */
export class UserMdRenderer {
  private memoryStore: MemoryStore;
  private conversationLogger: ConversationLogger;

  constructor(db: SqliteStore) {
    this.memoryStore = new MemoryStore(db);
    this.conversationLogger = new ConversationLogger(db);
  }

  /**
   * 渲染 USER.md — 用户画像
   * 从 profile + preference + correction 类记忆生成
   */
  renderUserMd(agentId: string): string {
    const sections: string[] = ['# 用户画像\n'];

    // Profile 记忆
    const profiles = this.memoryStore.listByAgent(agentId, { category: 'profile', limit: 20 });
    if (profiles.length > 0) {
      sections.push('## 个人信息\n');
      for (const m of profiles) {
        sections.push(`- ${m.l0Index}`);
      }
      sections.push('');
    }

    // Preference 记忆
    const preferences = this.memoryStore.listByAgent(agentId, { category: 'preference', limit: 20 });
    if (preferences.length > 0) {
      sections.push('## 偏好习惯\n');
      for (const m of preferences) {
        sections.push(`- ${m.l0Index}`);
      }
      sections.push('');
    }

    // Correction 记忆
    const corrections = this.memoryStore.listByAgent(agentId, { category: 'correction', limit: 10 });
    if (corrections.length > 0) {
      sections.push('## 纠正反馈\n');
      for (const m of corrections) {
        sections.push(`- ⚠️ ${m.l0Index}`);
      }
      sections.push('');
    }

    return sections.join('\n');
  }

  /**
   * 渲染 MEMORY.md — 活跃记忆摘要
   * 查询 activation > 0.3 的记忆
   */
  renderMemoryMd(agentId: string): string {
    const sections: string[] = ['# 活跃记忆\n'];

    // 按类别分组查询
    const categories: MemoryCategory[] = ['entity', 'event', 'case', 'pattern', 'tool', 'skill'];
    const categoryNames: Record<string, string> = {
      entity: '实体知识', event: '事件经历', case: '问题案例',
      pattern: '行为模式', tool: '工具使用', skill: '技能知识',
    };

    for (const cat of categories) {
      const memories = this.memoryStore.listByAgent(agentId, { category: cat, limit: 15 });
      // 过滤低 activation
      const active = memories.filter(m => m.activation > 0.3);
      if (active.length > 0) {
        sections.push(`## ${categoryNames[cat] ?? cat}\n`);
        for (const m of active) {
          const pin = m.accessCount > 5 ? '📌 ' : '';
          sections.push(`- ${pin}${m.l0Index} (置信度: ${m.confidence.toFixed(1)})`);
        }
        sections.push('');
      }
    }

    if (sections.length === 1) {
      sections.push('暂无活跃记忆。\n');
    }

    return sections.join('\n');
  }

  /**
   * 渲染当日对话日志
   */
  renderDailyLog(agentId: string, date: string): string {
    // date format: YYYY-MM-DD
    const sessionKey = `agent:${agentId}:default:direct:` as any;
    const logs = this.conversationLogger.getBySession(agentId, sessionKey, 100);

    // 过滤当天的日志（简化实现：返回所有日志；ConversationLogEntry 没有 createdAt 字段）
    const dayLogs = logs;

    if (dayLogs.length === 0) {
      return `# ${date} 对话日志\n\n暂无记录。\n`;
    }

    const sections: string[] = [`# ${date} 对话日志\n`];
    for (const log of dayLogs) {
      const role = log.role === 'user' ? '👤' : '🤖';
      const content = log.content.length > 200 ? log.content.slice(0, 200) + '...' : log.content;
      sections.push(`${role} **${log.role}**: ${content}\n`);
    }

    return sections.join('\n');
  }
}
