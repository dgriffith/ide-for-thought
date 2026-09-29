/**
 * Types for `prepush-changed-files.mjs` (#2380). The implementation stays plain
 * `.mjs` so the pre-push hook runs it without a transpile step.
 */
export interface PushUpdate {
  localRef: string;
  localSha: string;
  remoteRef: string;
  remoteSha: string;
}

export interface GitFacts {
  hasCommit(sha: string): boolean;
  defaultBranch(): string | null;
  mergeBase(a: string, b: string): string | null;
  diffNames(base: string, head: string): string[];
  unpushedNames(head: string): string[];
}

export type RangePlan =
  | { kind: 'delete' }
  | { kind: 'range'; base: string; head: string; why: 'update' | 'new-branch' | 'unknown-remote-sha' }
  | { kind: 'unpushed'; head: string; why: 'new-branch' | 'unknown-remote-sha' };

export interface Selection {
  files: string[];
  changed: number;
  refs: number;
  plans: RangePlan[];
}

export function isZeroSha(sha: string): boolean;
export function parsePrePushInput(text: string): PushUpdate[];
export function planRange(update: PushUpdate, git: GitFacts): RangePlan;
export function isRelatable(file: string): boolean;
export function selectChangedFiles(
  stdinText: string,
  git: GitFacts,
  exists: (file: string) => boolean,
): Selection;
export function realGit(remote: string, cwd: string): GitFacts;
export function selectChangedFilesInRepo(stdinText: string, remote: string, cwd: string): Selection;
