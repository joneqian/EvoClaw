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

export function applyRelease(
  tauriConf: Record<string, unknown>,
  release: ReleaseConfig | undefined,
  env: Record<string, string | undefined>,
): Record<string, unknown>;
