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
 */
import { mount, unmount } from 'svelte';
import ArgumentMap from '../components/ArgumentMap.svelte';
import type { ChartHandle } from '../charts/types';
import { escapeHtml } from '../../../shared/text-escape';

export interface ArgumentMapDeps {
  queryPrefixes: string;
  resolvePath: (target: string) => string | null;
  onNavigate: (relativePath: string) => void;
  /** Live mounts to destroy, owned by the host (mirrors `activeCharts` /
   *  `activeObjectViews`). */
  activeMaps: ChartHandle[];
}

/**
 * Walk `root` for unrendered `.argument-map-block` placeholders and mount a
 * live `ArgumentMap` into each. Idempotent: blocks already marked
 * `data-argument-map-rendered` are skipped, so the post-render `$effect`
 * firing repeatedly doesn't double-mount.
 */
export function hydrateArgumentMapBlocks(root: HTMLElement, deps: ArgumentMapDeps): void {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>('.argument-map-block:not([data-argument-map-rendered])'),
  );
  if (blocks.length === 0) return;

  for (const el of blocks) {
    const focusRef = el.dataset.focus ?? '';
    let config: Record<string, string> = {};
    try {
      config = JSON.parse(el.dataset.config ?? '{}') as Record<string, string>;
    } catch { /* malformed config — fall through to defaults */ }

    if (!focusRef.trim()) {
      el.innerHTML = renderErrorHtml('The :::argument block needs a focus wiki-link, e.g. [[Some Claim]].');
      el.setAttribute('data-argument-map-rendered', 'error');
      continue;
    }

    el.innerHTML = '';
    const initialDepth = config.depth ? Number.parseInt(config.depth, 10) : undefined;
    const instance = mount(ArgumentMap, {
      target: el,
      props: {
        focusRef,
        queryPrefixes: deps.queryPrefixes,
        resolvePath: deps.resolvePath,
        onNavigate: deps.onNavigate,
        ...(initialDepth && Number.isFinite(initialDepth) ? { initialDepth } : {}),
        ...(config.view === 'diagram' || config.view === 'outline' ? { initialView: config.view } : {}),
      },
    });
    // `unmount()` returns a Promise (it awaits any outro transition before
    // removing the DOM) — same fire-and-forget shape every other handle
    // pushed to these arrays uses.
    deps.activeMaps.push({ destroy: () => { void unmount(instance); } });
    el.setAttribute('data-argument-map-rendered', 'ok');
  }
}

function renderErrorHtml(msg: string): string {
  return `<p class="query-error">${escapeHtml(msg)}</p>`;
}
