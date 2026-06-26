/**
 * Headless Vega-Lite / Vega → SVG rendering for the export pipeline (#831).
 *
 * In the app, charts render in the renderer via vega-embed (#827). On export a
 * chart left as raw JSON is dead weight in an HTML or PDF, so each
 * ```vega-lite / ```vega block is rendered to a static SVG here — in the main
 * process, no browser window — and spliced back into the markdown as an
 * `<img>` (an SVG data URI). markdown-it then emits the image like any other,
 * so this works even with the exporter's `html: false`.
 *
 * Design notes:
 *   - vega / vega-lite are dynamically `import()`ed and externalized from the
 *     main bundle (see vite.main.config + forge.config's EXTERNAL_DEP_ROOTS).
 *     They're large ESM trees that use top-level await, so bundling them
 *     code-splits the single-file main bundle (breaking packaging) and a CJS
 *     `require()` of them throws `ERR_REQUIRE_ASYNC_MODULE`. A native dynamic
 *     `import()` of the externalized package sidesteps both — and only loads
 *     them when an export actually contains a chart.
 *   - The #829 security posture holds at export too: a spec that references
 *     remote data (`url`) is refused and the loader rejects every fetch. A
 *     chart that can't render (bad JSON, blocked data, compile error) degrades
 *     to its spec text + an italic note — export never hard-fails on one chart.
 *   - A neutral light theme `config` is applied so charts read on the white
 *     background of a printed / publish artifact (vs. the in-app dark theme).
 *
 * Markdown export deliberately does NOT call this — it keeps the spec fence
 * verbatim, which stays portable to other Vega-aware tools.
 */

// Catppuccin-derived categorical palette, shared in spirit with the renderer
// (#828) and the Chart.js adapter so all three charting paths feel consistent.
const CATEGORY_PALETTE = [
  '#3b6fd4', '#3f9648', '#c8761f', '#8a4fd0',
  '#c43d5e', '#2a9d8f', '#b58a00', '#3a86c8',
];

/** A neutral light config for print/publish artifacts. Default layer only —
 *  a spec's own encodings win, exactly as in the in-app renderer. */
const EXPORT_CONFIG = {
  background: 'transparent',
  axis: {
    labelColor: '#444',
    titleColor: '#222',
    gridColor: '#e2e2e2',
    domainColor: '#999',
    tickColor: '#999',
  },
  legend: { labelColor: '#444', titleColor: '#222' },
  title: { color: '#222' },
  view: { stroke: '#ddd' },
  range: { category: CATEGORY_PALETTE },
};

type VegaModule = typeof import('vega');
type VegaLiteModule = typeof import('vega-lite');

let libsPromise: Promise<{ vega: VegaModule; vegaLite: VegaLiteModule }> | null = null;

/** Lazily load the externalized vega libs via native dynamic import (handles
 *  their top-level await; a CJS require would throw ERR_REQUIRE_ASYNC_MODULE).
 *  Cached so a multi-chart / multi-note export pays the load once. */
function loadLibs(): Promise<{ vega: VegaModule; vegaLite: VegaLiteModule }> {
  if (!libsPromise) {
    libsPromise = Promise.all([import('vega'), import('vega-lite')]).then(
      ([vega, vegaLite]) => ({ vega, vegaLite }),
    );
  }
  return libsPromise;
}

/**
 * A Vega `Loader` that refuses every fetch — inline `data.values` never touch
 * it, so only remote/file references hit these rejections. Same posture as the
 * renderer guardrail (#829), enforced at export too.
 */
function blockingLoader(): Record<string, unknown> {
  const blocked = (uri: unknown) =>
    Promise.reject(new Error(`Remote data is disabled (blocked: ${String(uri)})`));
  return { load: blocked, sanitize: blocked, http: blocked, file: blocked };
}

/** Recursively collect every `url` string — any present `url` is a remote/file
 *  fetch we refuse by default (#829); inline data carries none. */
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

// Matches a fenced ```vega-lite or ```vega block at line start. `vega-lite`
// is tried first so it isn't shadowed by the shorter `vega`. Mirrors the
// turtle-strip regex shape in note-markdown-shared.ts.
const VEGA_FENCE_RE = /^```(vega-lite|vega)[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm;

/** Does this markdown contain any vega fence? Cheap gate before the heavy import. */
export function hasVegaBlocks(markdown: string): boolean {
  VEGA_FENCE_RE.lastIndex = 0;
  return VEGA_FENCE_RE.test(markdown);
}

/**
 * Replace every ```vega-lite / ```vega fence in `markdown` with a rendered SVG
 * image (`![chart](data:image/svg+xml;base64,…)`). A chart that can't render
 * degrades to its original spec fence plus an italic note. Returns the markdown
 * unchanged when it contains no charts (no library load).
 */
export async function renderVegaBlocks(markdown: string): Promise<string> {
  if (!hasVegaBlocks(markdown)) return markdown;

  VEGA_FENCE_RE.lastIndex = 0;
  const matches = [...markdown.matchAll(VEGA_FENCE_RE)];
  if (matches.length === 0) return markdown;

  let out = '';
  let last = 0;
  for (const m of matches) {
    out += markdown.slice(last, m.index);
    out += await renderOne(m[1] === 'vega' ? 'vega' : 'vega-lite', m[2]);
    last = m.index + m[0].length;
  }
  out += markdown.slice(last);
  return out;
}

async function renderOne(mode: 'vega' | 'vega-lite', specText: string): Promise<string> {
  let spec: unknown;
  try {
    spec = JSON.parse(specText);
  } catch (err) {
    return degrade(mode, specText, `invalid JSON: ${msgOf(err)}`);
  }

  const urls: string[] = [];
  findUrlRefs(spec, urls);
  if (urls.length > 0) {
    return degrade(mode, specText, `remote data is disabled (${urls[0]})`);
  }

  try {
    const { vega, vegaLite } = await loadLibs();
    const vgSpec = mode === 'vega-lite'
      ? vegaLite.compile(spec as Parameters<VegaLiteModule['compile']>[0], { config: EXPORT_CONFIG }).spec
      : (spec as Parameters<VegaModule['parse']>[0]);
    const runtime = mode === 'vega-lite'
      ? vega.parse(vgSpec)
      : vega.parse(vgSpec, EXPORT_CONFIG);
    const view = new vega.View(runtime, { renderer: 'none', loader: blockingLoader() as never });
    const svg = await view.toSVG();
    view.finalize();
    const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
    return `![chart](${dataUri})`;
  } catch (err) {
    return degrade(mode, specText, msgOf(err));
  }
}

/** Graceful fallback: keep the spec (so nothing is lost) and prepend a note.
 *  The fence survives as a plain code block in the export — never a hard fail. */
function degrade(mode: 'vega' | 'vega-lite', specText: string, reason: string): string {
  return `*Chart could not be rendered: ${reason}.*\n\n\`\`\`${mode}\n${specText}\n\`\`\``;
}

function msgOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
