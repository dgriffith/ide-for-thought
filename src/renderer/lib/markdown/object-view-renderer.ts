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
 * That refresh cadence is what the `{@html rendered}` swap was quietly taking
 * away (#2323): each tick handed the hydrator a brand-new placeholder with no
 * `data-object-view-rendered` on it, so every embed re-mounted — and each mount
 * runs `api.types.instances`, a full SPARQL projection with one OPTIONAL per
 * declared property. Measured at **90ms (1,000-note vault) / 355ms (3,000)** of
 * main-process query time, per block, per ~120ms tick. So the mounted instance
 * is now **preserved** across ticks: the hydrator renders into a wrapper it
 * owns and moves that wrapper into the next tick's placeholder, which is the
 * refresh cadence the paragraph above always described.
 *
 * Two consequences:
 *
 * - **`revision` has to be a real prop.** `mount()` only propagates writes
 *   through a `$state` props object; a plain one froze `revision` at its mount
 *   value. Nothing noticed while every tick re-mounted. See
 *   `mounted-props.svelte.ts`.
 * - **Cleanup moved into the cache.** This used to be torn down through the
 *   plain `deps.activeViews` array `Preview.svelte` also uses for
 *   `activeCharts`, because by the time the revision effect ran, `{@html
 *   rendered}` had already replaced the old placeholders and a `WeakMap` keyed
 *   on the discarded element couldn't be re-derived from the DOM. The block
 *   cache keys on the wrapper instead, which is exactly the node that survives,
 *   so it can both re-adopt a live mount and `unmount()` one whose block is
 *   gone — `sweep()` on every pass, `disposeCaches()` on Preview teardown.
 */
import { mount, unmount } from 'svelte';
import TypeView from '../components/TypeView.svelte';
import type { ViewLayout } from '../../../shared/types';
import { escapeHtml } from '../../../shared/text-escape';
import { blockCacheFor, blockKey, createContentWrapper, HYDRATED_CONTENT_CLASS } from './hydrated-block-cache';
import { reactiveProps } from './mounted-props.svelte';

/** Cache slot for mounted object-view wrappers — see `hydrated-block-cache.ts`. */
const SLOT = 'object-view';

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
}

/** The props a mounted `TypeView` embed is driven through, kept reactive. */
type ViewProps = {
  typeId: string;
  layout: ViewLayout;
  sortColumn: string | null;
  sortDir: 'asc' | 'desc';
  columns: string[] | null;
  revision: number;
  chromeless: boolean;
  onStateChange: () => void;
  onOpenNote: (relativePath: string) => void;
};

/** Per-wrapper handle for a live mount, so a re-adopted one can be refreshed. */
const mountedProps = new WeakMap<HTMLElement, ViewProps>();

/**
 * Walk `root` for unrendered `.object-view-block` placeholders and mount a
 * chromeless `TypeView` into each.
 *
 * A block whose spec was already mounted under this root gets its **live mount
 * moved back in** rather than re-mounted (#2323); `deps.revision` is written
 * onto the preserved props so a save still re-projects it. Idempotent within
 * one rendered subtree: blocks already marked `data-object-view-rendered` are
 * skipped, so the post-render `$effect` firing repeatedly doesn't double-mount.
 */
export function hydrateObjectViewBlocks(root: HTMLElement, deps: ObjectViewDeps): void {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>('.object-view-block:not([data-object-view-rendered])'),
  );
  const cache = blockCacheFor(root, SLOT);
  // No early return on an empty `blocks`: a note switched to one with no
  // embeds at all still has to sweep, or the outgoing note's mounts stay
  // cached (and, in `map` layout, hold a live MapLibre GL context) until the
  // preview is destroyed. When nothing changed the sweep is a no-op, because
  // every wrapper is still inside `root`.
  const counts = new Map<string, number>();
  for (const el of blocks) {
    const raw = (el.textContent ?? '').trim();
    const key = blockKey(counts, raw);
    el.removeAttribute('data-object-view-pending');

    const cached = cache.take(root, key);
    if (cached) {
      el.innerHTML = '';
      el.appendChild(cached);
      // A preserved mount keeps the props object it was mounted with, so a
      // graph change reaches `TypeView`'s own `$effect` the same way a
      // re-mount used to.
      const props = mountedProps.get(cached);
      if (props) props.revision = deps.revision;
      el.setAttribute('data-object-view-rendered', cached.dataset.objectViewResult ?? 'ok');
      continue;
    }

    let spec: ObjectViewSpec;
    try {
      spec = parseObjectViewSpec(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // A malformed spec is a function of the fence text, not a transient
      // failure, so the rendered message is cached like a mounted view — the
      // next tick restores it instead of re-parsing and re-building it.
      const wrapper = createContentWrapper();
      wrapper.innerHTML = renderErrorHtml(msg);
      wrapper.dataset.objectViewResult = 'error';
      el.innerHTML = '';
      el.appendChild(wrapper);
      el.setAttribute('data-object-view-rendered', 'error');
      cache.put(root, key, wrapper);
      continue;
    }

    const wrapper = createContentWrapper();
    el.innerHTML = '';
    el.appendChild(wrapper);
    const props = reactiveProps<ViewProps>({
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
    });
    const instance = mount(TypeView, { target: wrapper, props });
    mountedProps.set(wrapper, props);
    wrapper.dataset.objectViewResult = 'ok';
    el.setAttribute('data-object-view-rendered', 'ok');
    // `unmount()` returns a Promise (it awaits any outro transition before
    // removing the DOM) — teardown here is fire-and-forget, as it was when
    // `Preview.svelte` held these handles, so the promise is dropped.
    cache.put(root, key, wrapper, () => { void unmount(instance); });
  }

  cache.sweep(root);

  // Forward `revision` to every embed currently on screen, not just the ones
  // this pass touched. A save doesn't change `content`, so `{@html rendered}`
  // does NOT re-run — the post-render effect fires again over the *same* DOM
  // with a new revision, the `:not([data-object-view-rendered])` selector
  // matches nothing, and the loop above never sees the block. Writing here is
  // what keeps "TypeView re-projects against `revision` while mounted" true
  // once the mount stops being rebuilt every tick.
  for (const wrapper of root.querySelectorAll<HTMLElement>(`.${HYDRATED_CONTENT_CLASS}`)) {
    const props = mountedProps.get(wrapper);
    if (props) props.revision = deps.revision;
  }
}

function renderErrorHtml(msg: string): string {
  return `<div class="object-view-error" role="alert"><strong>Object view error</strong><pre>${escapeHtml(msg)}</pre></div>`;
}
