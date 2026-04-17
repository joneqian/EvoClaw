export interface TargetFile {
  path: string;
  kind: 'json' | 'cargo';
}

export const TARGET_FILES: readonly TargetFile[];

export function bumpSemver(current: string, type: 'patch' | 'minor' | 'major'): string;

export function updateJsonVersion(text: string, newVersion: string): string;

export function updateCargoVersion(text: string, newVersion: string): string;

export interface VersionEntry {
  path: string;
  version: string;
}

export function readAllVersions(root: string): VersionEntry[];

export type ConsistencyResult =
  | { ok: true }
  | { ok: false; ref: string; diffs: VersionEntry[] };

export function checkConsistency(versions: VersionEntry[]): ConsistencyResult;

export interface CheckOutput {
  exitCode: number;
  lines: string[];
}

export function runCheck(root: string): CheckOutput;

export interface BumpOpts {
  type?: 'patch' | 'minor' | 'major';
  setVersion?: string;
  dryRun?: boolean;
}

export interface BumpResult {
  oldVersion: string;
  newVersion: string;
  written: string[];
}

export function bumpAllAtomic(root: string, opts: BumpOpts): BumpResult;
