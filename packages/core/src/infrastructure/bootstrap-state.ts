/**
 * 全局启动状态管理
 *
 * 集中管理 Sidecar 启动过程中的全局状态，替代 main() 中的散落局部变量。
 * 参考 Claude Code bootstrap/state.ts — 15+ 全局状态集中管理。
 */

export type BootstrapPhase =
  | 'pending'       // 未开始
  | 'initializing'  // 初始化中
  | 'ready'         // HTTP 就绪
  | 'error';        // 启动失败

export interface BootstrapSnapshot {
  phase: BootstrapPhase;
  port: number | null;
  errorMessage: string | null;
  components: string[];
  startedAt: number;
  readyAt: number | null;
}

export class BootstrapState {
  private _phase: BootstrapPhase = 'pending';
  private _port: number | null = null;
  private _token: string | null = null;
  private _errorMessage: string | null = null;
  private _components = new Map<string, unknown>();
  private _startedAt = Date.now();
  private _readyAt: number | null = null;

  get phase(): BootstrapPhase { return this._phase; }
  get port(): number | null { return this._port; }
  get token(): string | null { return this._token; }
  get errorMessage(): string | null { return this._errorMessage; }

  /** 阶段变迁 */
  transition(phase: BootstrapPhase, errorMessage?: string): void {
    this._phase = phase;
    if (phase === 'ready') this._readyAt = Date.now();
    if (phase === 'error' && errorMessage) this._errorMessage = errorMessage;
  }

  /** 是否就绪 */
  isReady(): boolean { return this._phase === 'ready'; }

  /** 记录服务器信息 */
  setServerInfo(port: number, token: string): void {
    this._port = port;
    this._token = token;
  }

  /** 存储组件引用 */
  set(key: string, value: unknown): void { this._components.set(key, value); }

  /** 获取组件引用 */
  get<T = unknown>(key: string): T | undefined { return this._components.get(key) as T | undefined; }

  /** 状态快照（用于诊断） */
  getSnapshot(): BootstrapSnapshot {
    return {
      phase: this._phase,
      port: this._port,
      errorMessage: this._errorMessage,
      components: [...this._components.keys()],
      startedAt: this._startedAt,
      readyAt: this._readyAt,
    };
  }
}
