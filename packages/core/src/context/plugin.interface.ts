import type { ChatMessage, SessionKey } from '@evoclaw/shared';

/** Bootstrap 阶段上下文 */
export interface BootstrapContext {
  agentId: string;
  sessionKey: SessionKey;
  workspacePath: string;
}

/** 安全检测标志 */
export interface SecurityFlags {
  injectionDetected: boolean;
  injectionPatterns: string[];
  injectionSeverity: 'low' | 'medium' | 'high';
  unicodeDetected: boolean;
  unicodeIssues: string[];
}

/** 每轮对话上下文 */
export interface TurnContext {
  agentId: string;
  sessionKey: SessionKey;
  messages: ChatMessage[];
  systemPrompt: string;
  /** 插件可向 injectedContext 追加内容 */
  injectedContext: string[];
  /** 当前 token 使用估算 */
  estimatedTokens: number;
  /** token 上限 */
  tokenLimit: number;
  /** 安全检测标志（由 SecurityPlugin 设置） */
  securityFlags?: SecurityFlags;
  /** 加载警告（文件截断、缓存失效等） */
  warnings: string[];
  /** 召回元数据（由 memory-recall 插件设置）— Sprint 15.12 Phase C
   *  让 chat.ts 在 SSE 流末尾透传给前端，用于"Show Your Work"折叠条 */
  recallMeta?: {
    memoryIds: string[];
    scores: number[];
  };
}

/** 压缩阶段上下文 */
export interface CompactContext {
  agentId: string;
  sessionKey: SessionKey;
  messages: ChatMessage[];
  /** token 使用占比 (0-1) */
  tokenUsageRatio: number;
}

/** 关闭阶段上下文 */
export interface ShutdownContext {
  agentId: string;
  sessionKey: SessionKey;
}

/** ContextPlugin 接口 — 5 个可选钩子 */
export interface ContextPlugin {
  /** 插件名称 */
  name: string;
  /** 优先级（数值越小越先执行） */
  priority: number;
  /** Agent 会话启动时调用 */
  bootstrap?(ctx: BootstrapContext): Promise<void>;
  /** 每轮对话前调用（串行，按 priority） */
  beforeTurn?(ctx: TurnContext): Promise<void>;
  /** Token 超限时调用压缩 */
  compact?(ctx: CompactContext): Promise<ChatMessage[]>;
  /** 每轮对话后调用（并行） */
  afterTurn?(ctx: TurnContext): Promise<void>;
  /** 会话关闭时调用 */
  shutdown?(ctx: ShutdownContext): Promise<void>;
}
