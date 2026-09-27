/**
 * Which agent worktrees under `.claude/worktrees/` are safe to remove (#2391).
 *
 * Agent sessions each get a worktree, and nothing removes them: #2391 counted
 * 31 of them holding 61 GB (every one carries its own `node_modules`, `.vite`
 * and `out/`). `scripts/prune-worktrees.mjs` gathers the facts; this module
 * decides, and is kept pure so the decision is testable without a repo.
 *
 * The hard part is "has this work landed?", because this repo SQUASH-merges.
 * A squash commit is a new commit with a new id, so `git branch --merged` and
 * every ancestry check report a merged branch as unmerged forever. No single
 * signal answers it, so several are combined:
 *
 *   - the branch's PR state from `gh` (MERGED / CLOSED / OPEN);
 *   - whether HEAD is already an ancestor of origin/main (a worktree that
 *     never committed anything);
 *   - patch equivalence: `git cherry` (every commit has an equivalent on main)
 *     or, for a squash of several commits that cherry can't match one-to-one,
 *     `git merge-tree` — if merging the branch into origin/main produces
 *     origin/main's own tree, the branch contributes nothing main lacks;
 *   - whether the remote branch still exists (informational only: a deleted
 *     remote is what a merged PR looks like, but also what a force-cleanup of
 *     abandoned work looks like, so on its own it never authorizes removal).
 *
 * The asymmetry is deliberate. Removing a worktree that should have stayed
 * destroys work; keeping one that could have gone costs disk. So every rule
 * below that says "remove" needs positive evidence, and anything uncertain is
 * reported as kept, with a reason a human can act on.
 */

/** @typedef {'remove' | 'keep'} Action */
/**
 * @typedef {'protected' | 'dirty' | 'unmerged' | 'active' | 'unknown' | 'landed' | 'missing'} Kind
 */

/**
 * Parse `git worktree list --porcelain`.
 *
 * @param {string} text
 */
export function parseWorktreeList(text) {
  const entries = [];
  let cur = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur) entries.push(cur);
      cur = {
        path: line.slice('worktree '.length),
        head: null,
        branch: null,
        detached: false,
        bare: false,
        locked: false,
        lockReason: null,
        prunable: false,
      };
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('HEAD ')) cur.head = line.slice(5);
    else if (line.startsWith('branch ')) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
    else if (line === 'detached') cur.detached = true;
    else if (line === 'bare') cur.bare = true;
    else if (line === 'locked' || line.startsWith('locked ')) {
      cur.locked = true;
      cur.lockReason = line.length > 7 ? line.slice(7) : null;
    } else if (line === 'prunable' || line.startsWith('prunable ')) cur.prunable = true;
  }
  if (cur) entries.push(cur);
  return entries;
}

/**
 * The agent harness locks a worktree with a reason like
 * `claude agent agent-abc (pid 14546 start ...)`. Returns the pid, or null.
 *
 * @param {string | null | undefined} reason
 */
export function parseLockPid(reason) {
  const m = /\bpid (\d+)\b/.exec(reason ?? '');
  return m ? Number(m[1]) : null;
}

/**
 * Pick the PR that describes a branch from `gh pr list --head <b> --state all`
 * output. A branch name can be reused, so a MERGED PR wins only if nothing
 * newer is OPEN — an open PR means the branch is live again.
 *
 * @param {Array<{ state: string; number: number; headRefOid?: string }>} prs
 */
export function pickPr(prs) {
  if (!prs || prs.length === 0) return null;
  const open = prs.find((p) => p.state === 'OPEN');
  if (open) return open;
  const merged = prs.find((p) => p.state === 'MERGED');
  if (merged) return merged;
  return prs[0];
}

/**
 * Decide one worktree.
 *
 * `facts` fields (all gathered by the CLI; any may be undefined when a probe
 * failed, and an undefined fact never counts as evidence for removal):
 *
 *   isMain, isCurrent       — never removed
 *   missing                 — directory gone; only `git worktree prune` applies
 *   dirty                   — `git status --porcelain` non-empty
 *   branch                  — short branch name, or null when detached
 *   isAncestorOfMain        — HEAD is reachable from origin/main
 *   unmergedPatches         — `git cherry origin/main HEAD` lines starting '+'
 *   mergeIsNoop             — merging HEAD into origin/main yields main's tree
 *   ghAvailable             — gh ran and is authenticated
 *   pr                      — pickPr(...) result: null = no PR for the branch
 *   headInPr                — HEAD is the PR's head commit (or behind it)
 *   remoteBranchExists      — origin/<branch> still exists
 *   locked, lockPidAlive    — harness lock, and whether its process runs
 *   idleMinutes             — minutes since the worktree last saw git activity
 *
 * @param {Record<string, any>} facts
 * @param {{ minIdleMinutes?: number }} [options]
 * @returns {{ action: Action; kind: Kind; reason: string; deleteBranch: boolean }}
 */
export function classifyWorktree(facts, options = {}) {
  const minIdle = options.minIdleMinutes ?? 30;
  const keep = (kind, reason) => ({ action: 'keep', kind, reason, deleteBranch: false });

  if (facts.isMain) return keep('protected', 'main worktree');
  if (facts.isCurrent) return keep('protected', 'the worktree this script is running from');

  if (facts.missing) {
    return { action: 'remove', kind: 'missing', reason: 'directory is gone; pruning the stale record', deleteBranch: false };
  }

  if (facts.dirty === undefined) return keep('unknown', 'could not read git status');
  if (facts.dirty) return keep('dirty', 'uncommitted or untracked changes');

  const verdict = landedVerdict(facts);
  if (!verdict.landed) return keep(verdict.kind ?? 'unmerged', verdict.reason);

  // A harness lock whose process is alive may belong to an agent that is still
  // working — a fresh worktree sitting at origin/main with nothing committed
  // yet looks exactly like an abandoned one. Recent git activity is the tell.
  if (
    facts.locked &&
    facts.lockPidAlive &&
    (facts.idleMinutes === undefined || facts.idleMinutes < minIdle)
  ) {
    return keep(
      'active',
      `${verdict.reason}, but locked by a live process and active ${facts.idleMinutes === undefined ? 'recently (unknown)' : `${Math.round(facts.idleMinutes)} min ago`}`,
    );
  }

  const branch = facts.branch;
  const deleteBranch = Boolean(branch) && !PROTECTED_BRANCHES.has(branch);
  return { action: 'remove', kind: 'landed', reason: verdict.reason, deleteBranch };
}

const PROTECTED_BRANCHES = new Set(['main', 'master']);

/**
 * @param {Record<string, any>} f
 * @returns {{ landed: boolean; reason: string; kind?: Kind }}
 */
function landedVerdict(f) {
  const ref = f.branch ? `branch ${f.branch}` : 'detached HEAD';

  if (f.isAncestorOfMain === true) {
    return { landed: true, reason: `${ref} has no commits of its own (HEAD is on origin/main)` };
  }

  const patchEquivalent = f.mergeIsNoop === true || f.unmergedPatches === 0;
  const pr = f.pr;

  if (pr && pr.state === 'MERGED') {
    // Squash-merged: the branch's own commits never appear on main, which is
    // exactly why the PR state is trusted here. Commits made AFTER the PR
    // merged are not covered by it, though.
    if (f.headInPr === true || patchEquivalent) {
      return { landed: true, reason: `PR #${pr.number} merged` };
    }
    if (f.headInPr === false) {
      return { landed: false, kind: 'unmerged', reason: `PR #${pr.number} merged, but HEAD has commits made after it` };
    }
    // headInPr unknown (older gh without headRefOid): trust the merge.
    return { landed: true, reason: `PR #${pr.number} merged` };
  }

  if (patchEquivalent) {
    const how = f.mergeIsNoop === true ? 'merging it would not change origin/main' : 'every commit has an equivalent on origin/main';
    return { landed: true, reason: `${ref}'s changes are already on main (${how})` };
  }

  if (f.isAncestorOfMain === undefined && f.unmergedPatches === undefined && f.mergeIsNoop === undefined) {
    return { landed: false, kind: 'unknown', reason: 'could not compare against origin/main' };
  }

  const remote = f.branch && f.remoteBranchExists === false ? '; remote branch is gone' : '';
  if (pr && pr.state === 'CLOSED') {
    return { landed: false, kind: 'unmerged', reason: `PR #${pr.number} closed without merging and ${ref} has commits not on main${remote}` };
  }
  if (pr && pr.state === 'OPEN') {
    return { landed: false, kind: 'unmerged', reason: `PR #${pr.number} is open` };
  }
  if (!f.ghAvailable) {
    return { landed: false, kind: 'unmerged', reason: `${ref} has commits not on main and gh is unavailable to confirm a merge${remote}` };
  }
  if (!f.branch) {
    return { landed: false, kind: 'unmerged', reason: 'detached HEAD with commits not on main' };
  }
  return { landed: false, kind: 'unmerged', reason: `${ref} has commits not on main and no PR${remote}` };
}
