/**
 * Live Typed-Objects view embedded in a note's preview (#2067).
 *
 * Mirrors `vega-renderer.ts`'s shape: the fence rule emits a placeholder
 * `<div class="object-view-block">` carrying the raw JSON spec as text
 * content; `hydrateObjectViewBlocks` walks the DOM and replaces each
 * un-rendered placeholder with a live projection. Unlike vega/mermaid,
 * "rendering" here means mounting the real `TypeView.svelte` component (in
 * `chromeless` mode) via Svelte 5's `mount()`/`unmount()` rather than
 * building an HTML string or handing off to a non-Svelte library — reusing
 * TypeView's own list/table/gallery/map rendering avoids duplicating it, and
 * the map layout already needs an imperative mount-and-track-for-cleanup
 * lifecycle (a live MapLibre instance) that this generalizes to every layout.
 *
 * Refresh cadence intentionally matches vega/mermaid, not a live poll: a
 * mounted instance is idempotent (`data-object-view-rendered`) and only
 * re-renders when its DOM placeholder is freshly created — a note reopen, or
 * an edit to the fence's own text. `TypeView` itself still re-projects
 * against `revision` while mounted (see its own `$effect`), and its styling
 * is pure CSS custom properties, so a theme switch re-skins it for free with
 * no re-mount needed here.
 *
 * Cleanup: unlike vega's `liveViews` `WeakMap` (safe only because
 * `invalidateVegaTheme` queries still-attached DOM to find its keys), a
 * mounted `TypeView` must be torn down through the SAME plain-array
 * mechanism `Preview.svelte` already uses for `activeCharts` — by the time
 * the revision effect that owns cleanup runs, `{@html rendered}` has already
 * replaced the old placeholder nodes, so a `WeakMap` keyed on the (now
 * discarded) element can't be re-derived from the DOM. `deps.activeViews` is
 * that array; see `Preview.svelte`'s revision `$effect` for the destroy side.
 */
import { mount, unmount } from 'svelte';
import TypeView from '../components/TypeView.svelte';
import type { ChartHandle } from '../charts';
import type { ViewLayout } from '../../../shared/types';
import { escapeHtml } from '../../../shared/text-escape';

export interface ObjectViewSpec {
  typeId: string;
  layout: ViewLayout;
  sortColumn: string | null;
  sortDir: 'asc' | 'desc';
  columns: string[] | null;
}

const LAYOUTS: ReadonlySet<ViewLayout> = new Set(['list', 'table', 'gallery', 'map']);

export function parseObjectViewSpec(raw: string): ObjectViewSpec {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Spec must be a JSON object');
  }
  const spec = parsed as Record<string, unknown>;
  if (typeof spec.typeId !== 'string' || !spec.typeId) {
    throw new Error('"typeId" is required and must be a non-empty string');
  }
  if (typeof spec.layout !== 'string' || !LAYOUTS.has(spec.layout as ViewLayout)) {
    throw new Error('"layout" must be one of "list", "table", "gallery", "map"');
  }
  return {
    typeId: spec.typeId,
    layout: spec.layout as ViewLayout,
    sortColumn: typeof spec.sortColumn === 'string' ? spec.sortColumn : null,
    sortDir: spec.sortDir === 'desc' ? 'desc' : 'asc',
    columns: Array.isArray(spec.columns)
      ? spec.columns.filter((c): c is string => typeof c === 'string')
      : null,
  };
}

export interface ObjectViewDeps {
  /** Bumped by the host on write/reindex — forwarded to the mounted
   *  `TypeView` so it re-projects while already mounted (#1070). */
  revision: number;
  onOpenNote: (relativePath: string) => void;
  /** Live mounts to destroy, owned by the host (mirrors `activeCharts`). */
  activeViews: ChartHandle[];
}

/**
 * Walk `root` for unrendered `.object-view-block` placeholders and mount a
 * chromeless `TypeView` into each. Idempotent: blocks already marked
 * `data-object-view-rendered` are skipped, so the post-render `$effect`
 * firing repeatedly doesn't double-mount.
 */
export function hydrateObjectViewBlocks(root: HTMLElement, deps: ObjectViewDeps): void {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>('.object-view-block:not([data-object-view-rendered])'),
  );
  if (blocks.length === 0) return;

  for (const el of blocks) {
    const raw = (el.textContent ?? '').trim();
    el.removeAttribute('data-object-view-pending');

    let spec: ObjectViewSpec;
    try {
      spec = parseObjectViewSpec(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      el.innerHTML = renderErrorHtml(msg);
      el.setAttribute('data-object-view-rendered', 'error');
      continue;
    }

    el.innerHTML = '';
    const instance = mount(TypeView, {
      target: el,
      props: {
        typeId: spec.typeId,
        layout: spec.layout,
        sortColumn: spec.sortColumn,
        sortDir: spec.sortDir,
        columns: spec.columns,
        revision: deps.revision,
        chromeless: true,
        // No in-preview UI for changing the embedded spec (#2067) — a
        // sortable table header click inside an embed is inert rather than
        // rewriting the note's fence text.
        onStateChange: () => {},
        onOpenNote: deps.onOpenNote,
      },
    });
    // `unmount()` returns a Promise (it awaits any outro transition before
    // removing the DOM) — `ChartHandle.destroy()` is fire-and-forget, same as
    // every other handle pushed here, so the promise is intentionally dropped.
    deps.activeViews.push({ destroy: () => { void unmount(instance); } });
    el.setAttribute('data-object-view-rendered', 'ok');
  }
}

function renderErrorHtml(msg: string): string {
  return `<div class="object-view-error" role="alert"><strong>Object view error</strong><pre>${escapeHtml(msg)}</pre></div>`;
}
