/**
 * The preview's citation engine, kept alive between render ticks (#2210 §3a).
 *
 * ── What this is for ────────────────────────────────────────────────────────
 * `Preview.svelte` re-renders on a 120ms debounce while you type, and every
 * render calls `api.citations.renderInline(refs)`. That handler was fully
 * uncached, and what it did per call was:
 *
 *   1. `loadCitationAssets` — `readdir` of `.minerva/{sources,excerpts}` plus
 *      one `readFile` + TTL→CSL parse per source and per excerpt;
 *   2. `assets.createRenderer()` — a fresh `CSL.Engine`, which compiles the
 *      86KB CSL style from scratch.
 *
 * Measured on a 1,000-source / 5,000-excerpt project with 12 citations in the
 * note: **6,000 `readFile` calls and 668ms per tick**, against a 120ms
 * debounce. The preview could not keep up with typing, and the main process
 * was pinned doing it.
 *
 * ── Where the issue's diagnosis was incomplete ──────────────────────────────
 * #2210 proposes memoizing `loadCitationAssets`, and frames the problem as a
 * large-library one. Half right. Of the 668ms, the asset load is 358ms and
 * `createRenderer()` is **296ms — and the engine cost does not scale with the
 * library at all**: 296ms at one source, 296ms at a thousand, because the
 * constructor compiles the *style*, not the items (`retrieveItem` is a lazy
 * callback).
 *
 * So memoizing the assets alone would have left ~300ms per tick on the table,
 * and would have fixed nothing for the ordinary case — a small thoughtbase
 * with a handful of sources was already paying ~300ms per keystroke tick, a
 * cost the issue's framing makes invisible. The cache below holds the compiled
 * renderer too, which is where most of the remaining win is.
 *
 * ── Why this is safe ────────────────────────────────────────────────────────
 * Two invariants, each with its own tests.
 *
 * **Freshness.** The cache is *armed by the watcher* and invalidated from it.
 * `createWatchHandlers` arms a project when chokidar starts watching
 * `.minerva/{sources,excerpts}`, and the same four callbacks that reindex a
 * source or excerpt into the graph also call `invalidateCitationAssets`,
 * before they broadcast `SOURCES_CHANGED` / `EXCERPTS_CHANGED`. An unarmed
 * project — a test, a headless CLI, a publish run with no window — never
 * serves a cached value and behaves exactly as before. That is the failure
 * mode we want: no watcher, no cache, no staleness. The CSL style/locale
 * import and remove handlers invalidate too, since those directories sit
 * outside the watched tree.
 *
 * **Session isolation.** A shared engine is only sound if each render session
 * starts clean and no two sessions interleave. `CitationRenderer.reset()`
 * handles the first (see its comment). The second is why the accessor is
 * `withPreviewRenderer(ctx, opts, use)` taking a *synchronous* `use` callback
 * rather than a getter returning the renderer: once the assets are in hand a
 * render is pure CPU, so a synchronous body cannot be interleaved by another
 * handler on Node's single thread. Handing the renderer back to a caller who
 * might `await` mid-session would reintroduce exactly the shared-state bug
 * this shape forbids.
 *
 * Exports and bibliography generation deliberately do NOT come through here —
 * they call `loadCitationAssets` directly. They are one-shot operations where
 * 668ms once is irrelevant and a stale answer would be written to disk.
 */
import { logger } from '../../shared/logger';
import { createProjectStore } from '../project-store';
import type { ProjectContext } from '../project-context-types';
import {
  loadCitationAssets,
  type CitationAssets,
  type CitationRenderer,
} from '../publish/csl';

/** Separator for the cache key — never legal inside a style or locale id. */
const KEY_SEP = '\u0000';

interface CachedBundle {
  /** The `styleId`+`localeId` pair this bundle was loaded for. */
  key: string;
  /**
   * The in-flight or settled load. Storing the PROMISE rather than the
   * resolved value is load-bearing: at 668ms per load against a 120ms
   * debounce, a typing burst previously had ~5 full library scans running
   * concurrently. Joining the pending one collapses a burst to a single load.
   */
  promise: Promise<{ assets: CitationAssets; renderer: CitationRenderer }>;
}

/**
 * A slot's mere existence is the "armed" flag; `bundle` is what it holds.
 *
 * An earlier draft also carried a generation counter, so that a load already
 * in flight when an invalidation arrived could be recognised as stale and
 * discarded. Writing the test for it showed the counter could never fire:
 * invalidation sets `bundle` to null, so a stale in-flight entry is already
 * unreachable from the slot, and any bundle read back from the slot was
 * necessarily stored after the last invalidation. The counter was dead code
 * defending an impossible state, so it is gone — see the in-flight test in
 * `assets-cache.test.ts` for the property that actually needs holding.
 */
interface CacheSlot {
  bundle: CachedBundle | null;
}

const slots = createProjectStore<CacheSlot>();

/**
 * Allow this project to cache. Called from `createWatchHandlers`, i.e. at the
 * moment the `.minerva/{sources,excerpts}` watcher that invalidates this cache
 * starts. Idempotent.
 */
export function armCitationAssetsCache(ctx: ProjectContext): void {
  if (slots.has(ctx)) return;
  slots.set(ctx, { bundle: null });
}

/**
 * Drop the cached assets + engine for this project. Cheap and idempotent; call
 * it from anything that writes a source `meta.ttl`, an excerpt `.ttl`, or a
 * user CSL style/locale. Over-invalidating costs one reload; under-
 * invalidating shows the user a stale citation marker, so prefer the former.
 */
export function invalidateCitationAssets(ctx: ProjectContext): void {
  const slot = slots.get(ctx);
  if (!slot) return;
  slot.bundle = null;
}

/**
 * Run `use` against a citation renderer for this project, reusing the cached
 * assets and compiled engine when they are still valid.
 *
 * `use` MUST be synchronous. See the module comment: the reset-and-reuse
 * contract holds for one session at a time, and a synchronous body is what
 * makes that structurally true rather than merely intended.
 */
export async function withPreviewRenderer<T>(
  ctx: ProjectContext,
  opts: { styleId?: string | undefined; localeId?: string | undefined },
  use: (renderer: CitationRenderer, assets: CitationAssets) => T,
): Promise<T> {
  const key = `${opts.styleId ?? ''}${KEY_SEP}${opts.localeId ?? ''}`;
  const slot = slots.get(ctx);

  // Unarmed: nothing is invalidating for this project, so caching would be a
  // correctness bug. Behave exactly as the uncached path always did.
  if (!slot) {
    const assets = await loadCitationAssets(ctx.rootPath, opts);
    return use(assets.createRenderer(), assets);
  }

  let bundle = slot.bundle;
  if (!bundle || bundle.key !== key) {
    const entry: CachedBundle = {
      key,
      promise: loadCitationAssets(ctx.rootPath, opts).then((assets) => ({
        assets,
        renderer: assets.createRenderer(),
      })),
    };
    // A rejected load must not stay cached — the next tick should retry
    // rather than replay the failure forever. This does NOT swallow the
    // rejection: the caller still awaits `entry.promise` below and sees it.
    // The binding is here so the failure is visible in the log rather than
    // only as a mysteriously re-loading cache.
    entry.promise.catch((err: unknown) => {
      if (slot.bundle === entry) slot.bundle = null;
      logger('preview').debug('citation assets failed to load; dropped from cache:', err);
    });
    slot.bundle = entry;
    bundle = entry;
  }

  const { assets, renderer } = await bundle.promise;

  // That await is the only suspension point; everything from here down is
  // synchronous, so this session owns the engine until `use` returns.
  renderer.reset();
  return use(renderer, assets);
}

/** Cache state, for tests and diagnostics. */
export function _citationCacheStateForTests(ctx: ProjectContext): {
  armed: boolean;
  hasBundle: boolean;
} {
  const slot = slots.get(ctx);
  return { armed: slot !== null, hasBundle: slot?.bundle != null };
}
