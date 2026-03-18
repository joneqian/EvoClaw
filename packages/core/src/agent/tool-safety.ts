/**
 * 工具安全机制 — 循环检测 + 结果截断
 * 参考 OpenClaw tool-loop-detection.ts + tool-result-truncation.ts
 *
 * 循环检测（4 种模式）:
 * - 重复模式: 同一工具+相同参数连续调用 N 次
 * - 无进展模式: 同一工具返回相同结果（参考 OpenClaw known_poll_no_progress）
 * - 乒乓模式: 两个工具交替调用
 * - 全局熔断: 单次会话工具调用总数超过阈值
 *
 * 结果截断（头尾保留策略，参考 OpenClaw tool-result-truncation.ts）:
 * - 保留头部 70% + 尾部 30%（尾部常含错误信息）
 * - 中间插入省略标记
 */

/** 工具调用记录 */
interface ToolCall {
  name: string;
  argsHash: string;
  resultHash?: string;
  timestamp: number;
}

/** 循环检测配置 */
export interface ToolSafetyConfig {
  /** 重复检测阈值（同一工具+参数连续调用 N 次触发） */
  repeatThreshold?: number;
  /** 无进展检测阈值（同一工具返回相同结果 N 次触发） */
  noProgressThreshold?: number;
  /** 乒乓检测阈值（两工具交替 N 次触发） */
  pingPongThreshold?: number;
  /** 全局熔断阈值 */
  circuitBreakerThreshold?: number;
  /** 结果截断字符数（默认 50000） */
  maxResultLength?: number;
}

/** 循环检测结果 */
export interface LoopDetectionResult {
  blocked: boolean;
  reason?: string;
}

/** 尾部错误特征词 — 用于判断尾部是否包含错误信息 */
const TAIL_ERROR_PATTERNS = [
  'error', 'Error', 'ERROR',
  'exception', 'Exception',
  'traceback', 'Traceback',
  'failed', 'Failed', 'FAILED',
  'denied', 'Permission',
  'not found', 'Not Found',
  'exit code', 'Exit',
];

/**
 * 工具安全守卫
 */
export class ToolSafetyGuard {
  private calls: ToolCall[] = [];
  private totalCalls = 0;

  private readonly repeatThreshold: number;
  private readonly noProgressThreshold: number;
  private readonly pingPongThreshold: number;
  private readonly circuitBreakerThreshold: number;
  private readonly maxResultLength: number;

  constructor(config?: ToolSafetyConfig) {
    this.repeatThreshold = config?.repeatThreshold ?? 5;
    this.noProgressThreshold = config?.noProgressThreshold ?? 3;
    this.pingPongThreshold = config?.pingPongThreshold ?? 4;
    this.circuitBreakerThreshold = config?.circuitBreakerThreshold ?? 30;
    this.maxResultLength = config?.maxResultLength ?? 50_000;
  }

  /**
   * 记录工具调用并检测循环
   * 在工具执行前调用，返回是否应阻止执行
   */
  checkBeforeExecution(toolName: string, args: Record<string, unknown>): LoopDetectionResult {
    this.totalCalls++;
    const argsHash = simpleHash(args);
    const call: ToolCall = { name: toolName, argsHash, timestamp: Date.now() };
    this.calls.push(call);

    // 全局熔断
    if (this.totalCalls > this.circuitBreakerThreshold) {
      return {
        blocked: true,
        reason: `工具调用次数已达熔断阈值（${this.circuitBreakerThreshold} 次）。请检查是否陷入了死循环。`,
      };
    }

    // 重复模式检测
    const repeatResult = this.detectRepeat(toolName, argsHash);
    if (repeatResult.blocked) return repeatResult;

    // 乒乓模式检测
    const pingPongResult = this.detectPingPong();
    if (pingPongResult.blocked) return pingPongResult;

    return { blocked: false };
  }

  /**
   * 记录工具执行结果（用于无进展检测）
   * 在工具执行后调用
   */
  recordResult(result: string): LoopDetectionResult {
    const lastCall = this.calls[this.calls.length - 1];
    if (lastCall) {
      lastCall.resultHash = simpleHashStr(result);
    }

    // 无进展检测：同一工具连续返回相同结果
    return this.detectNoProgress();
  }

  /**
   * 截断工具结果（头尾保留策略，参考 OpenClaw）
   * 保留头部 70% + 尾部 30%，尾部常含错误信息
   */
  truncateResult(result: string): string {
    if (result.length <= this.maxResultLength) return result;

    const originalLen = result.length;
    const tail = result.slice(-500);  // 检查尾部 500 字符
    const hasTailError = TAIL_ERROR_PATTERNS.some(p => tail.includes(p));

    if (hasTailError) {
      // 头尾保留：70% 头 + 30% 尾
      const headBudget = Math.floor(this.maxResultLength * 0.7);
      const tailBudget = this.maxResultLength - headBudget;
      const head = result.slice(0, headBudget);
      const tailPart = result.slice(-tailBudget);
      const omitted = originalLen - headBudget - tailBudget;
      return `${head}\n\n... [省略 ${omitted} 字符] ...\n\n${tailPart}`;
    }

    // 无错误信息：只保留头部
    const truncated = result.slice(0, this.maxResultLength);
    return `${truncated}\n\n... [结果已截断: 原始 ${originalLen} 字符，保留前 ${this.maxResultLength} 字符]`;
  }

  /** 获取统计信息 */
  getStats(): { totalCalls: number; uniqueTools: number; recentCalls: string[] } {
    const uniqueTools = new Set(this.calls.map(c => c.name)).size;
    const recentCalls = this.calls.slice(-10).map(c => c.name);
    return { totalCalls: this.totalCalls, uniqueTools, recentCalls };
  }

  /** 重置状态（新会话时调用） */
  reset(): void {
    this.calls = [];
    this.totalCalls = 0;
  }

  /** 重复模式检测 — 同一工具+相同参数连续调用 */
  private detectRepeat(toolName: string, argsHash: string): LoopDetectionResult {
    const recent = this.calls.slice(-this.repeatThreshold);
    if (recent.length < this.repeatThreshold) return { blocked: false };

    const allSame = recent.every(c => c.name === toolName && c.argsHash === argsHash);
    if (allSame) {
      return {
        blocked: true,
        reason: `检测到重复调用: 工具 "${toolName}" 使用相同参数连续调用了 ${this.repeatThreshold} 次。`,
      };
    }

    return { blocked: false };
  }

  /** 无进展检测 — 同一工具连续返回相同结果（参考 OpenClaw known_poll_no_progress） */
  private detectNoProgress(): LoopDetectionResult {
    if (this.calls.length < this.noProgressThreshold) return { blocked: false };

    const recent = this.calls.slice(-this.noProgressThreshold);
    // 所有调用是同一个工具且结果哈希相同
    const firstName = recent[0]!.name;
    const firstResultHash = recent[0]!.resultHash;
    if (!firstResultHash) return { blocked: false };

    const allSameResult = recent.every(
      c => c.name === firstName && c.resultHash === firstResultHash
    );

    if (allSameResult) {
      return {
        blocked: true,
        reason: `检测到无进展: 工具 "${firstName}" 连续 ${this.noProgressThreshold} 次返回相同结果，可能陷入轮询死循环。`,
      };
    }

    return { blocked: false };
  }

  /** 乒乓模式检测 — 两个工具交替调用 */
  private detectPingPong(): LoopDetectionResult {
    const windowSize = this.pingPongThreshold * 2;
    if (this.calls.length < windowSize) return { blocked: false };

    const recent = this.calls.slice(-windowSize);
    const uniqueNames = new Set(recent.map(c => c.name));

    if (uniqueNames.size !== 2) return { blocked: false };

    const [a, b] = [...uniqueNames];
    let alternating = true;
    for (let i = 1; i < recent.length; i++) {
      if (recent[i]!.name === recent[i - 1]!.name) {
        alternating = false;
        break;
      }
    }

    if (alternating) {
      return {
        blocked: true,
        reason: `检测到乒乓调用: 工具 "${a}" 和 "${b}" 交替调用了 ${this.pingPongThreshold} 轮。`,
      };
    }

    return { blocked: false };
  }
}

/** 对象哈希（用于参数去重比较） */
function simpleHash(obj: Record<string, unknown>): string {
  try {
    return JSON.stringify(obj, Object.keys(obj).sort());
  } catch {
    return String(obj);
  }
}

/** 字符串哈希（用于结果去重，取前 2000 字符避免大结果慢） */
function simpleHashStr(str: string): string {
  const sample = str.slice(0, 2000);
  let hash = 0;
  for (let i = 0; i < sample.length; i++) {
    hash = ((hash << 5) - hash + sample.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}
