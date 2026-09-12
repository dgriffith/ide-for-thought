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
// but getting there took three rounds (verified empirically every time
// against a real Electron BrowserWindow, not assumed from reading docs):
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
// Round 2: pulling both files in via `?raw` instead of `fetch()` (returns
// the literal on-disk bytes untouched in both dev and prod) fixes the
// dev-mode rewrite problem, but substituting an absolute http(s)/root-
// relative URL as the import target still fails — a module `Worker`
// constructed from a `blob:` URL cannot statically `import` an http(s)-
// scheme module (confirmed by isolating it: a classic worker from blob:
// works, a module worker from blob: with no nested import works, but a
// module worker from blob: importing an absolute same-origin http(s) URL
// throws — a bare, unhelpful `ErrorEvent` with no message/filename/lineno.
// blob: importing *another* blob: URL works fine). So the shared chunk gets
// its own blob: URL, substituted into the worker's patched import instead —
// blob importing blob, never blob importing http(s).
//
// Round 3 (CI caught this one — bundle-budget.spec.ts): `?raw` imports are
// static, and a *static* import is resolved into whatever chunk the
// importing module ends up in, regardless of when the code that uses the
// value actually runs. maplibre-gl-shared.mjs is ~500KB minified — Round 2's
// two `import ... from '...?raw'` at the top of this file put that entire
// string, unconditionally, into the eager renderer entry chunk (this module
// is statically imported by TypeViewMap.svelte for the `loadMapLibre`
// function reference), even though nothing here needs it until a user
// actually opens a Map view. `?raw` still returns the literal untouched
// bytes when imported dynamically — the fix is just moving both imports
// into the SAME `Promise.all` as the already-dynamic `import('maplibre-gl')`
// below, so they land in the same lazily-fetched chunk instead of the eager
// one.
const WORKER_SHARED_IMPORT_SPECIFIER = './maplibre-gl-shared.mjs';

let promise: Promise<MapLibreModule> | null = null;

function resolvePatchedWorkerUrl(workerSource: string, sharedSource: string): string {
  const sharedBlobUrl = URL.createObjectURL(new Blob([sharedSource], { type: 'text/javascript' }));
  const patched = workerSource.replace(WORKER_SHARED_IMPORT_SPECIFIER, sharedBlobUrl);
  return URL.createObjectURL(new Blob([patched], { type: 'text/javascript' }));
}

export function loadMapLibre(): Promise<MapLibreModule> {
  if (!promise) {
    promise = Promise.all([
      import('maplibre-gl'),
      import('maplibre-gl/dist/maplibre-gl.css'),
      import('maplibre-gl/dist/maplibre-gl-worker.mjs?raw'),
      import('maplibre-gl/dist/maplibre-gl-shared.mjs?raw'),
    ]).then(([m, , workerMod, sharedMod]) => {
      m.config.WORKER_URL = resolvePatchedWorkerUrl(workerMod.default, sharedMod.default);
      return m;
    });
  }
  return promise;
}
