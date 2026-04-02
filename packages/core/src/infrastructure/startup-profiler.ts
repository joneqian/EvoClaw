/**
 * 启动性能打点工具
 *
 * 在启动流程关键节点调用 checkpoint()，记录高精度时间戳。
 * getReport() 返回结构化报告，formatReport() 返回人类可读文本。
 *
 * 参考 Claude Code startupProfiler.ts — 8 个检查点覆盖完整启动链路。
 */

export interface CheckpointEntry {
  name: string;
  /** 相对于第一个检查点的毫秒数 */
  elapsedMs: number;
  /** 相对于上一个检查点的毫秒数 */
  deltaMs: number;
  /** 高精度时间戳 (performance.now) */
  timestamp: number;
}

export interface StartupReport {
  checkpoints: CheckpointEntry[];
  /** 第一个到最后一个检查点的总耗时 (ms) */
  totalMs: number;
}

export class StartupProfiler {
  private entries: { name: string; timestamp: number }[] = [];

  /** 记录一个检查点 */
  checkpoint(name: string): void {
    this.entries.push({ name, timestamp: performance.now() });
  }

  /** 获取结构化报告 */
  getReport(): StartupReport {
    if (this.entries.length === 0) {
      return { checkpoints: [], totalMs: 0 };
    }

    const origin = this.entries[0].timestamp;
    const checkpoints: CheckpointEntry[] = this.entries.map((entry, i) => ({
      name: entry.name,
      elapsedMs: Math.round(entry.timestamp - origin),
      deltaMs: i === 0 ? 0 : Math.round(entry.timestamp - this.entries[i - 1].timestamp),
      timestamp: entry.timestamp,
    }));

    const totalMs = Math.round(
      this.entries[this.entries.length - 1].timestamp - origin,
    );

    return { checkpoints, totalMs };
  }

  /** 格式化为人类可读文本 */
  formatReport(): string {
    const report = this.getReport();
    if (report.checkpoints.length === 0) return '(no checkpoints)';

    const lines = report.checkpoints.map(
      (cp) => `  ${cp.name.padEnd(30)} +${cp.deltaMs}ms (${cp.elapsedMs}ms)`,
    );
    lines.push(`  ${'TOTAL'.padEnd(30)} ${report.totalMs}ms`);
    return lines.join('\n');
  }
}
