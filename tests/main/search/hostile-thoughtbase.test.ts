/**
 * The full-text indexer against an adversarial thoughtbase (#2372).
 *
 * `indexAllNotes` walks with `readdir` + raw `fs.readFile`. `readdir` lists an
 * in-root dangling symlink or a symlink loop like any other `.md` file, and a
 * single ENOENT / ELOOP from one of them used to reject the whole walk — the
 * project then opened with an EMPTY search index, not one missing a file.
 * Everything else here (bad bytes, odd names, a PATH_MAX-deep note, a 3 MB
 * line) is a file the index must take without incident.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { silenceLogTags } from '../../helpers/quiet-logs';
import fs from 'node:fs';
import path from 'node:path';
import { indexAllNotes, search, disposeProject } from '../../../src/main/search/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import {
  useHostileThoughtbase,
  NOTE_TREE_FEATURES,
  CONTROL_NOTES,
  OUTSIDE_SECRET,
  FM_COMMENT_NOTE,
  posix,
  type HostileFeature,
} from '../../helpers/hostile-thoughtbase';

async function hits(ctx: ProjectContext, q: string): Promise<string[]> {
  return (await search(ctx, q)).map((r) => r.relativePath).sort();
}

// Expected: these tests drive failure paths the code logs (#2390).
silenceLogTags('search');

describe('search indexAllNotes on a hostile thoughtbase (#2372)', () => {
  const tb = useHostileThoughtbase(NOTE_TREE_FEATURES, 'minerva-search-hostile-');
  let ctx: ProjectContext;

  beforeEach(() => {
    ctx = projectContext(tb.manifest.root);
    // The walk persists to `.minerva/search-index.json` when it finishes.
    fs.mkdirSync(path.join(tb.manifest.root, '.minerva'), { recursive: true });
  });
  afterEach(() => { disposeProject(ctx); });

  it('completes the walk instead of rejecting on the first unreadable entry', async () => {
    await expect(indexAllNotes(ctx)).resolves.toBeGreaterThan(0);
  });

  it('still indexes the well-formed control notes', async () => {
    await indexAllNotes(ctx);
    expect(await hits(ctx, 'alphamarker')).toEqual([posix(CONTROL_NOTES.alpha)]);
  });

  it('never indexes the content an escaping symlink points at', async () => {
    await indexAllNotes(ctx);
    expect(await hits(ctx, OUTSIDE_SECRET)).toEqual([]);
  });

  it('does not index a dangling symlink or either end of a symlink loop', async () => {
    await indexAllNotes(ctx);
    const unreadable = [
      ...(tb.manifest.paths['symlink-dangling'] ?? []),
      ...(tb.manifest.paths['symlink-loop'] ?? []),
    ].map(posix);
    // An unread note would still be findable by its filename-derived title.
    const indexed = new Set([
      ...(await hits(ctx, 'dangling')),
      ...(await hits(ctx, 'loop')),
    ]);
    expect(unreadable.filter((p) => indexed.has(p))).toEqual([]);
  });

  it('skips a permission-denied note and folder, and nothing else', async () => {
    const perms = [...(tb.manifest.paths['unreadable-note'] ?? []), ...(tb.manifest.paths['unreadable-dir'] ?? [])];
    if (perms.length === 0) return; // running as root: mode bits don't bite
    await indexAllNotes(ctx);
    expect(await hits(ctx, 'unreadablemarker')).toEqual([]);
    expect(await hits(ctx, 'lockedmarker')).toEqual([]);
    expect(await hits(ctx, 'betamarker')).toEqual([posix(CONTROL_NOTES.beta)]);
  });

  // Every note the fixture marked is one the index must be able to find by
  // its marker word — bad bytes, BOM, NULs, CRLF, 255-byte names, a note at
  // PATH_MAX, emoji / NFC / `#` / `%` / `?` names and a 3 MB single line.
  const markedFeatures: HostileFeature[] = [
    'symlink-in-root', 'invalid-utf8', 'utf8-bom', 'cesu-surrogate', 'nul-bytes',
    'crlf-frontmatter', 'long-filename', 'long-path', 'nfc-nfd-pair', 'special-chars',
    'emoji-name', 'case-pair', 'huge-single-line', 'fm-unterminated', 'fm-yaml-throws',
    'fm-alias-bomb', 'fm-comment-no-title',
  ];
  it.each(markedFeatures)('indexes the %s note(s) under their own path', async (feature) => {
    await indexAllNotes(ctx);
    const created = tb.manifest.paths[feature] ?? [];
    // `long-path` is skipped on a platform with no known PATH_MAX.
    for (const rel of created) {
      const marker = tb.manifest.markers[rel];
      expect(marker, `fixture gave ${rel} no marker`).toBeTruthy();
      expect(await hits(ctx, marker)).toContain(posix(rel));
    }
  });

  it.skipIf(process.getuid?.() === 0)('still rejects when the thoughtbase ROOT cannot be listed', async () => {
    fs.chmodSync(tb.manifest.root, 0o000);
    try {
      await expect(indexAllNotes(ctx)).rejects.toMatchObject({ code: 'EACCES' });
    } finally {
      fs.chmodSync(tb.manifest.root, 0o755);
    }
  });

  it('titles a note with a frontmatter comment and no title: by its body H1 (#2683)', async () => {
    await indexAllNotes(ctx);
    const results = await search(ctx, 'fmcommentmarker');
    expect(results.map((r) => [r.relativePath, r.title])).toEqual([[posix(FM_COMMENT_NOTE.rel), FM_COMMENT_NOTE.title]]);
  });

  it('decodes invalid UTF-8 lossily (U+FFFD) rather than dropping the rest of the note', async () => {
    await indexAllNotes(ctx);
    // "tail" sits AFTER the invalid bytes in the note body.
    const rel = posix(tb.manifest.paths['invalid-utf8']![0]);
    expect(await hits(ctx, 'tail')).toContain(rel);
  });
});
