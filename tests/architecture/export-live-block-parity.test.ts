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
 * It fails closed: a new fence renderer, directive, query type, plugin or
 * hydration pass in the preview fails here until it gets an export answer. A
 * classification whose preview kind no longer exists fails too.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { LIVE_DIRECTIVES, LIVE_FENCES } from '../../src/main/publish/live-blocks';
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

// ── The preview's inventories, read from its source ─────────────────────────

function previewKinds(): string[] {
  const kinds = new Set<string>();
  // The type annotation holds `=>`, so anchor on the ` = {` that opens the table.
  const table = /const fenceRenderers[^\n]*= \{\n([\s\S]*?)\n\s*\};/.exec(FENCE_PLUGIN)?.[1] ?? '';
  for (const m of table.matchAll(/^\s*'?([\w-]+)'?\s*:/gm)) kinds.add(`fence:${m[1]}`);
  if (/parseFenceInfo\(tok\.info\)\.hidden/.test(FENCE_PLUGIN)) kinds.add('fence:<lang>-hidden');
  for (const m of MARKDOWN_CONFIG.matchAll(/md\.block\.ruler\.before\('fence',\s*'(\w+)'/g)) kinds.add(`directive:${m[1]}`);
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
const queryExecutor = (): boolean => QUERY_EXPORT.includes('executeQueryBlock(') && liveDirective(':::query-list')();

const PARITY: Record<string, Answer> = {
  // Fences
  'fence:object-view': { handler: 'live block, the preview\'s TypeView (#2510, #2511)', holds: liveFence('object-view') },
  'fence:mermaid': { handler: 'live block, the preview\'s mermaid setup (#2513)', holds: liveFence('mermaid') },
  'fence:output': { handler: 'live block, the preview\'s renderComputeOutput (#2515)', holds: liveFence('output') },
  'fence:vega': { handler: 'main-process SVG render (#831)', holds: () => hasVegaBlocks('```vega\n{}\n```') },
  'fence:vega-lite': { handler: 'main-process SVG render (#831)', holds: () => hasVegaBlocks('```vega-lite\n{}\n```') },
  'fence:youtube': { handler: 'linked thumbnail (#904)', holds: () => !renderYouTubeBlocks('```youtube\nhttps://youtu.be/dQw4w9WgXcQ\n```\n').includes('```youtube') },
  'fence:<lang>-hidden': { handler: 'stripped from every reader-facing export (#2509)', holds: () => /parseFenceInfo\(tokens\[idx\]!\.info\)\.hidden/.test(EXPORT_RENDER) },
  // Directives
  'directive:query_directive': { handler: 'live block, the preview\'s executeQueryBlock (#2512)', holds: liveDirective(':::query-list') },
  'directive:argument_directive': { handler: 'live block, the preview\'s ArgumentMap (#2514)', holds: liveDirective(':::argument') },
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
  'plugin:installNoteTags': { gap: 2526, reason: '#tag chips export as plain text; the static site\'s tag pages aren\'t linked' },
  'plugin:installFences': { decision: 'the fence table itself — each fence kind is classified above' },
  // Post-render hydration passes
  'hydrate:hydrateMermaidBlocks': { handler: 'live block (#2513)', holds: liveFence('mermaid') },
  'hydrate:hydrateVegaBlocks': { handler: 'main-process SVG render (#831)', holds: () => hasVegaBlocks('```vega-lite\n{}\n```') },
  'hydrate:hydrateObjectViewBlocks': { handler: 'live block (#2510, #2511)', holds: liveFence('object-view') },
  'hydrate:hydrateArgumentMapBlocks': { handler: 'live block (#2514)', holds: liveDirective(':::argument') },
  'hydrate:hydrateTransclusions': { handler: 'resolveTransclusions (#906)', holds: () => EXPORT_RENDER.includes('resolveTransclusions(') },
  'hydrate:hydrateLocalImages': { handler: 'the asset policy (inline-base64 / copy / keep-relative)', holds: () => EXPORT_RENDER.includes('export async function inlineImages') },
  'hydrate:hydrateYouTubeThumbnails': { handler: 'linked thumbnail (#904)', holds: () => !renderYouTubeBlocks('```youtube\nhttps://youtu.be/dQw4w9WgXcQ\n```\n').includes('```youtube') },
  'hydrate:hydrateRemoteImages': { decision: 'a remote image keeps its URL; the exported page loads it as the preview does' },
  'hydrate:hydrateLocalMedia': { decision: 'local audio/video become links (#908) — a single-file export doesn\'t inline media' },
  'hydrate:hydrateCardCallouts': { decision: 'a flashcard exports with its answer shown — a page (or PDF) can\'t reveal one' },
  'hydrate:hydrateTypedCards': { gap: 2526, reason: 'typed-note and quote link cards export as plain links' },
};

describe('export parity with the preview\'s live rendering (#2515)', () => {
  const kinds = previewKinds();

  it('reads a real inventory from the preview (the parsing still works)', () => {
    expect(kinds).toEqual(expect.arrayContaining(['fence:mermaid', 'directive:query_directive', 'query:list', 'plugin:installCallouts', 'hydrate:hydrateMermaidBlocks']));
    expect(kinds.length).toBeGreaterThan(25);
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

  it('every live-block kind the export extracts has a renderer case in the window', () => {
    const kindsUsed = new Set([...Object.values(LIVE_FENCES), ...LIVE_DIRECTIVES.map(([, k]) => k)]);
    const missing = [...kindsUsed].filter((k) => !EXPORT_DISPATCH.includes(`case '${k}':`));
    expect(missing).toEqual([]);
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
