/**
 * Batch note-reorganization planning (#914).
 *
 * A reorg is many moves/renames reviewed + applied as one plan. The approval
 * engine already gives ordered apply + reverse-order rollback for a bundle of
 * `note-refactor` payloads (#911) — this module adds the two things on top:
 *
 *  - **`planReorg`** dry-runs every operation (`planRename`), collecting the
 *    per-item blast radius and surfacing problems up front: an operation that
 *    can't run (collision with an existing file, no-op, …) and two operations
 *    targeting the same destination.
 *  - **`orderRefactors`** computes a safe apply order: an operation that vacates
 *    a path must run before one that fills it (a chain `A→B`, `B→C` must apply
 *    `B→C` first). A true cycle (a swap `A↔B`) can't be ordered without a temp,
 *    so it's reported rather than silently mis-applied.
 */

import { planRename, planFolderRename, RefactorError, type RenamePlan } from './rename';

export interface ReorgOperation {
  path: string;
  /** Full destination path (the model constructs it from list_notes). */
  newPath: string;
}

export interface ReorgItem {
  fromPath: string;
  toPath: string;
  /** Per-item blast radius (notes whose links change), from the dry-run. */
  affectedNotes: RenamePlan['affectedNotes'];
}

export interface ReorgPlan {
  items: ReorgItem[];
  /** Human-readable problems: skipped operations, in-plan collisions, cycles. */
  warnings: string[];
}

/**
 * Dry-run every operation. Operations that can't be planned (collision / no-op /
 * unsafe / not a note) are dropped with a warning rather than failing the whole
 * plan. Two operations sharing a destination are flagged.
 */
export async function planReorg(rootPath: string, operations: ReorgOperation[]): Promise<ReorgPlan> {
  const items: ReorgItem[] = [];
  const warnings: string[] = [];

  for (const op of operations) {
    try {
      const plan = await planRename(rootPath, op.path, op.newPath);
      items.push({ fromPath: plan.fromPath, toPath: plan.toPath, affectedNotes: plan.affectedNotes });
    } catch (err) {
      if (err instanceof RefactorError) warnings.push(`Skipped ${op.path} → ${op.newPath}: ${err.message}`);
      else throw err;
    }
  }

  // Two items moving to the same destination is a conflict the user must see.
  const byTarget = new Map<string, number>();
  for (const it of items) byTarget.set(it.toPath, (byTarget.get(it.toPath) ?? 0) + 1);
  for (const [target, n] of byTarget) {
    if (n > 1) warnings.push(`${n} notes target the same destination "${target}" — at most one can land there.`);
  }

  const { cycle } = orderRefactors(items);
  if (cycle) warnings.push('Some moves swap paths in a cycle and can\'t be applied in a safe order — split them.');

  return { items, warnings };
}

/**
 * Topologically order refactor pairs so a path is vacated before it's filled.
 * Edge `Y → X` when `X.toPath === Y.fromPath` (Y moves out of X's destination, so
 * Y must precede X). Returns the input order on no dependencies; sets `cycle` and
 * falls back to input order when the dependency graph can't be linearized.
 */
export function orderRefactors<T extends { fromPath: string; toPath: string }>(
  pairs: T[],
): { ordered: T[]; cycle: boolean } {
  const n = pairs.length;
  const indegree = new Array(n).fill(0);
  const edges: number[][] = Array.from({ length: n }, () => []);
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      if (x === y) continue;
      // Y must precede X when Y vacates the path X wants to fill.
      if (pairs[x]!.toPath === pairs[y]!.fromPath) {
        edges[y]!.push(x);
        indegree[x]++;
      }
    }
  }
  // Kahn's algorithm, preserving input order among ready nodes for stability.
  const queue: number[] = [];
  for (let i = 0; i < n; i++) if (indegree[i] === 0) queue.push(i);
  const ordered: T[] = [];
  while (queue.length > 0) {
    const i = queue.shift()!;
    ordered.push(pairs[i]!);
    for (const j of edges[i]!) {
      if (--indegree[j] === 0) queue.push(j);
    }
  }
  if (ordered.length < n) return { ordered: [...pairs], cycle: true };
  return { ordered, cycle: false };
}

/**
 * Folder counterpart to {@link planReorg} (#1778) — dry-run a batch of whole-folder
 * moves/renames so many folders are one review card and one bundled proposal.
 *
 * Same drop-with-a-warning contract as `planReorg`: a folder that can't be
 * planned (missing, collision, into-itself) is skipped with a message rather
 * than failing the batch.
 *
 * One hazard is specific to folders and worth naming. Each folder is planned
 * against the CURRENT tree, so when one requested move's source or destination
 * sits inside another's, the previews can't both be right — moving `a/` into
 * `b/` while also moving `b/` is the simple case. Apply is still safe: the
 * `folder-refactor` payload re-runs `planFolderRename` at apply time and throws
 * on a guardrail violation, which rolls the whole bundle back. So this warns
 * rather than rejects — the preview may understate what happens, the commit
 * cannot silently do the wrong thing.
 */
export async function planFolderReorg(
  rootPath: string,
  operations: ReorgOperation[],
): Promise<ReorgPlan> {
  const items: ReorgItem[] = [];
  const warnings: string[] = [];
  const seenDest = new Map<string, string>();

  const trim = (p: string): string => p.trim().replace(/^\/+|\/+$/g, '');

  for (const op of operations) {
    const from = trim(op.path);
    const to = trim(op.newPath);

    const clash = seenDest.get(to);
    if (clash !== undefined) {
      warnings.push(`Skipped ${from}: ${clash} is already being moved to ${to}.`);
      continue;
    }

    try {
      const plan = await planFolderRename(rootPath, from, to);
      seenDest.set(to, from);
      items.push({ fromPath: from, toPath: to, affectedNotes: plan.affectedNotes });
    } catch (e) {
      if (e instanceof RefactorError) {
        warnings.push(`Skipped ${from}: ${e.message}`);
        continue;
      }
      throw e;
    }
  }

  // Nesting check across the planned set (see the hazard note above).
  const inside = (child: string, parent: string): boolean => child.startsWith(`${parent}/`);
  for (const a of items) {
    for (const b of items) {
      if (a === b) continue;
      if (inside(a.fromPath, b.fromPath) || inside(a.toPath, b.fromPath)) {
        warnings.push(
          `${a.fromPath} → ${a.toPath} overlaps the move of ${b.fromPath}; `
          + 'the preview for it may not reflect the other move.',
        );
      }
    }
  }

  return { items, warnings };
}
