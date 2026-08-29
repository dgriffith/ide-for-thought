// Shared source mutations (#995). SourceDetail and SourcesPanel both rename,
// delete, and tag sources with byte-identical confirm/prompt copy and API
// calls — only their post-mutation refresh differs (SourceDetail reloads the
// open detail; SourcesPanel leans on the SOURCES_CHANGED broadcast, and for
// delete also refreshes its list). These helpers own the copy + API calls and
// take an `onDone` callback for that refresh seam, so each surface keeps its
// own refresh strategy while the duplicated logic lives in one place.

import { api } from '../ipc/client';
import { displaySourceTitle } from '../../../shared/source-display';
import type { SourceMetadata } from '../../../shared/types';
import { logger } from '../../../shared/logger';

/** Dialog seams, matching the components' `onShowPrompt` / `onShowConfirm`
 *  props. Typed to exactly what these helpers invoke (a string initial value),
 *  so both the string-only and string-or-options prompt props are assignable. */
type ShowPrompt = (message: string, initial?: string) => Promise<string | null>;
type ShowConfirm = (message: string, key: string, label?: string) => Promise<boolean>;

/** Runs after a successful mutation to refresh the surface. */
type OnDone = () => void | Promise<void>;

/**
 * Rename a source. Prompts with the current title pre-filled; a blank or
 * unchanged name is a no-op. Swallows + logs API errors (matching both call
 * sites' prior behavior).
 */
export async function renameSource(
  source: SourceMetadata,
  showPrompt: ShowPrompt,
  onDone?: OnDone,
): Promise<void> {
  const current = displaySourceTitle(source);
  const name = await showPrompt('Rename source:', current);
  if (!name || name.trim() === current) return;
  try {
    await api.sources.setTitle(source.sourceId, name.trim());
    await onDone?.();
  } catch (err) {
    logger('sources').error('Rename source failed:', err);
  }
}

/**
 * Delete a source after confirming. The confirm copy is defined here once
 * (both surfaces used a byte-identical string). Returns true if the delete
 * ran. Errors from the delete propagate (neither call site caught them).
 */
export async function deleteSource(
  source: SourceMetadata,
  showConfirm: ShowConfirm,
  onDone?: OnDone,
): Promise<boolean> {
  const label = displaySourceTitle(source);
  const confirmed = await showConfirm(
    `Delete source "${label}"? Any excerpts from this source will also be removed.`,
    'delete-source',
    'Delete',
  );
  if (!confirmed) return false;
  await api.sources.delete(source.sourceId);
  await onDone?.();
  return true;
}

/**
 * The project tag vocabulary minus tags the source already carries — the
 * autocomplete pool for the add-tag input/prompt. Returns [] on any error (so
 * the caller falls back to a plain input).
 */
export async function sourceTagSuggestions(
  source: SourceMetadata | null | undefined,
): Promise<string[]> {
  try {
    const have = new Set(source?.tags ?? []);
    return (await api.tags.list()).map((t) => t.tag).filter((t) => !have.has(t));
  } catch {
    return [];
  }
}

/**
 * Add a tag to a source. Trims + ignores a blank tag. Swallows + logs API
 * errors. The differing add-tag UX (SourceDetail's inline datalist input vs
 * SourcesPanel's prompt) stays in each component; this owns only the commit.
 */
export async function addSourceTag(
  sourceId: string,
  tag: string,
  onDone?: OnDone,
): Promise<void> {
  const t = tag.trim();
  if (!t) return;
  try {
    await api.sources.addTag(sourceId, t);
    await onDone?.();
  } catch (err) {
    logger('sources').error('add source tag failed:', err);
  }
}
