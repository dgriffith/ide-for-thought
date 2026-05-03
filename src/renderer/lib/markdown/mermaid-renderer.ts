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

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, source: string) => Promise<{ svg: string; bindFunctions?: (el: Element) => void }>;
};

let mermaidPromise: Promise<MermaidApi> | null = null;
let initializedFor: 'dark' | 'light' | 'contrast' | null = null;
let counter = 0;

async function loadMermaid(): Promise<MermaidApi> {
  if (mermaidPromise) return mermaidPromise;
  mermaidPromise = import('mermaid').then((m) => {
    const api = (m.default ?? m) as unknown as MermaidApi;
    return api;
  });
  return mermaidPromise;
}

function ensureInitialized(api: MermaidApi): void {
  const effective = getEffectiveTheme(getThemeMode());
  if (initializedFor === effective) return;
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
      fontFamily: 'inherit',
    },
  });
  initializedFor = effective;
}

function readThemeTokens(): {
  bg: string; bgTitlebar: string; bgButton: string;
  text: string; textMuted: string; border: string; accent: string;
} {
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string) => cs.getPropertyValue(name).trim() || '';
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
 * Walk `root` for unrendered `.mermaid-block` placeholders and replace
 * each one's content with rendered SVG. Idempotent: blocks already
 * rendered (marked with `data-mermaid-rendered`) are skipped, so
 * multiple `$effect` runs after a debounced re-render don't double-render.
 */
export async function hydrateMermaidBlocks(root: HTMLElement): Promise<void> {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>('.mermaid-block:not([data-mermaid-rendered])'),
  );
  if (blocks.length === 0) return;

  let api: MermaidApi;
  try {
    api = await loadMermaid();
    ensureInitialized(api);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    for (const el of blocks) {
      el.setAttribute('data-mermaid-rendered', 'error');
      el.innerHTML = renderErrorHtml(`Failed to load mermaid: ${msg}`);
    }
    return;
  }

  await Promise.all(blocks.map(async (el) => {
    // Source lives either in textContent (first hydration) or stashed
    // on dataset.mermaidSource (re-hydration after a theme change).
    // Capture it before mutating innerHTML, since pending/error
    // rendering would otherwise wipe it.
    const source = (el.dataset.mermaidSource ?? el.textContent ?? '').trim();
    el.dataset.mermaidSource = source;
    el.removeAttribute('data-mermaid-pending');
    el.setAttribute('data-mermaid-rendered', 'pending');
    el.innerHTML = '';
    try {
      const id = `mermaid-${++counter}`;
      const { svg, bindFunctions } = await api.render(id, source);
      el.innerHTML = svg;
      el.setAttribute('data-mermaid-rendered', 'ok');
      if (bindFunctions) bindFunctions(el);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      el.innerHTML = renderErrorHtml(msg);
      el.setAttribute('data-mermaid-rendered', 'error');
    }
  }));
}

/**
 * Reset cached theme so the next render re-initializes mermaid with
 * the current theme variables. Call after a theme change.
 */
export function invalidateMermaidTheme(): void {
  initializedFor = null;
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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
