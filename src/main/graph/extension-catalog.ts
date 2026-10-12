/**
 * The installed contributions, per project (#2618) — held so the catalog
 * survives the wholesale store reset a full reindex does: `indexAllNotes`
 * rebuilds the store from scratch, then re-materialises from here.
 *
 * The composition root gathers the contributions (it can read skills, saved
 * queries, MCP config…; the graph package can't) and hands them over with
 * `setExtensionContributions`.
 */
import { createProjectStore } from '../project-store';
import type { ProjectContext } from '../project-context-types';
import type { Contribution } from '../../shared/extensions/contributions';
import { getState } from './state';
import { materializeExtensionCatalog } from './indexers/extensions';

const contributionStore = createProjectStore<{ contributions: readonly Contribution[]; key: string }>();

/**
 * Record what's installed for this project, and write the catalog — unless it
 * is what's already recorded. Rewriting is ~1,000 store mutations, enough to
 * exceed the N3 mirror's incremental budget and cost the next query a cold
 * rebuild (#2209), and the refresh runs on every window focus; an unchanged
 * catalog must cost nothing. Returns whether it rewrote.
 */
export function setExtensionContributions(ctx: ProjectContext, contributions: readonly Contribution[]): boolean {
  const key = JSON.stringify(contributions);
  if (contributionStore.get(ctx)?.key === key) return false;
  contributionStore.set(ctx, { contributions, key });
  const state = getState(ctx);
  if (state) materializeExtensionCatalog(state, contributions);
  return true;
}

/** Write the catalog from what's recorded — the points alone before anything is. */
export function rematerializeExtensionCatalog(ctx: ProjectContext): void {
  const state = getState(ctx);
  if (state) materializeExtensionCatalog(state, contributionStore.get(ctx)?.contributions ?? []);
}
