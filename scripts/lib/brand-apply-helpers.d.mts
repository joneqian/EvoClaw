export const UNSET: string;

export function resolveEnv(value: unknown, env: Record<string, string | undefined>): string | unknown;

export function resolveDeep<T>(value: T, env: Record<string, string | undefined>): T;

export function hasUnset(value: unknown): boolean;

export interface ReleaseConfig {
  macOS?: {
    signingIdentity?: string;
    entitlements?: string;
    minimumSystemVersion?: string;
    providerShortName?: string;
  };
  windows?: {
    certificateThumbprint?: string;
    digestAlgorithm?: string;
    timestampUrl?: string;
    tsp?: boolean;
  };
  updater?: {
    endpoints?: string[];
    pubkey?: string;
  };
}

/** tauri.conf.json 最小结构 — 本 helper 读写的字段（输入允许缺省） */
export interface TauriConfLike {
  bundle?: TauriBundle;
  plugins?: TauriPlugins;
  [k: string]: unknown;
}

export interface TauriBundle {
  macOS?: {
    signingIdentity?: string;
    entitlements?: string;
    minimumSystemVersion?: string;
    providerShortName?: string;
    [k: string]: unknown;
  };
  windows?: {
    certificateThumbprint?: string;
    digestAlgorithm?: string;
    timestampUrl?: string;
    tsp?: boolean;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface TauriPlugins {
  updater?: {
    endpoints: string[];
    pubkey: string;
  };
  [k: string]: unknown;
}

/** applyRelease 保证输出的 bundle + plugins 总是存在 */
export type TauriConfOut = TauriConfLike & {
  bundle: TauriBundle;
  plugins: TauriPlugins;
};

export function applyRelease(
  tauriConf: TauriConfLike,
  release: ReleaseConfig | undefined,
  env: Record<string, string | undefined>,
): TauriConfOut;
