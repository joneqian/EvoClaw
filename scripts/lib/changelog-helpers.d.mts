export interface Commit {
  hash: string;
  fullHash: string;
  rawSubject: string;
  body: string;
  type: string | null;
  scope: string | null;
  subject: string;
  breaking: boolean;
}

export type GroupName =
  | 'features'
  | 'bugfixes'
  | 'performance'
  | 'refactor'
  | 'documentation'
  | 'tests'
  | 'chores'
  | 'reverts'
  | 'other';

export type GroupedCommits = Partial<Record<GroupName, Commit[]>>;

export function parseCommits(gitLogText: string): Commit[];

export function classifyCommit(commit: Commit): GroupName;

export function groupCommits(commits: Commit[]): GroupedCommits;

export function formatChangelog(opts: {
  version: string;
  date: string;
  groups: GroupedCommits;
}): string;

export function prependToChangelog(existing: string, newSection: string): string;

export const GIT_LOG_FORMAT: string;

export function todayISO(): string;
