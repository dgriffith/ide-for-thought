/**
 * Every live thing the preview renders has an export answer (#2515, epic #2508).
 *
 * #2508 happened because nothing connected the preview's live-rendering list to
 * the export pipeline: views, query blocks, mermaid, argument maps and saved
 * cell outputs all exported as raw source for as long as they'd existed, and
 * hidden fences were published verbatim. This reads the preview's own
 * inventories out of its source — the fence-renderer table, the hidden-fence
 * rule, the `:::` directive rules, the query-block types, its markdown plugins
 * and its post-render hydration passes — and requires each to be classified
 * here as one of:
 *
 *   - a HANDLER, whose `holds()` proves the export side really handles it;
 *   - a GAP, with the open issue that owns it;
 *   - a DECISION, saying why the export deliberately differs.
 *
 * It fails closed: a new query type, plugin or hydration pass in the preview
 * fails here until it gets an export answer. A classification whose preview
 * kind no longer exists fails too.
 *
 * Live-block KINDS — fences, `:::` directives, lone-link cards — are no longer
 * classified by hand (#2624): `shared/live-blocks.ts`'s `LIVE_BLOCKS` is the one
 * list, and each side keeps its half in a map typed by kind, so a kind without
 * both halves doesn't compile. The checks below make sure those maps stay
 * typed by kind and that every registered kind's export half really works.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LIVE_DIRECTIVES, LIVE_FENCES, MAIN_TRANSFORMS, extractLiveBlocks } from '../../src/main/publish/live-blocks';
import { LIVE_BLOCKS } from '../../src/shared/live-blocks';
import { hasVegaBlocks } from '../../src/main/publish/vega-render';
import { renderYouTubeBlocks } from '../../src/main/publish/youtube-render';

const ROOT = path.resolve(__dirname, '..', '..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf-8');

const FENCE_PLUGIN = read('src/renderer/lib/markdown/fence-plugin.ts');
const MARKDOWN_CONFIG = read('src/renderer/lib/preview/markdown-config.ts');
const QUERY_BLOCKS = read('src/renderer/lib/preview/query-blocks.ts');
const PREVIEW = read('src/renderer/lib/components/Preview.svelte');
const EXPORT_RENDER = read('src/main/publish/exporters/note-html/render.ts');
const EXPORT_DISPATCH = read('src/renderer/lib/app/export-live-blocks.ts');
const QUERY_EXPORT = read('src/renderer/lib/export/render-query-block.ts');
const MAIN_LIVE_BLOCKS = read('src/main/publish/live-blocks.ts');
const LIVE_DIRECTIVES_PREVIEW = read('src/renderer/lib/preview/live-directives.ts');
const CARD_PREVIEWS = read('src/renderer/lib/preview/card-previews.ts');

// ── The preview's inventories, read from its source ─────────────────────────

function previewKinds(): string[] {
  const kinds = new Set<string>();
  if (/parseFenceInfo\(tok\.info\)\.hidden/.test(FENCE_PLUGIN)) kinds.add('fence:<lang>-hidden');
  for (const m of QUERY_BLOCKS.matchAll(/type === '(\w+)'/g)) kinds.add(`query:${m[1]}`);
  for (const m of MARKDOWN_CONFIG.matchAll(/\binstall([A-Z]\w+)\(md\b/g)) kinds.add(`plugin:install${m[1]}`);
  for (const m of PREVIEW.matchAll(/\bhydrate([A-Z]\w+)\(/g)) kinds.add(`hydrate:hydrate${m[1]}`);
  return [...kinds].sort();
}

// ── How each is answered on the export side ─────────────────────────────────

type Answer =
  | { handler: string; holds: () => boolean }
  | { gap: number; reason: string }
  | { decision: string };

const liveFence = (lang: string) => (): boolean => LIVE_FENCES[lang] !== undefined;
const liveDirective = (sample: string) => (): boolean => LIVE_DIRECTIVES.some(([re]) => re.test(sample));
const exportInstalls = (name: string) => (): boolean => new RegExp(`\\b${name}\\(md\\b`).test(EXPORT_RENDER);
/** A plugin's block (#2641), as an export extracts it for the window: a fence or directive some plugin draws. */
const PROBE_BLOCKS = [
  { pluginId: 'probe', blockId: 'fenced', title: 'Probe', fence: 'probe-fence' },
  { pluginId: 'probe', blockId: 'directed', title: 'Probe', directive: 'probe-directive' },
];
const pluginBlockExtracted = (markdown: string, blockId: string) => (): boolean =>
  extractLiveBlocks(markdown, 'n.md', { pluginBlocks: PROBE_BLOCKS }).blocks.some((b) => b.kind === 'plugin' && b.plugin?.blockId === blockId);
const queryExecutor = (): boolean => QUERY_EXPORT.includes('executeQueryBlock(') && liveDirective(':::query-list')();

const PARITY: Record<string, Answer> = {
  // Fences
  'fence:<lang>-hidden': { handler: 'stripped from every reader-facing export (#2509)', holds: () => /parseFenceInfo\(tokens\[idx\]!\.info\)\.hidden/.test(EXPORT_RENDER) },
  // Query-block types — all run through the one executor the export reuses.
  'query:list': { handler: 'executeQueryBlock (#2512)', holds: queryExecutor },
  'query:table': { handler: 'executeQueryBlock (#2512)', holds: queryExecutor },
  'query:timeseries': { handler: 'executeQueryBlock; chart as an image (#2512)', holds: queryExecutor },
  'query:backlinks': { handler: 'executeQueryBlock (#2512)', holds: queryExecutor },
  'query:search': { handler: 'executeQueryBlock (#2512)', holds: queryExecutor },
  'query:semantic': { handler: 'executeQueryBlock (#2512)', holds: queryExecutor },
  // Markdown plugins
  'plugin:installMath': { handler: 'same shared plugin', holds: exportInstalls('installMath') },
  'plugin:installCallouts': { handler: 'same shared plugin + export callout CSS (#2515)', holds: exportInstalls('installCallouts') },
  'plugin:installDoiAutolink': { handler: 'same shared plugin (#2515)', holds: exportInstalls('installDoiAutolink') },
  'plugin:installHighlight': { handler: 'same shared plugin (#2515)', holds: exportInstalls('installHighlight') },
  'plugin:installAnchors': { handler: 'same shared plugin; [[note#Heading]] hrefs use its slugs (#2515)', holds: exportInstalls('installAnchors') },
  'plugin:installWikiLinks': { handler: 'the export wiki-link rule, resolved like the app (#2518)', holds: () => /installWikiLinkRule\(md\b/.test(EXPORT_RENDER) },
  'plugin:installTransclusions': { handler: 'resolveTransclusions (#906)', holds: () => EXPORT_RENDER.includes('resolveTransclusions(') },
  'plugin:installImageSize': { handler: 'same shared plugin: `|400` sizes become <img width/height> (#2666)', holds: exportInstalls('installImageSize') },
  'plugin:installNoteTags': { handler: 'the shared tag rule: a chip, or a link to the static site\'s tag page (#2526)', holds: exportInstalls('installNoteTags') },
  'plugin:installFences': { decision: 'the fence table — its live-block fences come from the registry (#2624), checked below' },
  'plugin:installLiveDirectives': { decision: 'the registry\'s `:::` directive kinds (#2624), checked below' },
  'plugin:installPluginDirectives': { handler: "a plugin's `:::` block, drawn static by its own frame (#2641)", holds: pluginBlockExtracted(':::probe-directive\nbody\n:::\n', 'directed') },
  // Post-render hydration passes
  'hydrate:hydrateMermaidBlocks': { handler: 'live block (#2513)', holds: liveFence('mermaid') },
  'hydrate:hydrateVegaBlocks': { handler: 'main-process SVG render (#831)', holds: () => hasVegaBlocks('```vega-lite\n{}\n```') },
  'hydrate:hydrateObjectViewBlocks': { handler: 'live block (#2510, #2511)', holds: liveFence('object-view') },
  'hydrate:hydrateArgumentMapBlocks': { handler: 'live block (#2514)', holds: liveDirective(':::argument') },
  'hydrate:hydratePluginBlocks': { handler: "live block, drawn static by its plugin's frame (#2641)", holds: pluginBlockExtracted('```probe-fence\nbody\n```\n', 'fenced') },
  'hydrate:hydrateTransclusions': { handler: 'resolveTransclusions (#906)', holds: () => EXPORT_RENDER.includes('resolveTransclusions(') },
  'hydrate:hydrateLocalImages': { handler: 'the asset policy (inline-base64 / copy / keep-relative)', holds: () => EXPORT_RENDER.includes('export async function inlineImages') },
  'hydrate:hydrateYouTubeThumbnails': { handler: 'linked thumbnail (#904)', holds: () => !renderYouTubeBlocks('```youtube\nhttps://youtu.be/dQw4w9WgXcQ\n```\n').includes('```youtube') },
  'hydrate:hydrateRemoteImages': { decision: 'a remote image keeps its URL; the exported page loads it as the preview does' },
  'hydrate:hydrateLocalMedia': { decision: 'local audio/video become links (#908) — a single-file export doesn\'t inline media' },
  'hydrate:hydrateCardCallouts': { decision: 'a flashcard exports with its answer shown — a page (or PDF) can\'t reveal one' },
};

describe('export parity with the preview\'s live rendering (#2515)', () => {
  const kinds = previewKinds();

  it('reads a real inventory from the preview (the parsing still works)', () => {
    expect(kinds).toEqual(expect.arrayContaining(['fence:<lang>-hidden', 'query:list', 'plugin:installCallouts', 'hydrate:hydrateMermaidBlocks']));
    expect(kinds.length).toBeGreaterThan(20);
  });

  // ── Live-block kinds: the registry (#2624) ──
  it('every half of the live-block registry is a map typed by kind — a kind without one does not compile', () => {
    const halves: Array<[string, string, RegExp]> = [
      ['preview: fence renderers', FENCE_PLUGIN, /Record<FenceBlockKind,/],
      ['preview: directive rules', LIVE_DIRECTIVES_PREVIEW, /Record<DirectiveBlockKind,/],
      ['preview: card pass', CARD_PREVIEWS, /Record<CardBlockKind,/],
      ['export: the window\'s renderers', EXPORT_DISPATCH, /Record<WindowBlockKind,/],
      ['export: main transforms', MAIN_LIVE_BLOCKS, /Record<MainBlockKind,/],
    ];
    expect(halves.filter(([, src, re]) => !re.test(src)).map(([name]) => name)).toEqual([]);
    // And they're what the preview and export actually use.
    expect(MARKDOWN_CONFIG).toMatch(/installLiveDirectives\(md\)/);
    expect(PREVIEW).toMatch(/CARD_PREVIEWS/);
    expect(EXPORT_RENDER).toMatch(/applyMainTransforms\(/);
  });

  it('every registered window kind is extracted for the window by its own syntax', () => {
    const missing: string[] = [];
    for (const d of LIVE_BLOCKS) {
      if (d.export !== 'window') continue;
      const s = d.syntax;
      const ok = 'fence' in s ? s.fence.every((lang) => LIVE_FENCES[lang] === d.kind)
        : 'directive' in s ? LIVE_DIRECTIVES.some(([, k]) => k === d.kind)
          : 'plugin' in s ? pluginBlockExtracted('```probe-fence\nx\n```\n', 'fenced')() && pluginBlockExtracted(':::probe-directive\nx\n:::\n', 'directed')()
            : extractLiveBlocks('A\n\n[[Some Note]]\n', 'n.md').blocks.some((b) => b.kind === d.kind);
      if (!ok) missing.push(d.kind);
    }
    expect(missing).toEqual([]);
  });

  it('every registered main kind\'s transform answers its fences', async () => {
    const PROBES: Record<string, () => Promise<boolean> | boolean> = {
      // Drawing a chart needs vega itself; that the fence is recognised is the check (#831).
      vega: () => hasVegaBlocks('```vega\n{}\n```') && hasVegaBlocks('```vega-lite\n{}\n```'),
      youtube: async () => !(await MAIN_TRANSFORMS.youtube('```youtube\nhttps://youtu.be/dQw4w9WgXcQ\n```\n', {})).includes('```youtube'),
    };
    const failing: string[] = [];
    for (const d of LIVE_BLOCKS) {
      if (d.export !== 'main') continue;
      const probe = PROBES[d.kind];
      if (!probe || !(await probe())) failing.push(d.kind);
    }
    expect(failing, 'give a new main kind a probe here that proves its transform works').toEqual([]);
  });

  it('classifies everything the preview renders live — a new kind needs an export answer', () => {
    const unclassified = kinds.filter((k) => !(k in PARITY));
    expect(unclassified, 'give each a handler, a gap (with its issue) or a decision in PARITY').toEqual([]);
  });

  it('every handler really exists on the export side', () => {
    const broken = Object.entries(PARITY)
      .filter(([, a]) => 'handler' in a && !a.holds())
      .map(([k, a]) => `${k} → ${(a as { handler: string }).handler}`);
    expect(broken).toEqual([]);
  });

  it('has no stale entries — every classification names something the preview still renders', () => {
    expect(Object.keys(PARITY).filter((k) => !kinds.includes(k))).toEqual([]);
  });

  it('every gap names its issue', () => {
    for (const [k, a] of Object.entries(PARITY)) {
      if ('gap' in a) expect(a.gap, k).toBeGreaterThan(0);
    }
  });
});
