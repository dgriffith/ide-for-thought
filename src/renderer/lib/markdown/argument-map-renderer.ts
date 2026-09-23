/**
 * Live argument-map view embedded in a note's preview (#907).
 *
 * Mirrors `object-view-renderer.ts`'s shape exactly: the directive rule in
 * `markdown-config.ts` emits a placeholder `<div class="argument-map-block">`
 * carrying the focus wiki-link + optional config on data attributes;
 * `hydrateArgumentMapBlocks` walks the DOM and mounts a live `ArgumentMap`
 * into each un-rendered one via Svelte 5's `mount()`/`unmount()` — needed
 * (rather than an HTML string, the `:::query-*` family's approach) because
 * the outline/diagram toggle and depth stepper are real interactive state.
 *
 * Refresh cadence matches vega/mermaid/object-view: a mounted instance is
 * idempotent (`data-argument-map-rendered`) and only (re-)renders when its
 * placeholder DOM is freshly created — a note reopen, or an edit to the
 * directive's own text — not a live poll against graph changes.
 *
 * `{@html rendered}` was quietly turning that into a poll at ~8Hz (#2323): a
 * fresh placeholder every render tick carried no `data-argument-map-rendered`,
 * so every keystroke re-mounted and re-ran the BFS — a focus query, one query
 * per hop, and a defects query, each a full SPARQL execution (one of those
 * alone measured **182ms at 1,000 notes / 556ms at 3,000**). It also reset the
 * outline/diagram toggle and the depth stepper mid-edit. The mount is
 * preserved across ticks now, via the same wrapper node the block cache moves
 * for mermaid and object-view — which is exactly the cadence described above.
 */
import { mount, unmount } from 'svelte';
import ArgumentMap from '../components/ArgumentMap.svelte';
import { escapeHtml } from '../../../shared/text-escape';
import { blockCacheFor, blockKey, createContentWrapper } from './hydrated-block-cache';

/** Cache slot for mounted argument-map wrappers — see `hydrated-block-cache.ts`. */
const SLOT = 'argument-map';

export interface ArgumentMapDeps {
  queryPrefixes: string;
  resolvePath: (target: string) => string | null;
  onNavigate: (relativePath: string) => void;
}

/**
 * Walk `root` for unrendered `.argument-map-block` placeholders and mount a
 * live `ArgumentMap` into each.
 *
 * A block whose focus + config was already mounted under this root gets its
 * **live mount moved back in** rather than re-mounted (#2323), so the BFS runs
 * once and the user's view/depth controls keep their state. Idempotent within
 * one rendered subtree: blocks already marked `data-argument-map-rendered` are
 * skipped, so the post-render `$effect` firing repeatedly doesn't double-mount.
 */
export function hydrateArgumentMapBlocks(root: HTMLElement, deps: ArgumentMapDeps): void {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>('.argument-map-block:not([data-argument-map-rendered])'),
  );
  const cache = blockCacheFor(root, SLOT);
  // No early return on an empty `blocks` — see `object-view-renderer.ts` for
  // why the sweep has to run even when there is nothing to hydrate.
  const counts = new Map<string, number>();

  for (const el of blocks) {
    const focusRef = el.dataset.focus ?? '';
    const rawConfig = el.dataset.config ?? '{}';
    // Both attributes feed the mount, so both key the cache — changing the
    // depth or the view in the directive text must produce a fresh map.
    const key = blockKey(counts, `${focusRef}\u0000${rawConfig}`);

    const cached = cache.take(root, key);
    if (cached) {
      el.innerHTML = '';
      el.appendChild(cached);
      el.setAttribute('data-argument-map-rendered', cached.dataset.argumentMapResult ?? 'ok');
      continue;
    }

    let config: Record<string, string> = {};
    try {
      config = JSON.parse(rawConfig) as Record<string, string>;
    } catch { /* malformed config — fall through to defaults */ }

    const wrapper = createContentWrapper();
    el.innerHTML = '';
    el.appendChild(wrapper);

    if (!focusRef.trim()) {
      // Deterministic in the directive text, so cached like a mounted map.
      wrapper.innerHTML = renderErrorHtml('The :::argument block needs a focus wiki-link, e.g. [[Some Claim]].');
      wrapper.dataset.argumentMapResult = 'error';
      el.setAttribute('data-argument-map-rendered', 'error');
      cache.put(root, key, wrapper);
      continue;
    }

    const initialDepth = config.depth ? Number.parseInt(config.depth, 10) : undefined;
    const instance = mount(ArgumentMap, {
      target: wrapper,
      props: {
        focusRef,
        queryPrefixes: deps.queryPrefixes,
        resolvePath: deps.resolvePath,
        onNavigate: deps.onNavigate,
        ...(initialDepth && Number.isFinite(initialDepth) ? { initialDepth } : {}),
        ...(config.view === 'diagram' || config.view === 'outline' ? { initialView: config.view } : {}),
      },
    });
    wrapper.dataset.argumentMapResult = 'ok';
    el.setAttribute('data-argument-map-rendered', 'ok');
    // `unmount()` returns a Promise (it awaits any outro transition before
    // removing the DOM) — teardown is fire-and-forget, as it was when
    // `Preview.svelte` held these handles, so the promise is dropped.
    cache.put(root, key, wrapper, () => { void unmount(instance); });
  }

  cache.sweep(root);
}

function renderErrorHtml(msg: string): string {
  return `<p class="query-error">${escapeHtml(msg)}</p>`;
}
