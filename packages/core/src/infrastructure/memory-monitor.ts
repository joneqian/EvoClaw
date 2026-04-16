/**
 * 内存泄漏检测基础设施
 * 定时采样 process.memoryUsage() + v8.getHeapStatistics()
 * 线性回归检测泄漏趋势
 */
import v8 from 'node:v8';

/** 内存样本 */
export interface MemorySample {
  timestamp: number;
  rss: number;
  heapUsed: number;
  heapTotal: number;
  external: number;
  arrayBuffers: number;
  v8HeapUsed: number;
  v8HeapTotal: number;
  v8MallocedMemory: number;
}

/** 趋势分析结果 */
export interface MemoryTrend {
  slopePerHour: number;     // MB/hour
  r2: number;               // 拟合度 (0-1)
  durationHours: number;    // 采样时长
  isLeaking: boolean;
}

/** 内存报告 */
export interface MemoryReport {
  current: MemorySample;
  trend: MemoryTrend;
  stats: {
    sampleCount: number;
    oldestSample: number | null;
    newestSample: number | null;
  };
}

export class MemoryMonitor {
  private samples: MemorySample[] = [];
  private maxSamples: number;
  private intervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(options?: { maxSamples?: number; intervalMs?: number }) {
    this.maxSamples = options?.maxSamples ?? 288; // 24h at 5min intervals
    this.intervalMs = options?.intervalMs ?? 5 * 60 * 1000; // 5 minutes
  }

  /** 采集一个样本 */
  takeSample(): MemorySample {
    const mem = process.memoryUsage();
    const heap = v8.getHeapStatistics();
    const sample: MemorySample = {
      timestamp: Date.now(),
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
      arrayBuffers: mem.arrayBuffers,
      v8HeapUsed: heap.used_heap_size,
      v8HeapTotal: heap.total_heap_size,
      v8MallocedMemory: heap.malloced_memory,
    };

    this.samples.push(sample);
    // 环形缓冲区：超出时丢弃最旧样本
    if (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }

    return sample;
  }

  /** 计算趋势（线性回归 heapUsed） */
  computeTrend(): MemoryTrend {
    if (this.samples.length < 2) {
      return { slopePerHour: 0, r2: 0, durationHours: 0, isLeaking: false };
    }

    const n = this.samples.length;
    const first = this.samples[0];
    const last = this.samples[n - 1];
    const durationHours = (last.timestamp - first.timestamp) / (1000 * 60 * 60);

    // 线性回归: y = heapUsed (MB), x = hours since first sample
    let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

    for (const s of this.samples) {
      const x = (s.timestamp - first.timestamp) / (1000 * 60 * 60); // hours
      const y = s.heapUsed / (1024 * 1024); // MB
      sumX += x;
      sumY += y;
      sumXY += x * y;
      sumX2 += x * x;
    }

    const denominator = n * sumX2 - sumX * sumX;
    if (denominator === 0) {
      return { slopePerHour: 0, r2: 0, durationHours, isLeaking: false };
    }

    const slopePerHour = (n * sumXY - sumX * sumY) / denominator;

    // R² 计算
    const meanY = sumY / n;
    let ssRes = 0, ssTot = 0;
    const intercept = (sumY - slopePerHour * sumX) / n;
    for (const s of this.samples) {
      const x = (s.timestamp - first.timestamp) / (1000 * 60 * 60);
      const y = s.heapUsed / (1024 * 1024);
      const predicted = intercept + slopePerHour * x;
      ssRes += (y - predicted) ** 2;
      ssTot += (y - meanY) ** 2;
    }
    const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;

    // 泄漏判定: slope > 10MB/hour AND 持续 >= 2 小时
    const isLeaking = slopePerHour > 10 && durationHours >= 2;

    return { slopePerHour, r2, durationHours, isLeaking };
  }

  /** 获取报告 */
  getReport(): MemoryReport {
    const current = this.takeSample();
    const trend = this.computeTrend();
    return {
      current,
      trend,
      stats: {
        sampleCount: this.samples.length,
        oldestSample: this.samples.length > 0 ? this.samples[0].timestamp : null,
        newestSample: this.samples.length > 0 ? this.samples[this.samples.length - 1].timestamp : null,
      },
    };
  }

  /** 启动定时采样 */
  start(): void {
    if (this.timer) return;
    this.takeSample(); // 立即采集一次
    this.timer = setInterval(() => this.takeSample(), this.intervalMs);
  }

  /** 停止定时采样 */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 测试用：注入样本 */
  _injectSamples(samples: MemorySample[]): void {
    this.samples = [...samples];
  }

  /** 测试用：获取当前样本数 */
  _getSampleCount(): number {
    return this.samples.length;
  }
}
