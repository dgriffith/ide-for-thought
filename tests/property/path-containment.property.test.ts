/**
 * @vitest-environment node
 *
 * Property tests for thoughtbase path containment (#2388): `assertSafePath`
 * (#2357 / #2398) and the agent-path guard `assertAgentPath` (#2453).
 *
 * Paths are generated from weighted segments — `..`, `.`, `.minerva`,
 * `.MINERVA`, `.git`, `node_modules` in any case, ordinary names, names that
 * merely CONTAIN "minerva", empty segments (repeated separators), NFC and NFD
 * spellings of the same name, URL-encoded dots, and absolute prefixes (`/`,
 * the root itself, a sibling of the root).
 *
 *   1. `assertSafePath`: it throws "Path traversal detected", or the path it
 *      returns is under the canonical root.
 *   2. `assertAgentPath`: it throws `AgentPathRefusedError`, or the path it
 *      returns is under the canonical root, is not the root, and has no
 *      hidden/ignored segment (`.`-prefixed or `node_modules`, any case) —
 *      checked by an oracle written here, not by `hasIgnoredSegment`.
 *   3. Filesystem-backed: over a fresh temp tree with random in-root
 *      symlinks — some into `.minerva/`, some out of the root, some dangling,
 *      some chained — every path `assertAgentPath` accepts, once actually
 *      read (if it exists) or WRITTEN (if it does not: `mkdir -p` + write,
 *      which follows a dangling link to create its target), really lives
 *      under the root and outside every hidden folder. Measured with
 *      `realpath` after the IO, so the oracle is where the bytes went, not a
 *      re-derivation of the guard's reasoning.
 *
 * Counterexample convention: see `untrusted-content.property.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assertSafePath,
  assertAgentPath,
  AgentPathRefusedError,
} from '../../src/main/path-containment';
import { propertyParams } from '../helpers/property';

/** Independent oracle for "hidden": a dot-prefixed or ignored segment, any case. */
const IGNORED_LOWER = new Set(['node_modules', '.git', '.minerva', '.obsidian']);
function hiddenSegment(rel: string): string | undefined {
  return rel.split(path.sep).find((s) => s !== '' && (s.startsWith('.') || IGNORED_LOWER.has(s.toLowerCase())));
}

function under(root: string, p: string): boolean {
  return p === root || p.startsWith(root + path.sep);
}

/** Where the path's bytes really are: realpath of the deepest existing ancestor + the rest. */
function landing(abs: string): string {
  const tail: string[] = [];
  let cur = abs;
  for (;;) {
    try {
      return path.join(fs.realpathSync(cur), ...tail);
    } catch {
      const parent = path.dirname(cur);
      if (parent === cur) return abs;
      tail.unshift(path.basename(cur));
      cur = parent;
    }
  }
}

// ── Path grammar ────────────────────────────────────────────────────────────
const SEGMENTS: [number, string][] = [
  [6, '..'], [3, '.'], [6, '.minerva'], [3, '.MINERVA'], [2, '.Minerva'], [3, '.git'],
  [2, 'node_modules'], [2, 'NODE_MODULES'], [8, 'notes'], [4, 'sub'], [4, 'a.md'],
  [3, 'minerva'], [2, 'my-minerva-notes'], [2, 'minerva.md'], [3, ''], [2, 'caf\u00e9'], [2, 'cafe\u0301'],
  [2, '%2e%2e'], [2, '%2Eminerva'], [2, '..minerva'], [2, '.minerva '], [2, ' .minerva'],
  [2, 'secrets.json'], [2, 'conversations'], [2, 'link'], [2, 'up'], [2, 'out'],
];
const segment = fc.oneof(...SEGMENTS.map(([weight, s]) => ({ weight, arbitrary: fc.constant(s) })));

function relPath(prefixes: () => string[]) {
  return fc
    .tuple(
      fc.oneof({ weight: 6, arbitrary: fc.constant('') }, { weight: 1, arbitrary: fc.constantFrom('/', './', '//') }, {
        weight: 1,
        arbitrary: fc.integer({ min: 0, max: 9 }).map((i) => prefixes()[i % prefixes().length]!),
      }),
      fc.array(segment, { minLength: 1, maxLength: 6 }),
      fc.constantFrom('', '', '/'),
    )
    .map(([pre, segs, post]) => pre + segs.join('/') + post);
}

// ── 1 + 2: lexical, over one static tree ────────────────────────────────────
describe('path containment: lexical properties (#2388)', () => {
  let base = '';
  let root = '';

  beforeAll(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-pathprop-')));
    root = path.join(base, 'tb');
    for (const d of ['notes/sub', '.minerva/conversations', '.git', 'node_modules/pkg', 'minerva']) {
      fs.mkdirSync(path.join(root, d), { recursive: true });
    }
    fs.writeFileSync(path.join(root, 'notes', 'a.md'), 'a');
    fs.writeFileSync(path.join(root, '.minerva', 'secrets.json'), '{}');
    fs.mkdirSync(path.join(base, 'out'));
  });
  afterAll(() => fs.rmSync(base, { recursive: true, force: true }));

  const prefixes = () => [`${root}/`, `${root}/.minerva/`, `${base}/`, `${base}/out/`, '/etc/', `${root}/notes/../`];
  const rel = relPath(prefixes);

  it('assertSafePath: throws, or the result is under the root', () => {
    fc.assert(
      fc.property(rel, (p) => {
        let out: string;
        try {
          out = assertSafePath(root, p);
        } catch (e) {
          expect((e as Error).message).toBe('Path traversal detected');
          return;
        }
        expect(under(root, out), `${p} → ${out}`).toBe(true);
        expect(under(root, landing(out)), `${p} lands at ${landing(out)}`).toBe(true);
      }),
      propertyParams(400),
    );
  });

  let accepted = 0;
  it('assertAgentPath: refuses, or the result is under the root with no hidden segment', () => {
    fc.assert(
      fc.property(rel, (p) => {
        let out: string;
        try {
          out = assertAgentPath(root, p);
        } catch (e) {
          expect(e).toBeInstanceOf(AgentPathRefusedError);
          return;
        }
        const real = landing(out);
        expect(under(root, out) && out !== root, `${p} → ${out}`).toBe(true);
        expect(hiddenSegment(path.relative(root, out)), `${p} → ${out}`).toBeUndefined();
        expect(under(root, real) && real !== root, `${p} lands at ${real}`).toBe(true);
        expect(hiddenSegment(path.relative(root, real)), `${p} lands at ${real}`).toBeUndefined();
        accepted++;
      }),
      propertyParams(400),
    );
    // Grammar health: a generator that only produced refusals passes vacuously.
    expect(accepted).toBeGreaterThan(0);
  });
});

// ── 3: filesystem-backed, random symlinks ──────────────────────────────────
interface LinkSpec {
  dir: string;
  name: string;
  target: string;
}

/** Link targets, relative to the link's directory unless absolute (`@` → the
 *  temp base, filled in per tree). */
const LINK_TARGETS = [
  '.minerva', '../.minerva', '../../.minerva', '.minerva/secrets.json', '../.minerva/secrets.json',
  '../.minerva/conversations', '../.minerva/new-dir', '../.minerva/new.json',
  '../.git', '../node_modules', '@/out', '@/out/secret.md', '../../out', '@/missing',
  'sub', '../notes', '.', 'link', 'up/link', 'a.md', '../minerva',
  // In-root and benign, weighted up so the accept path runs through links too.
  'sub', 'notes', '../notes', 'a.md', '../minerva', 'minerva', 'notes/sub',
];
const linkSpec: fc.Arbitrary<LinkSpec> = fc.record({
  dir: fc.constantFrom('', 'notes', 'notes/sub', 'minerva'),
  name: fc.constantFrom('link', 'up', 'out', 'data', 'x.md'),
  target: fc.constantFrom(...LINK_TARGETS),
});

function buildTree(base: string, links: LinkSpec[]): string {
  const root = path.join(base, 'tb');
  for (const d of ['notes/sub', '.minerva/conversations', '.git', 'node_modules/pkg', 'minerva']) {
    fs.mkdirSync(path.join(root, d), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'notes', 'a.md'), 'a');
  fs.writeFileSync(path.join(root, '.minerva', 'secrets.json'), '{}');
  fs.mkdirSync(path.join(base, 'out'), { recursive: true });
  fs.writeFileSync(path.join(base, 'out', 'secret.md'), 'secret');
  for (const { dir, name, target } of links) {
    const at = path.join(root, dir, name);
    if (fs.existsSync(at) || isLink(at)) continue;
    fs.symlinkSync(target.startsWith('@') ? base + target.slice(1) : target, at);
  }
  return root;
}

function isLink(p: string): boolean {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** Do the IO an accepted path permits, and report where it really landed. */
function touch(abs: string): string | null {
  try {
    if (fs.existsSync(abs)) {
      if (fs.statSync(abs).isFile()) fs.readFileSync(abs);
      return fs.realpathSync(abs);
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, 'written by the property');
    return fs.realpathSync(abs);
  } catch {
    // The IO itself failed (ENOTDIR, ELOOP, EEXIST through a dangling link…):
    // nothing was read or written, so nothing leaked.
    return null;
  }
}

describe('path containment: filesystem-backed agent-path property (#2388)', () => {
  // Half the probes walk THROUGH one of this tree's links (`notes/sub/link/…`):
  // a `..` or `.` anywhere is refused before the disk is touched, so the
  // general grammar alone rarely reaches a link at all.
  const throughLink = fc.record({
    i: fc.nat(),
    tail: fc.constantFrom('', '/secrets.json', '/new.md', '/conversations/c.json', '/sub/a.md', '/a.md', '/link/x.md', '/new-dir/y.md'),
  });
  const probe = fc.oneof(relPath(() => ['/']), throughLink);
  const spell = (p: string | { i: number; tail: string }, links: LinkSpec[]): string => {
    if (typeof p === 'string') return p;
    const l = links[p.i % links.length]!;
    return (l.dir ? `${l.dir}/` : '') + l.name + p.tail;
  };
  const stats = { refused: 0, accepted: 0, touched: 0, viaLink: 0 };

  it('an accepted path, once read or written, really lives in-root and outside hidden folders', () => {
    fc.assert(
      fc.property(fc.array(linkSpec, { minLength: 1, maxLength: 6 }), fc.array(probe, { minLength: 1, maxLength: 8 }), (links, probes) => {
        const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-pathprop-fs-')));
        try {
          const root = buildTree(base, links);
          for (const spec of probes) {
            const p = spell(spec, links);
            let out: string;
            try {
              out = assertAgentPath(root, p);
            } catch (e) {
              expect(e).toBeInstanceOf(AgentPathRefusedError);
              stats.refused++;
              continue;
            }
            stats.accepted++;
            const real = touch(out);
            if (real === null) continue;
            stats.touched++;
            if (real !== out) stats.viaLink++;
            const rel = path.relative(root, real);
            expect(under(root, real) && real !== root, `${p} (links ${JSON.stringify(links)}) landed at ${real}`).toBe(true);
            expect(hiddenSegment(rel), `${p} (links ${JSON.stringify(links)}) landed at ${real}`).toBeUndefined();
          }
        } finally {
          fs.rmSync(base, { recursive: true, force: true });
        }
      }),
      propertyParams(80),
    );
  });

  it('exercises the accept path, including through symlinks (grammar health)', () => {
    // Runs after the property. A grammar that only produced refusals, or
    // never reached a file through a link, would pass the property vacuously.
    expect(stats.refused).toBeGreaterThan(0);
    expect(stats.touched).toBeGreaterThan(stats.accepted / 4);
    expect(stats.viaLink).toBeGreaterThan(5);
  });
});
