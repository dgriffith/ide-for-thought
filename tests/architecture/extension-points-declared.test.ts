/**
 * @vitest-environment node
 *
 * A new seam must be declared in the extension-point catalog (#2621, epic
 * #2616). The catalog (`src/shared/extensions/points.ts`) is what the docs
 * page, the graph and the agents' tools are built from, so a seam missing
 * from it is a way to extend Minerva that nobody can find without reading
 * the source — the gap the catalog exists to close.
 *
 * Two shapes are found in `src/`:
 *
 * - **Registries:** an exported `register*` function that writes a
 *   module-level `Map`. Each must be named by a point — its contract or one of
 *   its `registries`.
 * - **User-content folders:** a child of `.minerva/` (in the thoughtbase or
 *   the home directory) that the code reads. Each must be a point's
 *   `location`, or be app state rather than a contribution (`NOT_A_SEAM`, with
 *   the reason).
 *
 * `KNOWN_UNDECLARED` holds a seam that can't be declared yet, with a reason;
 * it may only shrink.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { EXTENSION_POINTS, type ExtensionPoint } from '../../src/shared/extensions/points';

const ROOT = path.resolve(__dirname, '..', '..');
const POINTS = EXTENSION_POINTS as readonly ExtensionPoint[];

/** `.minerva/` children that hold app state or the user's data — not a way to extend Minerva. */
const NOT_A_SEAM: Record<string, string> = {
  'graph.ttl': 'the knowledge graph, derived from the notes',
  'search-index.json': 'the full-text index',
  'vectors.duckdb': 'the semantic-search index',
  cache: 'derived caches',
  'publish-cache': 'the export pipeline\'s cache',
  history: 'local version history of notes',
  conversations: 'conversation transcripts',
  'secrets.json': 'credentials',
  'config.json': 'the thoughtbase\'s settings (name, base IRI)',
  'formatter.json': 'the formatter\'s settings',
  'site-config.json': 'the static-site exporter\'s settings, written by its dialog',
  'menu-config.json': 'which menu each skill sits in — settings for the skills seam, not a seam',
  'tabs.json': 'open tabs, restored at launch',
  'bookmarks.json': 'the user\'s bookmarks',
  'collections.json': 'the user\'s source collections',
  sources: 'ingested sources — the user\'s data',
  excerpts: 'excerpts of sources — the user\'s data',
  assets: 'pasted and dropped images — the user\'s data',
  __eval_stock_only__: 'the skill-eval harness\'s empty user-skills folder (src/cli/eval.ts)',
};

/** Exported `register*` functions over a module Map that aren't extension seams. */
const NOT_A_SEAM_REGISTRY: Record<string, string> = {
  'src/main/substrate/app-server.ts': 'the open projects advertised to the CLI — runtime state',
  'src/main/ipc/register-notebase.ts': 'an IPC registrar\'s in-flight search map — runtime state',
};

/** Seams that can't be declared yet. Shrink-only; a reason per entry. */
const KNOWN_UNDECLARED: Record<string, string> = {};

function sourceFiles(dir = path.join(ROOT, 'src')): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.(ts|svelte)$/.test(e.name) ? [full] : [];
  });
}

const rel = (abs: string) => path.relative(ROOT, abs).split(path.sep).join('/');

/** Files declaring a module-level Map that an exported `register*` writes. */
function registryFiles(): string[] {
  const found: string[] = [];
  for (const file of sourceFiles()) {
    const src = fs.readFileSync(file, 'utf-8');
    const maps = [...src.matchAll(/^(?:export )?(?:const|let) (\w+)(?:: [^=\n]+)? = new Map\b/gm)].map((m) => m[1]!);
    if (maps.length === 0) continue;
    for (const fn of src.matchAll(/^export (?:async )?function register\w*\(/gm)) {
      const end = src.indexOf('\n}\n', fn.index);
      const body = src.slice(fn.index, end < 0 ? undefined : end);
      if (maps.some((m) => new RegExp(`\\b${m}\\.set\\(`).test(body))) { found.push(rel(file)); break; }
    }
  }
  return found.sort();
}

/** Children of `.minerva/` the code names, as `'.minerva/x` or `'.minerva', 'x'`. */
function minervaChildren(): string[] {
  const found = new Set<string>();
  for (const file of sourceFiles()) {
    const src = fs.readFileSync(file, 'utf-8');
    for (const m of src.matchAll(/'\.minerva\/([\w.-]+)|'\.minerva', '([\w.-]+)'/g)) {
      const child = (m[1] ?? m[2])!;
      if (!child.startsWith('.')) found.add(child); // `.minerva`, `.obsidian` side by side is IGNORED_DIRS, not a path
    }
  }
  return [...found].sort();
}

describe('every seam is declared in the extension-point catalog (#2621)', () => {
  it('finds both shapes — an empty scan would pass vacuously', () => {
    expect(registryFiles().length).toBeGreaterThanOrEqual(4);
    expect(minervaChildren()).toEqual(expect.arrayContaining(['skills', 'types', 'graph.ttl']));
  });

  it('every registry belongs to a declared extension point', () => {
    const declared = new Set(POINTS.flatMap((p) => [p.contract.at.file, ...(p.registries ?? []).map((r) => r.file)]));
    const undeclared = registryFiles().filter((f) => !declared.has(f) && !(f in NOT_A_SEAM_REGISTRY) && !(f in KNOWN_UNDECLARED));
    expect(undeclared, 'declare it in src/shared/extensions/points.ts (as a `source` seam if only built-ins use it)').toEqual([]);
  });

  it('every .minerva/ folder or file the code reads is a declared location or app state', () => {
    const locations = POINTS.map((p) => p.location ?? '').join(' ');
    const undeclared = minervaChildren().filter((c) =>
      !locations.includes(`.minerva/${c}`) && !(c in NOT_A_SEAM) && !(c in KNOWN_UNDECLARED));
    expect(undeclared, 'a contribution folder → declare its point; app state → NOT_A_SEAM with the reason').toEqual([]);
  });

  it('the exemption lists name nothing stale', () => {
    const children = new Set(minervaChildren());
    const registries = new Set(registryFiles());
    expect(Object.keys(NOT_A_SEAM).filter((c) => !children.has(c))).toEqual([]);
    expect(Object.keys(NOT_A_SEAM_REGISTRY).filter((f) => !registries.has(f))).toEqual([]);
    expect(Object.keys(KNOWN_UNDECLARED).filter((k) => !children.has(k) && !registries.has(k))).toEqual([]);
  });
});
