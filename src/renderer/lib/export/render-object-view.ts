/**
 * Render a ```object-view block for an export (#2510) with the SAME component
 * the preview mounts — `TypeView`, chromeless — then snapshot it as static
 * HTML. Fidelity by construction: there is no second implementation of a
 * list, table or gallery to drift from the preview.
 *
 * The off-screen host reproduces the preview's container (`.object-view-block`
 * with `data-object-view-rendered="ok"`, so the embed's own border and
 * background rules apply) inside a `data-theme="light"` element: exports read
 * on white, as charts already do (`vega-render.ts`).
 *
 * One deliberate difference from the preview: the preview frames an embed in
 * a fixed 360px box that scrolls; an export shows every row, because a page —
 * and a PDF above all — can't scroll a box.
 *
 * A map (#2511) is the exception to snapshotting the DOM: it's the preview's
 * own `TypeViewMap` in export mode, in the preview's 360px frame, flattened to
 * one PNG with its pins — or, when it can't be drawn, a table of its places.
 */
import { mount, tick, unmount } from 'svelte';
import TypeView from '../components/TypeView.svelte';
import { parseObjectViewSpec } from '../markdown/object-view-renderer';
import { snapshotLiveBlock } from './live-block-snapshot';
import { LIVE_BLOCK_CLASS, NOTE_LINK_ATTR } from '../../../shared/live-blocks';
import { MAP_EXPORT_HEIGHT, MAP_EXPORT_TIMEOUT_MS, mapCaptureHtml, type MapCapture } from '../map/map-export';

/** Wide enough for a table's columns; a gallery reflows to it. */
export const EXPORT_BLOCK_WIDTH_PX = 760;
/** A view that hasn't loaded by now is reported, not waited on forever. */
export const OBJECT_VIEW_LOAD_TIMEOUT_MS = 20_000;

/** Throws (with a reader-facing message) when the spec is bad or the view
 *  doesn't load in time; the caller turns that into the block's error. */
export async function renderObjectViewForExport(source: string): Promise<string> {
  const spec = parseObjectViewSpec(source);

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${EXPORT_BLOCK_WIDTH_PX}px;pointer-events:none;`;
  const themed = document.createElement('div');
  themed.setAttribute('data-theme', 'light');
  const block = document.createElement('div');
  block.className = 'object-view-block';
  block.setAttribute('data-object-view-rendered', 'ok');
  // Every row — see the file header. A map needs a real height: the preview's.
  block.style.height = spec.layout === 'map' ? `${MAP_EXPORT_HEIGHT}px` : 'auto';
  themed.appendChild(block);
  host.appendChild(themed);
  document.body.appendChild(host);

  let instance: ReturnType<typeof mount> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let mapTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveCapture!: (c: MapCapture) => void;
  const captured = new Promise<MapCapture>((resolve) => { resolveCapture = resolve; });
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
          revision: 0,
          chromeless: true,
          onStateChange: () => {},
          onOpenNote: () => {},
          onLoaded: () => resolve(),
          ...(spec.layout === 'map' ? { mapExport: { onCaptured: (c: MapCapture) => resolveCapture(c) } } : {}),
        },
      });
    });
    await loaded;
    await tick();
    // A map layout that actually mounted a map waits for its capture; one that
    // didn't (no location property, no instances) is ordinary DOM.
    if (spec.layout === 'map' && block.querySelector('.type-view-map')) {
      const capture = await Promise.race([
        captured,
        new Promise<never>((_, reject) => {
          mapTimer = setTimeout(() => reject(new Error('the map took too long to draw')), MAP_EXPORT_TIMEOUT_MS + 5_000);
        }),
      ]);
      return mapCaptureHtml(capture, LIVE_BLOCK_CLASS, NOTE_LINK_ATTR);
    }
    return snapshotLiveBlock(themed);
  } finally {
    clearTimeout(timer);
    clearTimeout(mapTimer);
    if (instance) void unmount(instance);
    host.remove();
  }
}
