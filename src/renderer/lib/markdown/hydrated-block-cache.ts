/**
 * Keep hydrated block content alive across `{@html rendered}` swaps (#2323).
 *
 * `Preview.svelte` renders through `{@html rendered}`, which replaces the whole
 * subtree on every ~120ms render tick. Four hydrators guard against re-running
 * with an attribute on the placeholder (`.mermaid-block:not([data-mermaid-rendered])`
 * and friends). **That guard is never false — it is never asked**, because the
 * element it was written on no longer exists. So every tick re-runs the whole
 * expensive step on a brand-new placeholder.
 *
 * #2318 and #2322 fixed their halves of §3c by caching the *data* a block binds
 * to. That doesn't transfer here, because what's expensive produces **DOM**:
 *
 * - `mermaid.render()` returns `{ svg, bindFunctions }`, and `bindFunctions(el)`
 *   installs the listeners that make a diagram interactive. Caching the SVG
 *   *string* and re-inserting it drops them — the diagram still looks right and
 *   stops responding, the worst failure shape available. (Measured under the
 *   app's own `securityLevel: 'strict'`: `bindFunctions` still installs four
 *   `mouseover`/`mouseout` tooltip listeners on `.clickable` nodes. Strict only
 *   suppresses the `click`-callback listener, so the hazard is real, not
 *   theoretical.)
 * - `object-view-renderer` / `argument-map-renderer` mount a live Svelte
 *   component per block. A cached HTML string of its output is inert.
 *
 * So reuse means reusing the **nodes**.
 *
 * ## Why a wrapper, and not `placeholder.replaceWith(cachedNode)`
 *
 * Svelte 5's `{@html}` records the first and last top-level node it inserted
 * (`effect.nodes = { start, end }`; see `svelte/src/internal/client/dom/blocks/html.js`)
 * and removes the range by walking siblings from `start` on the next update.
 * A `.mermaid-block` is a *top-level* node of that fragment, so replacing one
 * that happens to be `start` or `end` — a note that opens or ends with a diagram,
 * which `website/screenshots/fixtures/notes/diagrams.md` literally is — leaves
 * Svelte holding a detached reference and the removal walk stops early. The
 * failure mode is duplicated content, not a missing diagram.
 *
 * So the node Svelte created is never touched. Each hydrator renders into a
 * `<div class="hydrated-block-content">` **we** own, and reuse moves that
 * wrapper into the fresh placeholder. The wrapper is `display: contents`
 * (`global.css`) so it generates no box: `.mermaid-block svg`, the block's
 * `display:flex` centering, and `.object-view-block[…="ok"]`'s 360px height
 * chain all behave exactly as before.
 *
 * Moving a node preserves everything bound to it or inside it — listeners live
 * on nodes, not on trees — so `bindFunctions`' handlers and a mounted
 * component's effects survive because it is literally the same node.
 *
 * ## The four wrinkles
 *
 * 1. **Duplicate sources.** Two blocks with identical source text cannot share
 *    one node. `blockKey` appends a per-source occurrence index, so a note with
 *    the same diagram twice gets two entries (`src#0`, `src#1`). Counting per
 *    *source* rather than per *pass* means inserting an unrelated block above
 *    doesn't renumber — and therefore doesn't invalidate — everything below it.
 * 2. **Theme invalidation.** `clearSlot(slot)` drops a slot across every root;
 *    `invalidateMermaidTheme()` calls it, so a theme or content-font change
 *    re-renders rather than restoring stale-coloured SVG. The mounted views need
 *    no equivalent — they are styled through CSS custom properties and re-skin
 *    in place (their module headers already say so).
 * 3. **Lifetime.** `sweep(root)` drops every entry whose wrapper is no longer
 *    inside `root`, running its `destroy` hook. A block deleted from the note,
 *    or a whole note switched away from, is evicted on the very next pass, so
 *    the cache is bounded by the blocks currently on screen. `disposeCaches(root)`
 *    covers Preview teardown, when no further pass will run.
 * 4. **Does the attribute guard still earn its keep?** Yes, for the job it was
 *    always able to do, and no, it is not the whole fix. Restoring a wrapper
 *    also stamps `data-*-rendered` on the fresh placeholder, so a *second* pass
 *    over the *same* rendered HTML — a `revision`-only effect run, or
 *    `updateTheme()`'s re-hydrate — skips the block for free, which is what the
 *    guard was written for. It still cannot see across the swap; the cache
 *    lookup is what does that.
 *
 * ## Per root, not per module
 *
 * `App.svelte` mounts one `<Preview>` per editor group, so a module-level cache
 * would let one preview's sweep evict another's live nodes. Caches are keyed on
 * the preview root element, which is stable across ticks (`bind:this` — only its
 * children are swapped).
 */

interface Entry {
  wrapper: HTMLElement;
  destroy: (() => void) | undefined;
}

export class HydratedBlockCache {
  readonly #entries = new Map<string, Entry>();

  /**
   * The wrapper previously hydrated for `key`, if it is currently detached from
   * `root` and therefore free to re-adopt. A wrapper still inside `root` belongs
   * to a block that is already on screen — moving it would steal it.
   */
  take(root: HTMLElement, key: string): HTMLElement | null {
    const entry = this.#entries.get(key);
    if (!entry || root.contains(entry.wrapper)) return null;
    return entry.wrapper;
  }

  /**
   * Remember `wrapper` as the hydrated result for `key`.
   *
   * A wrapper that is no longer inside `root` belongs to a superseded pass — an
   * async hydrator (mermaid) can finish after `{@html}` has already discarded
   * the placeholder it was rendering into. Caching it would hand a later tick a
   * node from a note that may no longer be open, so it is destroyed instead.
   */
  put(root: HTMLElement, key: string, wrapper: HTMLElement, destroy?: () => void): void {
    if (!root.contains(wrapper)) {
      destroy?.();
      return;
    }
    const prev = this.#entries.get(key);
    if (prev && prev.wrapper !== wrapper) prev.destroy?.();
    this.#entries.set(key, { wrapper, destroy });
  }

  /** Drop (and destroy) every entry whose wrapper is no longer inside `root`. */
  sweep(root: HTMLElement): void {
    for (const [key, entry] of this.#entries) {
      if (root.contains(entry.wrapper)) continue;
      entry.destroy?.();
      this.#entries.delete(key);
    }
  }

  clear(): void {
    for (const entry of this.#entries.values()) entry.destroy?.();
    this.#entries.clear();
  }

  /** Live entry count — for tests asserting the cache stays bounded. */
  get size(): number {
    return this.#entries.size;
  }
}

/** Class on the wrapper each hydrator renders into; `display: contents`. */
export const HYDRATED_CONTENT_CLASS = 'hydrated-block-content';

/** A fresh wrapper for a hydrator to render into. */
export function createContentWrapper(): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = HYDRATED_CONTENT_CLASS;
  return wrapper;
}

const byRoot = new Map<HTMLElement, Map<string, HydratedBlockCache>>();

/** The cache for one hydrator (`slot`) under one preview root. */
export function blockCacheFor(root: HTMLElement, slot: string): HydratedBlockCache {
  let slots = byRoot.get(root);
  if (!slots) {
    slots = new Map();
    byRoot.set(root, slots);
  }
  let cache = slots.get(slot);
  if (!cache) {
    cache = new HydratedBlockCache();
    slots.set(slot, cache);
  }
  return cache;
}

/** Drop one hydrator's cache across every root (theme / font invalidation). */
export function clearSlot(slot: string): void {
  for (const slots of byRoot.values()) slots.get(slot)?.clear();
}

/**
 * Drop every cache for `root`. Called from `Preview.svelte`'s `onDestroy` — the
 * sweep on the next pass can't cover teardown, because there is no next pass,
 * and a mounted `TypeView` in `map` layout holds a live MapLibre GL context.
 */
export function disposeCaches(root: HTMLElement): void {
  const slots = byRoot.get(root);
  if (!slots) return;
  for (const cache of slots.values()) cache.clear();
  byRoot.delete(root);
}

/**
 * Key a block by its source text plus how many blocks with that *same* source
 * have already been seen in this pass. `counts` is caller-owned so one pass
 * shares it across every block it walks.
 */
export function blockKey(counts: Map<string, number>, source: string): string {
  const n = counts.get(source) ?? 0;
  counts.set(source, n + 1);
  return `${source}\u0000#${n}`;
}
