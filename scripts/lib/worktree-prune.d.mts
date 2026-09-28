/**
 * Types for `worktree-prune.mjs` (#2391). The implementation stays plain
 * `.mjs` so `scripts/prune-worktrees.mjs` runs without a transpile step.
 */
export interface WorktreeEntry {
  path: string;
  head: string | null;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  lockReason: string | null;
  prunable: boolean;
}

export interface PrInfo {
  state: string;
  number: number;
  headRefOid?: string;
}

export interface WorktreeFacts {
  isMain?: boolean;
  isCurrent?: boolean;
  missing?: boolean;
  dirty?: boolean;
  branch?: string | null;
  isAncestorOfMain?: boolean;
  unmergedPatches?: number;
  mergeIsNoop?: boolean;
  ghAvailable?: boolean;
  pr?: PrInfo | null;
  headInPr?: boolean;
  remoteBranchExists?: boolean;
  locked?: boolean;
  lockPidAlive?: boolean;
  idleMinutes?: number;
}

export type WorktreeKind = 'protected' | 'dirty' | 'unmerged' | 'active' | 'unknown' | 'landed' | 'missing';

export interface WorktreeDecision {
  action: 'remove' | 'keep';
  kind: WorktreeKind;
  reason: string;
  deleteBranch: boolean;
}

export function parseWorktreeList(text: string): WorktreeEntry[];
export function parseLockPid(reason: string | null | undefined): number | null;
export function pickPr(prs: PrInfo[] | null | undefined): PrInfo | null;
export function classifyWorktree(
  facts: WorktreeFacts,
  options?: { minIdleMinutes?: number },
): WorktreeDecision;
