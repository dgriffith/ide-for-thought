#!/usr/bin/env node
/**
 * Remove agent worktrees under `.claude/worktrees/` whose work has landed or
 * been abandoned (#2391).
 *
 *   pnpm worktrees:prune             # dry run: list what would go, and why
 *   pnpm worktrees:prune --apply     # actually remove
 *   pnpm worktrees:prune --no-fetch  # skip `git fetch origin` first
 *   pnpm worktrees:prune --min-idle 60
 *
 * The decision lives in `scripts/lib/worktree-prune.mjs` (pure, unit-tested);
 * this file only gathers facts and executes. Never removed: the main
 * worktree, the one this runs from, anything with uncommitted/untracked
 * changes, and anything with commits not on main unless its PR merged.
 * Without a working `gh`, only the git-only signals count, so fewer
 * worktrees qualify.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { classifyWorktree, parseLockPid, parseWorktreeList, pickPr } from './lib/worktree-prune.mjs';

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const noFetch = args.includes('--no-fetch');
const idleIdx = args.indexOf('--min-idle');
const minIdleMinutes = idleIdx >= 0 ? Number(args[idleIdx + 1]) : 30;
if (args.includes('--help') || args.includes('-h')) {
  console.log('usage: prune-worktrees.mjs [--apply] [--no-fetch] [--min-idle <minutes>]');
  process.exit(0);
}

function run(cmd, argv, opts = {}) {
  return execFileSync(cmd, argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });
}
/** Run and return stdout, or undefined on failure. */
function tryRun(cmd, argv, opts) {
  try {
    return run(cmd, argv, opts);
  } catch {
    return undefined;
  }
}
/** Exit-status probe: true on 0, false on 1, undefined on anything else. */
function probe(cmd, argv, opts) {
  try {
    run(cmd, argv, opts);
    return true;
  } catch (e) {
    return e && e.status === 1 ? false : undefined;
  }
}

const cwd = process.cwd();
const currentTop = realpath(run('git', ['rev-parse', '--show-toplevel']).trim());
const commonDir = path.resolve(cwd, run('git', ['rev-parse', '--git-common-dir']).trim());
const mainTop = realpath(path.dirname(commonDir));
const worktreesRoot = path.join(mainTop, '.claude', 'worktrees');

function realpath(p) {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

if (!noFetch) {
  if (tryRun('git', ['fetch', '--prune', '--quiet', 'origin']) === undefined) {
    console.warn('warning: `git fetch origin` failed; comparing against the last-fetched origin/main');
  }
}
const mainRef = 'origin/main';
const mainTree = tryRun('git', ['rev-parse', `${mainRef}^{tree}`])?.trim();

const ghAvailable = tryRun('gh', ['auth', 'status']) !== undefined;
if (!ghAvailable) console.warn('warning: gh unavailable or unauthenticated; using git-only signals (more conservative)');

const remoteBranches = new Set(
  (tryRun('git', ['for-each-ref', '--format=%(refname:short)', 'refs/remotes/origin']) ?? '')
    .split('\n')
    .filter(Boolean)
    .map((r) => r.replace(/^origin\//, '')),
);

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function idleMinutes(wtPath) {
  const gitDir = tryRun('git', ['-C', wtPath, 'rev-parse', '--absolute-git-dir'])?.trim();
  const candidates = [wtPath];
  if (gitDir) candidates.push(path.join(gitDir, 'index'), path.join(gitDir, 'HEAD'), path.join(gitDir, 'logs', 'HEAD'));
  let latest = 0;
  for (const c of candidates) {
    try {
      latest = Math.max(latest, fs.statSync(c).mtimeMs);
    } catch {
      /* absent */
    }
  }
  return latest ? (Date.now() - latest) / 60000 : undefined;
}

function gatherFacts(wt) {
  const wtPath = realpath(wt.path);
  const facts = {
    isMain: wtPath === mainTop,
    isCurrent: wtPath === currentTop,
    missing: wt.prunable || !fs.existsSync(wt.path),
    branch: wt.branch,
    locked: wt.locked,
    lockPidAlive: wt.locked ? isAlive(parseLockPid(wt.lockReason)) : false,
    ghAvailable,
  };
  if (facts.isMain || facts.isCurrent || facts.missing) return facts;

  const status = tryRun('git', ['-C', wt.path, 'status', '--porcelain', '--untracked-files=all']);
  facts.dirty = status === undefined ? undefined : status.trim().length > 0;
  if (facts.dirty !== false) return facts;

  facts.idleMinutes = idleMinutes(wt.path);
  const head = wt.head;
  facts.isAncestorOfMain = probe('git', ['merge-base', '--is-ancestor', head, mainRef]);
  const cherry = tryRun('git', ['cherry', mainRef, head]);
  facts.unmergedPatches = cherry === undefined ? undefined : cherry.split('\n').filter((l) => l.startsWith('+')).length;
  const merged = tryRun('git', ['merge-tree', '--write-tree', mainRef, head]);
  facts.mergeIsNoop = merged === undefined || !mainTree ? undefined : merged.split('\n')[0].trim() === mainTree;
  if (wt.branch) facts.remoteBranchExists = remoteBranches.has(wt.branch);

  if (ghAvailable && wt.branch) {
    const out = tryRun('gh', ['pr', 'list', '--head', wt.branch, '--state', 'all', '--json', 'state,number,headRefOid']);
    if (out === undefined) {
      facts.ghAvailable = false;
    } else {
      facts.pr = pickPr(JSON.parse(out));
      if (facts.pr?.headRefOid) {
        facts.headInPr =
          facts.pr.headRefOid === head ||
          probe('git', ['merge-base', '--is-ancestor', head, facts.pr.headRefOid]) === true;
      }
    }
  }
  return facts;
}

const worktrees = parseWorktreeList(run('git', ['worktree', 'list', '--porcelain']));
const rows = [];
for (const wt of worktrees) {
  const inScope = realpath(wt.path).startsWith(worktreesRoot + path.sep) || wt.path.startsWith(worktreesRoot + path.sep);
  const isMainOrCurrent = realpath(wt.path) === mainTop || realpath(wt.path) === currentTop;
  if (!inScope && !isMainOrCurrent) {
    rows.push({ wt, decision: { action: 'keep', kind: 'protected', reason: 'outside .claude/worktrees/', deleteBranch: false } });
    continue;
  }
  const facts = gatherFacts(wt);
  rows.push({ wt, decision: classifyWorktree(facts, { minIdleMinutes }) });
}

const label = (wt) => `${path.basename(wt.path)} [${wt.branch ?? 'detached'}]`;
const groups = new Map();
for (const r of rows) {
  const key = r.decision.action === 'remove' ? 'remove' : `keep: ${r.decision.kind}`;
  if (!groups.has(key)) groups.set(key, []);
  groups.get(key).push(r);
}
const order = ['remove', 'keep: dirty', 'keep: unmerged', 'keep: active', 'keep: unknown', 'keep: protected'];
for (const key of [...order, ...[...groups.keys()].filter((k) => !order.includes(k))]) {
  const list = groups.get(key);
  if (!list) continue;
  console.log(`\n${key === 'remove' ? (apply ? 'removing' : 'would remove') : key} (${list.length})`);
  for (const { wt, decision } of list) {
    const extra = decision.deleteBranch ? ' (+ delete local branch)' : '';
    console.log(`  ${label(wt)}: ${decision.reason}${extra}`);
  }
}

if (!apply) {
  console.log('\nDry run. Re-run with --apply to remove.');
  process.exit(0);
}

let failures = 0;
for (const { wt, decision } of rows) {
  if (decision.action !== 'remove') continue;
  try {
    if (wt.locked) run('git', ['worktree', 'unlock', wt.path]);
    if (decision.kind !== 'missing') {
      // No --force: git re-checks cleanliness itself, which closes the gap
      // between the status probe above and this removal. Ignored build output
      // (node_modules, .vite, out/) does not block it.
      run('git', ['worktree', 'remove', wt.path]);
    }
    if (decision.deleteBranch && wt.branch) run('git', ['branch', '-D', wt.branch]);
    console.log(`removed ${label(wt)}`);
  } catch (e) {
    failures++;
    console.error(`failed ${label(wt)}: ${(e.stderr || e.message || '').toString().trim()}`);
  }
}
run('git', ['worktree', 'prune']);
console.log('git worktree prune: done');
process.exit(failures ? 1 : 0);
