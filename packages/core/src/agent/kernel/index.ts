/**
 * Agent Kernel — 公共 API
 *
 * 自研 Agent 内核，替代 PI 框架 (pi-ai + pi-agent-core + pi-coding-agent)
 */

// Types
export type {
  ContentBlock,
  TextBlock,
  ToolUseBlock,
  ToolResultBlock,
  ThinkingBlock,
  ImageBlock,
  TokenUsage,
  KernelMessage,
  KernelTool,
  ToolCallResult,
  StreamEvent,
  RawSSEEvent,
  ApiProtocol,
  StreamConfig,
  QueryLoopConfig,
  QueryLoopResult,
  LoopState,
  TransitionReason,
  ExitReason,
  FallbackModelConfig,
} from './types.js';

export { ApiError, IdleTimeoutError, AbortError } from './types.js';

// Stream
export { parseSSE, safeParseJSON } from './stream-parser.js';
export { streamLLM } from './stream-client.js';

// Tools
export { createBuiltinTools } from './builtin-tools.js';
export { adaptEvoclawTool, buildKernelTools } from './tool-adapter.js';
export type { AuditLogEntry, ToolAdapterDeps, BuildToolsConfig } from './tool-adapter.js';

// Tool Executor
export { StreamingToolExecutor } from './streaming-tool-executor.js';

// Query Loop
export { queryLoop, queryLoopGenerator } from './query-loop.js';

// Context Compaction
export { maybeCompress, estimateTokens, snipOldMessages, microcompactToolResults, stripOldThinkingBlocks, resetCompactorState } from './context-compactor.js';

// Error Recovery
export { classifyApiError, isRecoverableInLoop, isAbortLike } from './error-recovery.js';
export type { ClassifiedApiError } from './error-recovery.js';
