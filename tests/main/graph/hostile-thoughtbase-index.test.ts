/**
 * The graph rebuild against an adversarial thoughtbase (#2372).
 *
 * Two walks read every note: the alias pre-pass and the main pass. Both list
 * entries with `readdir`, which reports an in-root dangling symlink like any
 * other `.md`. The pre-pass used to REGISTER that path before trying to read
 * it (so `[[dangling]]` resolved to a note that was never indexed) and the
 * main pass's `readFile` then threw ENOENT and rejected the whole rebuild —
 * the thoughtbase opened with an empty graph.
 *
 * `.minerva/` corruption is covered separately below: a truncated
 * `config.json` used to make `initGraph` reject, so one bad settings file
 * refused to open the thoughtbase at all.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { silenceLogTags } from '../../helpers/quiet-logs';
import fs from 'node:fs';
import path from 'node:path';
import {
  initGraph, indexAllNotes, queryGraph, disposeProject, noteUriFor,
} from '../../../src/main/graph/index';
import { coinBaseUri } from '../../../src/main/graph/uri-helpers';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { reportConfigError } from '../../../src/main/config/config-store';
// Keep the real reporter, but observe it: corruption must be LOUD (#1640).
vi.mock('../../../src/main/config/config-store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/config/config-store')>();
  return { ...actual, reportConfigError: vi.fn() };
});

import {
  useHostileThoughtbase,
  NOTE_TREE_FEATURES,
  CONTROL_NOTES,
  OUTSIDE_SECRET,
  FM_COMMENT_NOTE,
  CRLF_FM_NOTE,
  BOM_FM_TITLE,
  posix,
  type HostileFeature,
} from '../../helpers/hostile-thoughtbase';

async function indexedPaths(ctx: ProjectContext): Promise<Set<string>> {
  const { results } = await queryGraph(ctx, `SELECT ?p WHERE { ?n a minerva:Note ; minerva:relativePath ?p . }`);
  return new Set((results as Array<{ p: string }>).map((r) => r.p));
}

async function graphMentions(ctx: ProjectContext, needle: string): Promise<boolean> {
  const { results } = await queryGraph(ctx, `
    SELECT ?o WHERE { ?s ?p ?o . FILTER(isLiteral(?o) && CONTAINS(STR(?o), "${needle}")) } LIMIT 1
  `);
  return results.length > 0;
}

// Expected: these tests drive failure paths the code logs (#2390).
silenceLogTags('graph');

describe('graph indexAllNotes on a hostile note tree (#2372)', () => {
  const tb = useHostileThoughtbase(NOTE_TREE_FEATURES, 'minerva-graph-hostile-');
  let ctx: ProjectContext;

  beforeEach(async () => {
    ctx = projectContext(tb.manifest.root);
    await initGraph(ctx);
  });
  afterEach(() => { disposeProject(ctx); });

  it('completes the rebuild instead of rejecting on an unreadable entry', async () => {
    await expect(indexAllNotes(ctx)).resolves.toBeGreaterThan(0);
  });

  it('indexes both well-formed control notes', async () => {
    await indexAllNotes(ctx);
    const paths = await indexedPaths(ctx);
    expect([posix(CONTROL_NOTES.alpha), posix(CONTROL_NOTES.beta)].filter((p) => !paths.has(p))).toEqual([]);
  });

  it('never reads content through a symlink that leaves the root', async () => {
    await indexAllNotes(ctx);
    expect(await graphMentions(ctx, OUTSIDE_SECRET)).toBe(false);
  });

  it('indexes no dangling or looping symlink as a note', async () => {
    await indexAllNotes(ctx);
    const paths = await indexedPaths(ctx);
    const unreadable = [
      ...(tb.manifest.paths['symlink-dangling'] ?? []),
      ...(tb.manifest.paths['symlink-loop'] ?? []),
    ].map(posix);
    expect(unreadable.filter((p) => paths.has(p))).toEqual([]);
  });

  it('skips a permission-denied note and folder without registering either', async () => {
    const perms = [...(tb.manifest.paths['unreadable-note'] ?? []), ...(tb.manifest.paths['unreadable-dir'] ?? [])];
    if (perms.length === 0) return; // running as root: mode bits don't bite
    await indexAllNotes(ctx);
    const paths = [...await indexedPaths(ctx)];
    expect(paths.filter((p) => p.startsWith('perms/'))).toEqual([]);
    expect(await graphMentions(ctx, 'lockedmarker')).toBe(false);
  });

  it.skipIf(process.getuid?.() === 0)('still rejects when the thoughtbase ROOT cannot be listed', async () => {
    fs.chmodSync(tb.manifest.root, 0o000);
    try {
      await expect(indexAllNotes(ctx)).rejects.toMatchObject({ code: 'EACCES' });
    } finally {
      fs.chmodSync(tb.manifest.root, 0o755);
    }
  });

  it('reports a progress total equal to what it actually indexed', async () => {
    const ticks: Array<[number, number]> = [];
    await indexAllNotes(ctx, { onProgress: (done, total) => ticks.push([done, total]) });
    const [done, total] = ticks[ticks.length - 1];
    expect(done).toBe(total);
  });

  const indexedFeatures: HostileFeature[] = [
    'symlink-in-root', 'invalid-utf8', 'utf8-bom', 'cesu-surrogate', 'nul-bytes',
    'crlf-frontmatter', 'long-filename', 'long-path', 'nfc-nfd-pair', 'special-chars',
    'emoji-name', 'case-pair', 'empty-note', 'huge-single-line', 'fm-unterminated',
    'fm-yaml-throws', 'fm-alias-bomb', 'fm-comment-no-title',
  ];
  it.each(indexedFeatures)('indexes the %s note(s) under their own relative path', async (feature) => {
    await indexAllNotes(ctx);
    const paths = await indexedPaths(ctx);
    const missing = (tb.manifest.paths[feature] ?? []).map(posix).filter((p) => !paths.has(p));
    expect(missing).toEqual([]);
  });

  it('titles a note with a frontmatter comment and no title: by its body H1 (#2683)', async () => {
    await indexAllNotes(ctx);
    const { results } = await queryGraph(ctx, `
      SELECT ?t WHERE { ?n minerva:relativePath "${posix(FM_COMMENT_NOTE.rel)}" ; dc:title ?t . }
    `);
    expect((results as Array<{ t: string }>).map((r) => r.t)).toEqual([FM_COMMENT_NOTE.title]);
  });

  it('reads every frontmatter field of a CRLF note: title, type, tags, aliases, typed property (#2690)', async () => {
    await indexAllNotes(ctx);
    const rel = posix(CRLF_FM_NOTE.rel);
    const { results } = await queryGraph(ctx, `
      SELECT ?t ?typeId ?tag ?alias ?rating WHERE {
        ?n minerva:relativePath "${rel}" ; dc:title ?t ; a ?c ; minerva:hasAlias ?alias ;
           minerva:hasTag/minerva:tagName ?tag ; minerva:meta-rating ?rating .
        ?c minerva:typeId ?typeId .
      }
    `);
    const rows = results as Array<Record<string, string>>;
    const distinct = (k: string) => [...new Set(rows.map((r) => r[k]))].sort();
    expect(distinct('t')).toEqual([CRLF_FM_NOTE.title]);
    expect(distinct('typeId')).toEqual([CRLF_FM_NOTE.type]);
    expect(distinct('tag')).toEqual([...CRLF_FM_NOTE.tags].sort());
    expect(distinct('alias')).toEqual([CRLF_FM_NOTE.alias]);
    expect(distinct('rating')).toEqual([CRLF_FM_NOTE.rating]);
  });

  it('reads the frontmatter title of a note behind a UTF-8 byte-order mark (#2690)', async () => {
    await indexAllNotes(ctx);
    const rel = posix(tb.manifest.paths['utf8-bom']![0]);
    const { results } = await queryGraph(ctx, `SELECT ?t WHERE { ?n minerva:relativePath "${rel}" ; dc:title ?t . }`);
    expect((results as Array<{ t: string }>).map((r) => r.t)).toEqual([BOM_FM_TITLE]);
  });

  it('keeps the body text that follows invalid UTF-8 bytes', async () => {
    await indexAllNotes(ctx);
    expect(await graphMentions(ctx, 'Invalid Bytes')).toBe(true);
  });
});

describe('graph indexAllNotes: a dangling in-root link is not registered as a note (#2372)', () => {
  const tb = useHostileThoughtbase(['symlink-dangling'], 'minerva-graph-dangling-');
  let ctx: ProjectContext;

  beforeEach(async () => {
    ctx = projectContext(tb.manifest.root);
    await initGraph(ctx);
  });
  afterEach(() => { disposeProject(ctx); });

  it('does not resolve a wiki-link to the dangling link as if it were an indexed note', async () => {
    // `links/dangling.md` exists as a directory entry but has nothing behind it.
    fs.writeFileSync(path.join(tb.manifest.root, 'linker.md'), '# Linker\n\nsee [[dangling]] and [[alpha]]\n');

    await indexAllNotes(ctx);

    // Registered, `[[dangling]]` would resolve to `…/note/links/dangling` — an
    // IRI the graph never describes. Unregistered, it stays an unresolved link
    // to the bare `…/note/dangling`. `[[alpha]]` proves resolution works.
    const { results } = await queryGraph(ctx, `
      SELECT ?t WHERE { ?n minerva:relativePath "linker.md" ; minerva:references ?t . }
    `);
    const targets = (results as Array<{ t: string }>).map((r) => r.t);
    expect(targets.map((t) => t.replace(/^.*\/note\//, '')).sort()).toEqual(['control/alpha', 'dangling']);
  });
});

describe('initGraph + rebuild with a corrupt .minerva/ (#2372)', () => {
  const tb = useHostileThoughtbase(['corrupt-config', 'corrupt-graph', 'corrupt-source-meta'], 'minerva-graph-corrupt-');
  let ctx: ProjectContext;

  beforeEach(() => {
    ctx = projectContext(tb.manifest.root);
    vi.mocked(reportConfigError).mockClear();
  });
  afterEach(() => { disposeProject(ctx); });

  const configFile = () => path.join(tb.manifest.root, posix(tb.manifest.paths['corrupt-config']![0]));

  it('opens the graph instead of rejecting over an unparseable config.json', async () => {
    await expect(initGraph(ctx, { rebuildFollows: true })).resolves.toBeUndefined();
  });

  it('leaves the corrupt config.json byte-identical (no patch merged over it)', async () => {
    const before = fs.readFileSync(configFile());
    await initGraph(ctx, { rebuildFollows: true });
    await indexAllNotes(ctx);
    expect(fs.readFileSync(configFile()).equals(before)).toBe(true);
  });

  it('reports the corrupt config.json rather than swallowing it', async () => {
    await initGraph(ctx, { rebuildFollows: true });
    expect(reportConfigError).toHaveBeenCalledWith(configFile(), 'parse', expect.anything());
  });

  it('falls back to the coined base URI for the session, so notes still get IRIs', async () => {
    await initGraph(ctx, { rebuildFollows: true });
    expect(noteUriFor(ctx, 'control/alpha.md')).toBe(`${coinBaseUri(tb.manifest.root)}note/control/alpha`);
  });

  it('still indexes the control notes and the healthy source next to the broken one', async () => {
    await initGraph(ctx, { rebuildFollows: true });
    await indexAllNotes(ctx);
    const paths = await indexedPaths(ctx);
    expect(paths.has(posix(CONTROL_NOTES.alpha))).toBe(true);
    const { results } = await queryGraph(ctx, `SELECT ?id WHERE { ?s minerva:sourceId ?id . }`);
    expect((results as Array<{ id: string }>).map((r) => r.id)).toContain('good-source');
  });
});
