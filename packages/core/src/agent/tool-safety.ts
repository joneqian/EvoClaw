/**
 * 工具安全机制 — 循环检测 + 结果截断
 * 参考 OpenClaw tool-loop-detection.ts + tool-result-truncation.ts
 *
 * 循环检测（3 种真模式 + 1 个绝对上限）:
 * - 重复模式: 同一工具+相同参数连续调用 N 次
 * - 无进展模式: 同一工具返回相同结果（参考 OpenClaw known_poll_no_progress）
 * - 乒乓模式: 两个工具交替调用
 * - 绝对上限（hard cap）: 单 turn 工具调用 > runawayHardCap（默认 500）才中断；
 *     用于防真死循环跑死 sidecar/吃光 token。日常工程任务（codegen 多文件、
 *     长 bash 链）远到不了；只有真死循环才能堆这么高
 *
 * 注（M13 修复）：原 circuitBreakerThreshold=30 已退役 —— 把"正常推进"和"循环"
 * 一刀切是误伤（前端建项目要 10-20 次 write，30 太低）。真循环由前 3 种模式抓，
 * 兜底由 hard cap + query-loop 的 maxTurns 限制。
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
  /**
   * 绝对上限（防真死循环跑死 sidecar / 吃光 token）
   *
   * 单 turn 工具调用数硬天花板。复杂工程任务（codegen 多文件、长 bash 链）
   * 通常 10-50 次内能完成，500 是给真·死循环留的兜底。一旦撞上说明 LLM
   * 已彻底失控，应当中断 turn。
   *
   * 注（M13 修复）：替代原 circuitBreakerThreshold=30 的全局熔断
   *   —— 30 把"正常推进"也一刀切，误伤工程任务
   */
  runawayHardCap?: number;
  /**
   * 同一工具连续报错阈值（fix #1）
   *
   * 实测 DeepSeek-v4-pro 流式 tool_call 反复丢字段（如 file_path），
   * 每次都说"让我重新调用"，但请求体里就是没传。同 tool 连续 N 次错误
   * 即使错误信息略有变化（缺 file_path → 未被读取过 → 缺 file_path），
   * 也是 LLM 卡住的强信号。
   *
   * 计数规则：
   * - 同一 tool 报错 → +1（不要求错误文本完全一致）
   * - 同一 tool 成功 → 重置该 tool 的计数（不影响其他 tool）
   * - 其他 tool 调用 → 不重置（read 成功不放过 write 的错误流）
   *
   * 触发后建议 LLM 调 update_task_status('blocked') 上报，由责任链兜底。
   */
  consecutiveErrorsThreshold?: number;
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
  /** fix #1: 每个 tool 的连续报错次数（成功一次即清零，仅当前 tool） */
  private errorStreaks: Map<string, number> = new Map();

  private readonly repeatThreshold: number;
  private readonly noProgressThreshold: number;
  private readonly pingPongThreshold: number;
  private readonly runawayHardCap: number;
  private readonly consecutiveErrorsThreshold: number;
  private readonly maxResultLength: number;

  constructor(config?: ToolSafetyConfig) {
    this.repeatThreshold = config?.repeatThreshold ?? 5;
    this.noProgressThreshold = config?.noProgressThreshold ?? 3;
    this.pingPongThreshold = config?.pingPongThreshold ?? 4;
    this.runawayHardCap = config?.runawayHardCap ?? 500;
    this.consecutiveErrorsThreshold = config?.consecutiveErrorsThreshold ?? 3;
    this.maxResultLength = config?.maxResultLength ?? 50_000;
  }

  /**
   * 记录工具调用并检测循环
   * 在工具执行前调用，返回是否应阻止执行
   *
   * 检测顺序：先抓真循环（重复 / 乒乓 — O(1)），最后撞绝对上限（真死循环兜底）
   */
  checkBeforeExecution(toolName: string, args: Record<string, unknown>): LoopDetectionResult {
    this.totalCalls++;
    const argsHash = simpleHash(args);
    const call: ToolCall = { name: toolName, argsHash, timestamp: Date.now() };
    this.calls.push(call);

    // 重复模式检测（同一工具+参数连续 N 次）
    const repeatResult = this.detectRepeat(toolName, argsHash);
    if (repeatResult.blocked) return repeatResult;

    // 乒乓模式检测（两工具交替 N 次）
    const pingPongResult = this.detectPingPong();
    if (pingPongResult.blocked) return pingPongResult;

    // 绝对上限兜底（防真死循环跑死 sidecar）—— 默认 500，正常工程任务远达不到
    if (this.totalCalls > this.runawayHardCap) {
      return {
        blocked: true,
        reason: `工具调用已达绝对上限（${this.runawayHardCap} 次）。这通常意味着进入了未识别的循环；请改用 update_task_status('needs_help') 或 update_task_status('blocked') 上报阻塞，让责任链兜底处理。`,
      };
    }

    return { blocked: false };
  }

  /**
   * 记录工具执行结果（用于无进展检测）
   * 在工具执行后调用
   *
   * 同时清零该 tool 的连续错误计数（成功一次即重置，与 noProgress 互补）
   */
  recordResult(result: string): LoopDetectionResult {
    const lastCall = this.calls[this.calls.length - 1];
    if (lastCall) {
      lastCall.resultHash = simpleHashStr(result);
      // fix #1: 成功执行清零该 tool 的错误流（不影响其他 tool 的流）
      this.errorStreaks.delete(lastCall.name);
    }

    // 无进展检测：同一工具连续返回相同结果
    return this.detectNoProgress();
  }

  /**
   * 记录工具执行错误（fix #1）
   *
   * 在工具执行后、确认 isError=true 时调用。
   * 累计该 tool 的连续错误数；同 tool 错误数达阈值即熔断。
   * 注意：调用方需自行决定何时记 error（schema 错 / safety 拒 / 真实执行错）。
   */
  recordError(toolName: string): LoopDetectionResult {
    const next = (this.errorStreaks.get(toolName) ?? 0) + 1;
    this.errorStreaks.set(toolName, next);

    if (next >= this.consecutiveErrorsThreshold) {
      return {
        blocked: true,
        reason: `检测到工具熔断：工具 "${toolName}" 已连续报错 ${next} 次（阈值 ${this.consecutiveErrorsThreshold}）。请停止重试此工具，改用 update_task_status('blocked', outputSummary='...原因...') 上报阻塞，让协调者或用户介入。`,
      };
    }
    return { blocked: false };
  }

  /** 测试用：读取某个 tool 的当前错误流计数 */
  getErrorStreak(toolName: string): number {
    return this.errorStreaks.get(toolName) ?? 0;
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
    this.errorStreaks.clear();
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
