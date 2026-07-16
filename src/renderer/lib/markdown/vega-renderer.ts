/**
 * Lazy-loaded Vega-Lite / Vega chart renderer (#827 / #828 / #829).
 *
 * Mirrors the Mermaid path (`mermaid-renderer.ts`): the fence rule emits a
 * placeholder `<div class="vega-block">` carrying the raw JSON spec as text
 * content. After preview HTML is injected, `hydrateVegaBlocks` walks the DOM,
 * dynamic-imports `vega-embed` on first use (it's large — never bundle it into
 * the main chunk), and renders each spec into its placeholder. Errors render
 * inline so a single bad spec can't brick the page.
 *
 * Both ```vega-lite and ```vega fences route here; `vega-embed` compiles and
 * renders either, so full Vega is nearly free. The fence's `data-vega-mode`
 * (`lite` | `full`) selects the embed mode.
 *
 * Security (#829): a note can arrive via import, the clipper, or a shared
 * vault, so a chart spec is partially-untrusted input. Two guardrails, both
 * defense-in-depth:
 *   1. The Vega data `loader` is replaced with one that rejects every remote
 *      / file fetch — only inline `data.values` render. (#832 will add a
 *      safe-path-resolved local-vault data form; until then any `url` is
 *      refused.)
 *   2. Before embedding we scan the spec for any `url` reference and, if one
 *      is present, short-circuit to a clear "remote data disabled" notice
 *      rather than a silent empty chart.
 * Expressions run through Vega's CSP-safe interpreter: the renderer's CSP has
 * no `unsafe-eval`, so Vega's default `new Function` codegen would throw.
 * Passing `ast: true` makes vega-embed select the interpreter automatically.
 * We also strip any `usermeta.embedOptions` from the spec — vega-embed merges
 * those over our options, which would otherwise let a spec re-enable codegen
 * or swap the loader.
 *
 * Theme (#828): a Vega `config` built from the live Catppuccin CSS tokens
 * skins background / axes / legend / palette to match the surrounding note.
 * The config is the default layer — a spec's own explicit encodings win.
 * `invalidateVegaTheme` clears the cache and rendered state so a theme switch
 * re-skins existing charts.
 */

import { getEffectiveTheme, getThemeMode } from '../theme';
import { api } from '../ipc/client';
import {
  detectDataSource,
  resolveVegaData,
  tableQuerySql,
  rowsFromTable,
  type DataSourceRef,
  type VegaRows,
} from '../../../shared/vega/data-binding';
import { findCellOutput } from '../../../shared/compute/cell-output';

type VegaView = { finalize: () => void };
type VegaEmbed = (
  el: HTMLElement,
  spec: unknown,
  opts?: Record<string, unknown>,
) => Promise<{ view: VegaView }>;

let embedPromise: Promise<VegaEmbed> | null = null;

/** Cached theme config, keyed by the mode it was built for (mirrors mermaid's
 *  `initializedFor`) so steady-state re-renders don't recompute. */
let configCache: { mode: 'dark' | 'light' | 'contrast'; config: Record<string, unknown> } | null = null;

/** Live Vega views, so we can `finalize()` (free listeners / timers) before a
 *  block is re-rendered on a theme switch. */
const liveViews = new WeakMap<HTMLElement, VegaView>();

async function loadEmbed(): Promise<VegaEmbed> {
  if (embedPromise) return embedPromise;
  embedPromise = import('vega-embed').then((m) => (m.default ?? m) as unknown as VegaEmbed);
  return embedPromise;
}

// Catppuccin series palette, shared with the Chart.js query-block adapter so
// the two charting paths look consistent. Reads well on dark / light / contrast.
const CATEGORY_PALETTE = [
  '#89b4fa', // blue (accent)
  '#a6e3a1', // green
  '#fab387', // peach
  '#cba6f7', // mauve
  '#f38ba8', // red
  '#94e2d5', // teal
  '#f9e2af', // yellow
  '#74c7ec', // sapphire
];

function readThemeTokens(): {
  bg: string; text: string; textMuted: string; border: string; accent: string;
} {
  const cs = getComputedStyle(document.documentElement);
  const get = (name: string) => cs.getPropertyValue(name).trim() || '';
  return {
    bg: get('--bg'),
    text: get('--text'),
    textMuted: get('--text-muted'),
    border: get('--border'),
    accent: get('--accent'),
  };
}

/**
 * Build a Vega `config` from the active theme tokens (#828). This is the
 * default layer: a spec that sets its own colors keeps them, because Vega
 * merges per-spec encodings over `config`. Cached per theme mode.
 */
function buildThemeConfig(): Record<string, unknown> {
  const mode = getEffectiveTheme(getThemeMode());
  if (configCache && configCache.mode === mode) return configCache.config;
  const t = readThemeTokens();
  const config: Record<string, unknown> = {
    background: t.bg || 'transparent',
    title: { color: t.text, subtitleColor: t.textMuted },
    arc: { fill: t.accent },
    area: { fill: t.accent },
    line: { stroke: t.accent },
    path: { stroke: t.accent },
    rect: { fill: t.accent },
    shape: { stroke: t.accent },
    symbol: { fill: t.accent },
    bar: { fill: t.accent },
    point: { fill: t.accent, filled: true },
    axis: {
      labelColor: t.textMuted,
      titleColor: t.text,
      gridColor: t.border,
      domainColor: t.border,
      tickColor: t.border,
    },
    legend: { labelColor: t.textMuted, titleColor: t.text },
    view: { stroke: t.border },
    range: { category: CATEGORY_PALETTE },
  };
  configCache = { mode, config };
  return config;
}

/**
 * Recursively collect every `url` string in the spec. Any present `url` is a
 * remote/file fetch we refuse by default (#829) — inline `data.values` carry
 * no `url`. (#832 will introduce a safe local-vault data form resolved before
 * this layer; until then a `url` means "blocked".)
 */
function findUrlRefs(node: unknown, acc: string[], depth = 0): void {
  if (depth > 64 || node === null || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const item of node) findUrlRefs(item, acc, depth + 1);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    if (key === 'url' && typeof value === 'string') acc.push(value);
    else findUrlRefs(value, acc, depth + 1);
  }
}

/**
 * Resolve a Minerva data source to rows in the renderer (#832), running against
 * the open project. SPARQL (#882) hits the graph; SQL / table (#883) hit DuckDB;
 * cell (#884) reads a compute cell's stored output block out of the note's
 * source (`noteContent`).
 */
async function rendererExecutor(ref: DataSourceRef, noteContent: string): Promise<VegaRows> {
  if (ref.kind === 'sparql') {
    const res = await api.graph.query(ref.query);
    if (res.error) throw new Error(res.error);
    return (res.results as VegaRows) ?? [];
  }
  if (ref.kind === 'sql' || ref.kind === 'table') {
    const sql = ref.kind === 'table' ? tableQuerySql(ref.name) : ref.query;
    const res = await api.tables.query(sql);
    if (!res.ok) throw new Error(res.error);
    return res.rows;
  }
  // ref.kind === 'cell'
  const output = findCellOutput(noteContent, ref.id);
  if (!output) throw new Error(`No output found for cell "${ref.id}" — run the cell first.`);
  if (output.type === 'error') throw new Error(output.message);
  if (output.type !== 'table') throw new Error(`Cell "${ref.id}" output isn't tabular.`);
  return rowsFromTable(output.columns, output.rows);
}

/**
 * A Vega `Loader` that refuses every fetch. Inline `data.values` never touch
 * the loader, so only remote / file references hit these rejections. Passes
 * vega-embed's `isLoader` check (it tests for a `load` method), so it's used
 * verbatim rather than wrapped around the default network loader.
 */
function makeBlockingLoader(): Record<string, unknown> {
  const blocked = (uri: unknown) =>
    Promise.reject(new Error(`Remote data is disabled (blocked: ${String(uri)})`));
  return {
    load: blocked,
    sanitize: (uri: unknown) =>
      Promise.reject(new Error(`Remote data is disabled (blocked: ${String(uri)})`)),
    http: blocked,
    file: (filename: unknown) =>
      Promise.reject(new Error(`Local file data is disabled (blocked: ${String(filename)})`)),
  };
}

/**
 * Walk `root` for unrendered `.vega-block` placeholders and render each one.
 * Idempotent: blocks already marked `data-vega-rendered` are skipped, so the
 * post-render `$effect` firing repeatedly doesn't double-render.
 *
 * `noteContent` is the note's markdown source — needed to resolve `data.cell`
 * bindings (#884), which read a compute cell's output block out of the source.
 */
export async function hydrateVegaBlocks(root: HTMLElement, noteContent = ''): Promise<void> {
  const blocks = Array.from(
    root.querySelectorAll<HTMLElement>('.vega-block:not([data-vega-rendered])'),
  );
  if (blocks.length === 0) return;

  let embed: VegaEmbed;
  try {
    embed = await loadEmbed();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    for (const el of blocks) {
      el.setAttribute('data-vega-rendered', 'error');
      el.innerHTML = renderErrorHtml(`Failed to load vega-embed: ${msg}`);
    }
    return;
  }

  const config = buildThemeConfig();

  await Promise.all(blocks.map(async (el) => {
    // Raw spec lives in textContent on first hydration, or stashed on
    // dataset.vegaSpec on re-hydration after a theme change. Capture it before
    // mutating innerHTML (pending / error rendering would wipe textContent).
    const raw = (el.dataset.vegaSpec ?? el.textContent ?? '').trim();
    el.dataset.vegaSpec = raw;
    const mode = el.dataset.vegaMode === 'full' ? 'vega' : 'vega-lite';
    el.removeAttribute('data-vega-pending');
    el.setAttribute('data-vega-rendered', 'pending');

    // Free a prior view (theme re-render) before discarding its DOM.
    const prior = liveViews.get(el);
    if (prior) {
      try { prior.finalize(); } catch { /* ignore */ }
      liveViews.delete(el);
    }
    el.innerHTML = '';

    let spec: unknown;
    try {
      spec = JSON.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      el.innerHTML = renderErrorHtml(`Invalid JSON: ${msg}`);
      el.setAttribute('data-vega-rendered', 'error');
      return;
    }

    // #832 — a Minerva data form (`data.sparql` / `data.sql` / `data.table` /
    // `data.cell`) is resolved to inline `data.values` before embedding, so the
    // #829 guardrail below still only ever sees inline data.
    const ref = detectDataSource(spec);
    if (ref) {
      try {
        spec = await resolveVegaData(spec as Record<string, unknown>, ref, (r) => rendererExecutor(r, noteContent));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        el.innerHTML = renderNoticeHtml('Chart data unavailable', escapeHtml(msg));
        el.setAttribute('data-vega-rendered', 'error');
        return;
      }
    }

    // #829 — refuse specs that reach out to the network / filesystem, with a
    // clear notice rather than a silent empty chart.
    const urls: string[] = [];
    findUrlRefs(spec, urls);
    if (urls.length > 0) {
      el.innerHTML = renderNoticeHtml(
        'Remote data disabled',
        `This chart references external data (${escapeHtml(urls[0]!)}). For security, `
          + 'Minerva renders charts from inline data only. Embed the data with '
          + '`"data": { "values": [ … ] }`.',
      );
      el.setAttribute('data-vega-rendered', 'blocked');
      return;
    }

    // Strip the usermeta.embedOptions injection vector — vega-embed merges it
    // over our options, which could re-enable codegen or swap the loader.
    if (spec && typeof spec === 'object' && 'usermeta' in spec) {
      const usermeta = (spec as { usermeta?: unknown }).usermeta;
      if (usermeta && typeof usermeta === 'object' && 'embedOptions' in usermeta) {
        delete (usermeta as Record<string, unknown>).embedOptions;
      }
    }

    try {
      // No DOMPurify pass here (#1331): vega-embed builds the chart with safe
      // DOM construction (createElementNS/setAttribute via its SVG renderer),
      // never innerHTML of a generated string, and `ast: true` below keeps
      // expressions off `new Function`. The only innerHTML in this file is the
      // app-controlled, already-escaped error/notice HTML. See
      // sanitize-diagram-svg.ts for the mermaid counterpart that does need it.
      const { view } = await embed(el, spec, {
        mode,
        renderer: 'svg',
        // `ast: true` makes vega-embed parse expressions to an AST and run them
        // through the CSP-safe interpreter instead of `new Function` (#829).
        ast: true,
        config,
        loader: makeBlockingLoader(),
        // Built-in "⋯" menu: export PNG/SVG + view source/compiled. The Vega
        // online editor action is disabled — it would POST the spec offsite.
        actions: { export: true, source: true, compiled: true, editor: false },
        tooltip: true,
      });
      liveViews.set(el, view);
      el.setAttribute('data-vega-rendered', 'ok');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      el.innerHTML = renderErrorHtml(msg);
      el.setAttribute('data-vega-rendered', 'error');
    }
  }));
}

/**
 * Reset cached theme config and drop rendered state so the next hydration
 * re-skins every chart with the current tokens. Called from the preview's
 * `updateTheme` alongside `invalidateMermaidTheme`.
 */
export function invalidateVegaTheme(): void {
  configCache = null;
  document.querySelectorAll('.vega-block[data-vega-rendered]').forEach((el) => {
    if (!(el instanceof HTMLElement)) return;
    const view = liveViews.get(el);
    if (view) {
      try { view.finalize(); } catch { /* ignore */ }
      liveViews.delete(el);
    }
    el.removeAttribute('data-vega-rendered');
    el.innerHTML = '';
  });
}

function renderErrorHtml(msg: string): string {
  return `<div class="vega-error" role="alert"><strong>Vega error</strong><pre>${escapeHtml(msg)}</pre></div>`;
}

function renderNoticeHtml(title: string, body: string): string {
  // `body` already contains escaped interpolations; the literal copy is safe.
  return `<div class="vega-notice" role="note"><strong>${escapeHtml(title)}</strong><p>${body}</p></div>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Exported for unit tests — the spec-scan and JSON guardrail are the security
// surface and deserve direct coverage without a DOM/vega-embed round-trip.
export const __test = { findUrlRefs };
