/**
 * Lazy-loaded mermaid diagram renderer (#467).
 *
 * The fence rule emits placeholder `<div class="mermaid-block">` nodes
 * carrying the raw source on a data attribute. After preview HTML is
 * injected, `hydrateMermaidBlocks` walks the DOM, dynamic-imports
 * mermaid on first use, and replaces each placeholder with rendered
 * SVG. Errors render inline so a single bad diagram can't brick the
 * page.
 *
 * Catppuccin theming: the base mermaid theme follows the app's current
 * theme mode (dark/light/contrast). We override the most visible
 * variables to use our CSS tokens so diagrams blend with the
 * surrounding note.
 */

import { getEffectiveTheme, getThemeMode } from '../theme';
import { normalizeColor } from '../utils/oklch';
import { sanitizeDiagramSvg } from './sanitize-diagram-svg';
import { escapeHtml } from '../../../shared/text-escape';
import { blockCacheFor, blockKey, clearSlot, createContentWrapper } from './hydrated-block-cache';

/** Cache slot for rendered diagram wrappers — see `hydrated-block-cache.ts`. */
const SLOT = 'mermaid';

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, source: string) => Promise<{ svg: string; bindFunctions?: (el: Element) => void }>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;
/** `<theme>|<label font>` — both feed themeVariables, so both must key the cache. */
let initializedFor: string | null = null;
let counter = 0;

async function loadMermaid(): Promise<MermaidApi> {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = import('mermaid').then((m) => {
    const api = (m.default ?? m) as unknown as MermaidApi;
    return api;
  });
  return mermaidPromise;
}

function ensureInitialized(api: MermaidApi, fontFamily: string): void {
  const key = `${getEffectiveTheme(getThemeMode())}|${fontFamily}`;
  if (initializedFor === key) return;
  // Mermaid's `base` theme accepts variable overrides; using it instead
  // of `dark` / `default` lets us pin every color to a catppuccin token.
  const tokens = readThemeTokens();
  api.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    themeVariables: {
      background: tokens.bg,
      primaryColor: tokens.bgButton,
      primaryTextColor: tokens.text,
      primaryBorderColor: tokens.border,
      secondaryColor: tokens.bgButton,
      tertiaryColor: tokens.bgTitlebar,
      lineColor: tokens.textMuted,
      textColor: tokens.text,
      mainBkg: tokens.bgButton,
      nodeBorder: tokens.accent,
      clusterBkg: tokens.bgTitlebar,
      clusterBorder: tokens.border,
      titleColor: tokens.text,
      edgeLabelBackground: tokens.bg,
      fontFamily,
    },
  });
  initializedFor = key;
}

/**
 * The font mermaid's labels will actually be drawn in (#1802).
 *
 * Mermaid sizes each label by rendering it into a temp div it appends to
 * `document.body`, then bakes that measurement into a fixed-width
 * `<foreignObject>`. The finished SVG is injected into `.preview`, which uses
 * the *content* font (`--content-font-family`) while `body` uses the *UI* font
 * (`--font-sans`). Passing `fontFamily: 'inherit'` let those two disagree:
 * every label was measured in one font and drawn in another, so under any
 * non-default Appearance → Content font preset the text overran the box it was
 * sized for and the foreignObject clipped it ("Write a n", "Knowledge grap").
 *
 * Resolving the preview's own computed family and handing mermaid that concrete
 * stack makes measurement and render agree, so a long label wraps at mermaid's
 * `wrappingWidth` instead of being cut.
 */
function labelFontFamily(root: HTMLElement): string {
  return getComputedStyle(root).fontFamily || 'inherit';
}

function readThemeTokens(): {
  bg: string; bgTitlebar: string; bgButton: string;
  text: string; textMuted: string; border: string; accent: string;
} {
  const cs = getComputedStyle(document.documentElement);
  // Our theme tokens are authored in `oklch()` (CSS Color 4). The browser
  // renders them fine, but mermaid's color lib (khroma) can't parse `oklch()`
  // and throws "Unsupported color format", bricking every diagram. Convert
  // each oklch token to an sRGB hex string khroma accepts (non-oklch tokens,
  // e.g. the contrast theme's hex values, pass through untouched).
  const get = (name: string) => normalizeColor(cs.getPropertyValue(name).trim());
  return {
    bg: get('--bg'),
    bgTitlebar: get('--bg-titlebar'),
    bgButton: get('--bg-button'),
    text: get('--text'),
    textMuted: get('--text-muted'),
    border: get('--border'),
    accent: get('--accent'),
  };
}

/**
 * Walk `root` for unrendered `.mermaid-block` placeholders and fill each one
 * with rendered SVG.
 *
 * A block whose source was already rendered under this root gets its **existing
 * SVG node moved back in** rather than re-rendered (#2323) — `mermaid.render()`
 * is ~17-22ms of dagre layout for a four-node flowchart and ~79ms for a
 * thirty-node one, per diagram, on the renderer's main thread, and the
 * `{@html}` swap was asking for it once per render tick. Moving the node (not
 * re-inserting its markup) is what keeps `bindFunctions`' tooltip handlers
 * alive; see `hydrated-block-cache.ts`.
 *
 * Still idempotent within one rendered subtree: blocks already marked
 * `data-mermaid-rendered` are skipped, so repeated `$effect` runs over the same
 * DOM don't double-render.
 */
export async function hydrateMermaidBlocks(root: HTMLElement): Promise<void> {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>('.mermaid-block:not([data-mermaid-rendered])'),
  );
  const cache = blockCacheFor(root, SLOT);
  // No early return on an empty `blocks`: a note switched to one with no
  // diagrams still has to sweep, or the outgoing note's SVG stays cached. When
  // nothing changed the sweep is a no-op — every wrapper is still in `root`.
  if (blocks.length === 0) {
    cache.sweep(root);
    return;
  }

  const counts = new Map<string, number>();
  // Source lives either in textContent (first hydration) or stashed on
  // dataset.mermaidSource (re-hydration after a theme change). Capture it
  // before mutating innerHTML, since pending/error rendering would wipe it.
  // Keys are assigned in document order, synchronously, before any await —
  // the async render below must not interleave two blocks' occurrence counts.
  const pending = blocks.map((el) => {
    const source = (el.dataset.mermaidSource ?? el.textContent ?? '').trim();
    el.dataset.mermaidSource = source;
    return { el, source, key: blockKey(counts, source) };
  });

  // Restore what we already have before loading the library: a note whose
  // diagrams are all cached never touches mermaid at all.
  const toRender = pending.filter(({ el, key }) => {
    const wrapper = cache.take(root, key);
    if (!wrapper) return true;
    el.removeAttribute('data-mermaid-pending');
    el.innerHTML = '';
    el.appendChild(wrapper);
    el.setAttribute('data-mermaid-rendered', wrapper.dataset.mermaidResult ?? 'ok');
    return false;
  });

  if (toRender.length === 0) {
    cache.sweep(root);
    return;
  }

  let api: MermaidApi;
  try {
    api = await loadMermaid();
    ensureInitialized(api, labelFontFamily(root));
  } catch (err) {
    // A failed library load is transient (unlike a parse error, which is a
    // function of the source) — render it inline but never cache it, so the
    // next tick retries instead of freezing the failure into the note.
    const msg = err instanceof Error ? err.message : String(err);
    for (const { el } of toRender) {
      el.setAttribute('data-mermaid-rendered', 'error');
      el.innerHTML = renderErrorHtml(`Failed to load mermaid: ${msg}`);
    }
    cache.sweep(root);
    return;
  }

  await Promise.all(toRender.map(async ({ el, source, key }) => {
    el.removeAttribute('data-mermaid-pending');
    el.setAttribute('data-mermaid-rendered', 'pending');
    const wrapper = createContentWrapper();
    el.innerHTML = '';
    el.appendChild(wrapper);
    let result: 'ok' | 'error' = 'ok';
    try {
      const id = `mermaid-${++counter}`;
      const { svg, bindFunctions } = await api.render(id, source);
      // Defense in depth behind CSP (#1331): scrub the library-generated SVG
      // before it hits the DOM. bindFunctions runs after and re-queries the
      // sanitised nodes by id/class (both preserved), so interactivity survives.
      wrapper.innerHTML = sanitizeDiagramSvg(svg);
      if (bindFunctions) bindFunctions(wrapper);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      wrapper.innerHTML = renderErrorHtml(msg);
      result = 'error';
    }
    // A parse failure is deterministic in the source text, so it is cached like
    // a success — re-running a throwing parse every tick is the same waste.
    wrapper.dataset.mermaidResult = result;
    el.setAttribute('data-mermaid-rendered', result);
    cache.put(root, key, wrapper);
  }));

  cache.sweep(root);
}

/**
 * Reset cached theme so the next render re-initializes mermaid with
 * the current theme variables. Call after a theme *or* content-font change —
 * both feed themeVariables, and a font change also resizes every label (#1802).
 */
export function invalidateMermaidTheme(): void {
  initializedFor = null;
  // Wrinkle 2 of #2323: without this the next hydration would restore the
  // old-palette SVG node from the cache and the theme switch would appear to
  // do nothing to diagrams. Slot-wide, matching the global DOM sweep below.
  clearSlot(SLOT);
  // Clear rendered state so subsequent hydration reapplies the new
  // theme rather than keeping stale SVG.
  document.querySelectorAll('.mermaid-block[data-mermaid-rendered]').forEach((el) => {
    el.removeAttribute('data-mermaid-rendered');
    if (el instanceof HTMLElement) el.innerHTML = '';
  });
}

function renderErrorHtml(msg: string): string {
  return `<div class="mermaid-error" role="alert"><strong>Mermaid error</strong><pre>${escapeHtml(msg)}</pre></div>`;
}
