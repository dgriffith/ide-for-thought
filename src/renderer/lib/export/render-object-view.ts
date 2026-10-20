/**
 * Render a ```object-view block for an export (#2510) with the SAME component
 * the preview mounts — `TypeView`, chromeless — then snapshot it as static
 * HTML. Fidelity by construction: there is no second implementation of a
 * list, table or gallery to drift from the preview.
 *
 * The off-screen host reproduces the preview's container (`.object-view-block`
 * with `data-object-view-rendered="ok"`, so the embed's own border and
 * background rules apply) inside a `data-theme="light"` element: exports read
 * on white, as charts already do (`vega-render.ts`). A map whose view chose
 * `light` or `dark` (#2665) is captured in that style; `auto` exports light.
 *
 * One deliberate difference from the preview: the preview frames an embed in
 * a fixed 360px box that scrolls; an export shows every row, because a page —
 * and a PDF above all — can't scroll a box.
 *
 * A Kanban board (#2604) is drawn in its export mode: its columns wrap onto
 * further rows within the block's width instead of scrolling sideways.
 *
 * A Timeline (#2609) is drawn in its export mode: SVG of the spec's range at
 * the block's width, each event a link, at most 30 lanes ("+N more"), then a
 * dated list and the Undated tray — or the list alone when it can't be drawn.
 *
 * A Calendar (#2704) is drawn in its export mode: the spec's month (or the
 * current one) as a static grid, every event listed and linked in its day's
 * cell, then its month and year bands and the Undated tray.
 *
 * A spec `width` (#2709) is honoured: the block is drawn at that width and
 * framed (`frameForWidth`) so a page shows it the way the preview does —
 * narrower than the column, or breaking out of it to the right, up to the
 * window less a gutter, scrolling sideways past that rather than the page. A
 * paged export (PDF) can't break out: the block is drawn at most
 * `EXPORT_BLOCK_WIDTH_PX` wide, where a timeline scales down and a board
 * wraps its columns, as they already do at the default width.
 *
 * A layout a plugin draws (#2828) is snapshotted like any other — but only
 * once the plugin has answered with its export HTML and `PluginLayout` has
 * drawn it, sanitized, in the frame's place (`pluginExport.onRendered`). A
 * plugin that doesn't answer in time fails the block, as a slow view does.
 *
 * A map (#2511) is the exception to snapshotting the DOM: it's the preview's
 * own `TypeViewMap` in export mode, in the embed's frame (its spec `height`,
 * 360px by default — #2666), flattened to
 * one PNG with its pins — or, when it can't be drawn, a table of its places.
 */
import { mount, tick, unmount } from 'svelte';
import TypeView from '../components/TypeView.svelte';
import { LAYOUT_RENDERERS } from '../components/type-view/layout-renderers';
import { parseObjectViewSpec } from '../markdown/object-view-renderer';
import { snapshotLiveBlock } from './live-block-snapshot';
import { LIVE_BLOCK_CLASS, LIVE_FRAME_CLASS, NOTE_LINK_ATTR } from '../../../shared/live-blocks';
import { MAP_EXPORT_TIMEOUT_MS, mapCaptureHtml, type MapCapture } from '../map/map-export';

/** Wide enough for a table's columns; a gallery reflows to it. */
export const EXPORT_BLOCK_WIDTH_PX = 760;
/** A view that hasn't loaded by now is reported, not waited on forever. */
export const OBJECT_VIEW_LOAD_TIMEOUT_MS = 20_000;

/** Throws (with a reader-facing message) when the spec is bad or the view
 *  doesn't load in time; the caller turns that into the block's error. */
export async function renderObjectViewForExport(source: string, opts: { paged?: boolean } = {}): Promise<string> {
  const spec = parseObjectViewSpec(source);
  const width = spec.width === null ? null : opts.paged ? Math.min(spec.width, EXPORT_BLOCK_WIDTH_PX) : spec.width;
  const html = await renderAtWidth(spec, width ?? EXPORT_BLOCK_WIDTH_PX);
  return width === null ? html : frameForWidth(html, width, { paged: opts.paged === true });
}

/** Gutter kept between a breaking-out block and the window's edge. */
const EXPORT_GUTTER_PX = 32;

/**
 * Size a rendered block to its spec width. Left-aligned with the text, like
 * the preview; when wider than the column it reaches right, to at most the
 * window's width less a gutter — `(100cqw + 100%) / 2` is the column's right
 * edge plus the room beside it in a page whose article is centred, and `cqw`
 * is the viewport's unless the page names a container (the static site's
 * `.page-frame`, beside its structure sidebar). Self-contained, so every HTML
 * export lays it out alike; a paged one only ever narrows it.
 */
export function frameForWidth(html: string, width: number, opts: { paged: boolean }): string {
  // Never less than the column itself: on a page with no room beside the
  // article, a wide block is as wide as the text and scrolls.
  const room = opts.paged ? '100%' : `max(100%, calc((100cqw + 100%) / 2 - ${EXPORT_GUTTER_PX}px))`;
  const css = `.${LIVE_FRAME_CLASS}{max-width:none;overflow-x:auto}`
    + `.${LIVE_FRAME_CLASS}>.${LIVE_BLOCK_CLASS}{margin:0}`;
  // Wider than the default block: the static site makes room for it (its
  // per-note sidebar moves below the article — static-site/style.ts).
  const breakout = !opts.paged && width > EXPORT_BLOCK_WIDTH_PX ? ' data-breakout="1"' : '';
  return `<div class="${LIVE_FRAME_CLASS}"${breakout} style="width:min(${width}px, ${room});margin:1em 0">`
    + `<style>${css}</style>${html}</div>`;
}

async function renderAtWidth(spec: ReturnType<typeof parseObjectViewSpec>, widthPx: number): Promise<string> {
  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${widthPx}px;pointer-events:none;`;
  const themed = document.createElement('div');
  themed.setAttribute('data-theme', 'light');
  const block = document.createElement('div');
  block.className = 'object-view-block';
  block.setAttribute('data-object-view-rendered', 'ok');
  // Every row — see the file header. A layout that needs a real height to draw
  // into (a map) gets the embed's own (`height` in its spec, #2666 — the 360px
  // default when it has none); the registry says which (#2623).
  block.style.height = LAYOUT_RENDERERS[spec.layout].fixedExportHeight ? `${spec.height}px` : 'auto';
  themed.appendChild(block);
  host.appendChild(themed);
  document.body.appendChild(host);

  let instance: ReturnType<typeof mount> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let mapTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveCapture!: (c: MapCapture) => void;
  const captured = new Promise<MapCapture>((resolve) => { resolveCapture = resolve; });
  let pluginTimer: ReturnType<typeof setTimeout> | undefined;
  // Resolves null once drawn, or with why it couldn't be — never rejects, so
  // it needs no handler when the layout isn't a plugin's and nothing awaits it.
  let pluginSettle!: (failure: string | null) => void;
  const pluginDrawn = new Promise<string | null>((resolve) => { pluginSettle = resolve; });
  try {
    const loaded = new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('the view took too long to load')), OBJECT_VIEW_LOAD_TIMEOUT_MS);
      instance = mount(TypeView, {
        target: block,
        props: {
          typeId: spec.typeId,
          layout: spec.layout,
          sortColumn: spec.sortColumn,
          sortDir: spec.sortDir,
          columns: spec.columns,
          folder: spec.folder,
          filters: spec.filters,
          mapStyle: spec.mapStyle,
          groupBy: spec.groupBy,
          columnOrder: spec.columnOrder,
          showEmptyColumns: spec.showEmptyColumns,
          from: spec.from,
          to: spec.to,
          month: spec.month,
          dateBy: spec.dateBy,
          revision: 0,
          chromeless: true,
          onStateChange: () => {},
          onOpenNote: () => {},
          onLoaded: () => resolve(),
          // Every layout draws for the page: a board wraps its columns (#2604),
          // a timeline is one static SVG of its range then its dated list
          // (#2609), a calendar its month with every event in its day (#2704).
          exportMode: true,
          // Only a mounted map uses this — it hands back its capture.
          mapExport: { onCaptured: (c: MapCapture) => resolveCapture(c) },
          // Only a plugin-drawn layout uses this (#2828).
          pluginExport: { onRendered: () => pluginSettle(null), onFailed: (reason: string) => pluginSettle(reason) },
        },
      });
    });
    await loaded;
    await tick();
    // A map layout that actually mounted a map waits for its capture; one that
    // didn't (no location property, no instances) is ordinary DOM.
    if (block.querySelector('.type-view-map')) {
      const capture = await Promise.race([
        captured,
        new Promise<never>((_, reject) => {
          mapTimer = setTimeout(() => reject(new Error('the map took too long to draw')), MAP_EXPORT_TIMEOUT_MS + 5_000);
        }),
      ]);
      return mapCaptureHtml(capture, LIVE_BLOCK_CLASS, NOTE_LINK_ATTR);
    }
    if (block.querySelector('[data-plugin-layout]')) {
      const failure = await Promise.race([
        pluginDrawn,
        new Promise<never>((_, reject) => {
          pluginTimer = setTimeout(() => reject(new Error('the plugin view took too long to draw')), OBJECT_VIEW_LOAD_TIMEOUT_MS);
        }),
      ]);
      if (failure !== null) throw new Error(`the plugin view couldn't be drawn: ${failure}`);
      await tick();
    }
    return snapshotLiveBlock(themed);
  } finally {
    clearTimeout(timer);
    clearTimeout(mapTimer);
    clearTimeout(pluginTimer);
    if (instance) void unmount(instance);
    host.remove();
  }
}
