/**
 * Lazy-load MapLibre GL JS (#2066). It's a heavy dep, so it's dynamic-`import()`ed
 * and cached in a module-level promise — kept out of the initial renderer bundle,
 * the same posture as cytoscape / mermaid / vega-embed. Its required stylesheet is
 * imported alongside it (also lazily, as its own chunk) rather than statically at
 * the top of some eagerly-loaded file, so a user who never opens a Map view never
 * pays for either.
 */

// maplibre-gl v6 has no default export — the dynamic import's module
// namespace object itself carries Map/Marker/NavigationControl/etc. as named
// properties, so unlike loadCytoscape() there's no `m.default ?? m` to unwrap.
type MapLibreModule = typeof import('maplibre-gl');

// MapLibre's own tile-decode worker discovery (`defaultWorkerUrl` in its
// web_worker module) only builds a worker URL when `import.meta.url` matches
// `/^https?:/` — under Electron's packaged file:// renderer it returns `""`,
// which resolves `new Worker("")` to the current document (index.html)
// itself. Pointing `config.WORKER_URL` at Vite's own resolved asset URL for
// the worker bundle (same `?url` pattern as pdfjs-dist's worker import in
// run-ocr.ts/PdfViewer.svelte) sidesteps that scheme check — but isn't
// sufficient by itself: maplibre-gl-worker.mjs has its own internal
// `import ... from "./maplibre-gl-shared.mjs"`, a relative specifier that
// resolves fine when the two files sit side by side in node_modules, but
// Vite's `?url` treatment copies ONLY the one file it's asked for (with a
// content-hashed name), never that sibling — so the worker 404s on its own
// first import and dies silently (no console error, no failed vector tiles,
// just an empty basemap). Fetching the worker's source ourselves and
// rewriting that one specifier to the shared chunk's own `?url`-resolved
// path — then handing the patched source to `new Worker()` as a blob —
// keeps both files' real content untouched and needs no build-time asset
// wrangling.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import maplibreWorkerSharedUrl from 'maplibre-gl/dist/maplibre-gl-shared.mjs?url';

const WORKER_SHARED_IMPORT_SPECIFIER = './maplibre-gl-shared.mjs';

let promise: Promise<MapLibreModule> | null = null;

async function resolvePatchedWorkerUrl(): Promise<string> {
  const source = await fetch(maplibreWorkerUrl).then((r) => r.text());
  const patched = source.replace(WORKER_SHARED_IMPORT_SPECIFIER, maplibreWorkerSharedUrl);
  return URL.createObjectURL(new Blob([patched], { type: 'text/javascript' }));
}

export function loadMapLibre(): Promise<MapLibreModule> {
  if (!promise) {
    promise = Promise.all([
      import('maplibre-gl'),
      import('maplibre-gl/dist/maplibre-gl.css'),
      resolvePatchedWorkerUrl(),
    ]).then(([m, , workerUrl]) => {
      m.config.WORKER_URL = workerUrl;
      return m;
    });
  }
  return promise;
}
