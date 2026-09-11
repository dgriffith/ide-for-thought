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
// itself. Pointing `config.WORKER_URL` at a patched blob works around that —
// but getting there took two rounds (verified empirically both times against
// a real Electron BrowserWindow, not assumed from reading docs):
//
// Round 1 (the original fix): maplibre-gl-worker.mjs has its own internal
// `import ... from "./maplibre-gl-shared.mjs"`, a relative specifier that
// resolves fine when the two files sit side by side in node_modules but not
// once either file is served standalone. The original fix fetched the
// worker's source via a `?url`-resolved path and string-replaced that one
// specifier with the shared chunk's own `?url` path. This reads correctly
// but is dev-mode-broken: Vite's dev server rewrites relative imports in ANY
// `.mjs`/`.js` it serves — including a file fetched as a plain asset, not
// just ones reached through Vite's own module graph — so by the time the
// fetched text reaches the `.replace()` call, the literal
// `"./maplibre-gl-shared.mjs"` specifier is already gone, rewritten to an
// absolute `?v=<hash>` dev-server URL. The replace becomes a silent no-op,
// and the *unpatched, Vite-rewritten* worker source is what actually loads —
// same failure signature as before the "fix": no console error, no failed
// network request either (the rewritten URL serves fine on its own), just an
// empty basemap.
//
// Round 2 (the actual fix): even with that dev-mode rewrite worked around —
// e.g. by pulling the worker's source in via `?raw` instead of `fetch()`,
// which returns the literal on-disk bytes untouched in both dev and prod —
// substituting an absolute http(s)/root-relative URL as the import target
// still fails. A module `Worker` constructed from a `blob:` URL cannot
// statically `import` an http(s)-scheme module — confirmed by isolating it:
// a classic worker from blob: works, a module worker from blob: with no
// nested import works, but a module worker from blob: importing an absolute
// same-origin http(s) URL throws (a bare, unhelpful `ErrorEvent` with no
// message/filename/lineno — Chromium's worker-script-load failures don't
// carry detail the way a same-thread import error would). blob: importing
// *another* blob: URL works fine. So both files are pulled in via `?raw`
// (build-time literal strings — no runtime fetch, no dev/prod serving
// difference to trip over) and the shared chunk gets its own blob: URL,
// which is what gets substituted into the worker's patched import — blob
// importing blob, never blob importing http(s).
import maplibreWorkerSource from 'maplibre-gl/dist/maplibre-gl-worker.mjs?raw';
import maplibreWorkerSharedSource from 'maplibre-gl/dist/maplibre-gl-shared.mjs?raw';

const WORKER_SHARED_IMPORT_SPECIFIER = './maplibre-gl-shared.mjs';

let promise: Promise<MapLibreModule> | null = null;

function resolvePatchedWorkerUrl(): string {
  const sharedBlobUrl = URL.createObjectURL(new Blob([maplibreWorkerSharedSource], { type: 'text/javascript' }));
  const patched = maplibreWorkerSource.replace(WORKER_SHARED_IMPORT_SPECIFIER, sharedBlobUrl);
  return URL.createObjectURL(new Blob([patched], { type: 'text/javascript' }));
}

export function loadMapLibre(): Promise<MapLibreModule> {
  if (!promise) {
    promise = Promise.all([
      import('maplibre-gl'),
      import('maplibre-gl/dist/maplibre-gl.css'),
    ]).then(([m]) => {
      m.config.WORKER_URL = resolvePatchedWorkerUrl();
      return m;
    });
  }
  return promise;
}
