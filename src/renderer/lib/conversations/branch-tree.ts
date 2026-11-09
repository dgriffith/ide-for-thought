/**
 * The conversation list with branches under their parents (#2970). Pure, so
 * the panel and its tests share one ordering.
 *
 * Open conversations keep their order; each one's open branches follow it,
 * indented one level per generation. A branch whose parent isn't open (closed,
 * or never in this window) stands at the top level rather than vanishing.
 */
import type { BranchOutcome, Conversation } from '../../../shared/conversation';

export interface Nested<T> { item: T; depth: number }

export function nestBranches<T>(items: readonly T[], conv: (item: T) => Conversation): Nested<T>[] {
  const ids = new Set(items.map((i) => conv(i).id));
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const item of items) {
    const parent = conv(item).branch?.parentId;
    if (parent && parent !== conv(item).id && ids.has(parent)) {
      const list = children.get(parent) ?? [];
      list.push(item);
      children.set(parent, list);
    } else roots.push(item);
  }
  const out: Nested<T>[] = [];
  const seen = new Set<string>();
  const walk = (item: T, depth: number): void => {
    const id = conv(item).id;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ item, depth });
    for (const c of children.get(id) ?? []) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);
  // A hand-edited cycle has no root; show what's left flat rather than lose it.
  for (const item of items) if (!seen.has(conv(item).id)) walk(item, 0);
  return out;
}

/** The open conversations under `id`: its branches, and theirs. */
export function openDescendants<T>(items: readonly T[], conv: (item: T) => Conversation, id: string): T[] {
  const out: T[] = [];
  const found = new Set<string>([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const item of items) {
      const c = conv(item);
      if (!found.has(c.id) && c.branch && found.has(c.branch.parentId)) { found.add(c.id); out.push(item); grew = true; }
    }
  }
  return out;
}

const OUTCOME_LABEL: Record<BranchOutcome, string> = { done: 'Done', stopped: 'Stopped', failed: 'Failed' };

/** A branch's status as the list shows it; null for a conversation that isn't a branch, or a branch not yet run. */
export function branchStatus(c: Conversation, running: boolean): string | null {
  if (!c.branch) return null;
  if (running) return 'Running';
  return c.branch.outcome ? OUTCOME_LABEL[c.branch.outcome] : null;
}
