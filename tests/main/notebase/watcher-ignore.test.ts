/**
 * The notes watcher's ignore matcher (#2224).
 *
 * The three `ignored` entries this replaces were checked by nothing, and two
 * of the three did nothing. The unit block below pins the matcher's own
 * decisions; the block after it pins the chokidar-5 semantics that made the
 * old list dead, so that if a future chokidar ever restores glob matching, a
 * test says so out loud rather than the codebase quietly keeping a predicate
 * it no longer needs.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { watch, type Matcher } from 'chokidar';

import { createWatchIgnoreMatcher } from '../../../src/main/notebase/watcher-ignore';

describe('createWatchIgnoreMatcher() (#2224)', () => {
  const root = '/Users/someone/thoughts';
  const ignored = createWatchIgnoreMatcher(root);

  it('does not ignore the watch root itself', () => {
    // chokidar asks about the root before descending into it. Answering
    // "ignore" here watches precisely nothing.
    expect(ignored(root)).toBe(false);
  });

  it('does not ignore ordinary notes at any depth', () => {
    expect(ignored(`${root}/note.md`)).toBe(false);
    expect(ignored(`${root}/projects/2026/plan.md`)).toBe(false);
    expect(ignored(`${root}/projects`)).toBe(false);
  });

  it('ignores node_modules — the entry the dead glob was supposed to cover', () => {
    // The regression this issue is about. `'**/node_modules/**'` compiled to
    // an exact string equality under chokidar 5, so every one of these was
    // recursively watched.
    expect(ignored(`${root}/node_modules`)).toBe(true);
    expect(ignored(`${root}/node_modules/left-pad/readme.md`)).toBe(true);
    expect(ignored(`${root}/sub/deep/node_modules/pkg/index.md`)).toBe(true);
  });

  it('ignores dot-prefixed entries inside the thoughtbase', () => {
    expect(ignored(`${root}/.minerva/graph.ttl`)).toBe(true);
    expect(ignored(`${root}/.git/config`)).toBe(true);
    expect(ignored(`${root}/.obsidian/workspace.json`)).toBe(true);
    expect(ignored(`${root}/notes/.DS_Store`)).toBe(true);
    expect(ignored(`${root}/.hidden-draft.md`)).toBe(true);
  });

  it('matches whole segments, not substrings', () => {
    // `my_node_modules_notes` is a perfectly good folder name, and a
    // `.gitignore`-style substring match would eat it.
    expect(ignored(`${root}/my_node_modules_notes/a.md`)).toBe(false);
    expect(ignored(`${root}/node_modules_archive/a.md`)).toBe(false);
    expect(ignored(`${root}/notes/version.1.md`)).toBe(false);
  });

  it('ignores nothing on account of an ANCESTOR of the thoughtbase (#2224)', () => {
    // The other half of the bug: chokidar tests matchers against the
    // normalized ABSOLUTE path, so the old `/(^|[/\\])\./` regex fired on a
    // dot-segment anywhere above the root. A thoughtbase under
    // `~/Dropbox/.private/` had every event silently suppressed — no tree
    // refresh, no reindex, no error. Matching relative to the root is what
    // fixes it, so these are the assertions that would regress if someone
    // reverted to an absolute match.
    const dotted = createWatchIgnoreMatcher('/Users/someone/Dropbox/.private/notes');
    expect(dotted('/Users/someone/Dropbox/.private/notes/note.md')).toBe(false);
    expect(dotted('/Users/someone/Dropbox/.private/notes/sub/deep.md')).toBe(false);
    // ...and the policy still applies to segments inside it.
    expect(dotted('/Users/someone/Dropbox/.private/notes/.git/HEAD')).toBe(true);

    // Same story for a root that happens to live under a `node_modules`.
    const vendored = createWatchIgnoreMatcher('/srv/node_modules/demo-thoughtbase');
    expect(vendored('/srv/node_modules/demo-thoughtbase/note.md')).toBe(false);
  });

  it('tolerates a root given with a trailing slash or a redundant segment', () => {
    for (const spelling of [`${root}/`, `${root}/./`, `/Users/someone/x/../thoughts`]) {
      const m = createWatchIgnoreMatcher(spelling);
      expect(m(`${root}/note.md`)).toBe(false);
      expect(m(`${root}/node_modules/a.md`)).toBe(true);
    }
  });

  it('watches, rather than drops, a path outside the root', () => {
    // Defensive branch. chokidar presents symlinked subtrees under the watch
    // root, so this shouldn't arise — but "ignore" is the failure mode that
    // loses events silently, so the fallback deliberately isn't it.
    expect(ignored('/somewhere/else/note.md')).toBe(false);
  });
});

/**
 * Why the old list was dead, asserted against the real chokidar rather than
 * quoted from its source. `ignoreInitial: false` makes the initial scan emit
 * an `add` per file, so the set of adds IS the set of things the ignore list
 * failed to suppress.
 */
describe('chokidar 5 string patterns are not globs (#2224)', () => {
  async function scan(root: string, ignored: Matcher | Matcher[]): Promise<string[]> {
    const seen: string[] = [];
    const w = watch(root, { ignored, persistent: true, ignoreInitial: false });
    w.on('add', (p) => seen.push(path.relative(root, p).split(path.sep).join('/')));
    await new Promise<void>((r) => w.once('ready', () => r()));
    await new Promise((r) => setTimeout(r, 150));
    await w.close();
    return seen.sort();
  }

  it('leaves node_modules fully watched when handed the old glob list', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-ignore-probe-'));
    try {
      await fsp.mkdir(path.join(root, 'node_modules', 'left-pad'), { recursive: true });
      await fsp.mkdir(path.join(root, '.minerva'), { recursive: true });
      await fsp.writeFile(path.join(root, 'note.md'), 'x');
      await fsp.writeFile(path.join(root, 'node_modules', 'left-pad', 'readme.md'), 'x');
      await fsp.writeFile(path.join(root, '.minerva', 'graph.ttl'), 'x');

      const OLD = [/(^|[/\\])\./, '**/node_modules/**', '**/.minerva/**'];
      const withOldList = await scan(root, OLD);
      // The defect, reproduced: the glob entry suppressed nothing.
      expect(withOldList).toContain('node_modules/left-pad/readme.md');
      // And the proof that BOTH string entries were inert — dropping them
      // changes nothing, so only the dot-regex was ever doing any work.
      expect(await scan(root, [/(^|[/\\])\./])).toEqual(withOldList);

      // The replacement suppresses it.
      expect(await scan(root, createWatchIgnoreMatcher(root))).toEqual(['note.md']);
    } finally {
      await fsp.rm(root, { recursive: true, force: true });
    }
  });

  it('suppresses EVERY event under a dot-segment ancestor when handed the old regex', async () => {
    const outer = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-ignore-probe-'));
    try {
      const root = path.join(outer, '.private', 'notes');
      await fsp.mkdir(root, { recursive: true });
      await fsp.writeFile(path.join(root, 'note.md'), 'x');

      // Nothing at all — the whole thoughtbase was invisible.
      expect(await scan(root, [/(^|[/\\])\./])).toEqual([]);
      // Control: the file is genuinely there and chokidar genuinely sees it.
      expect(await scan(root, [])).toEqual(['note.md']);
      // The replacement keeps it visible.
      expect(await scan(root, createWatchIgnoreMatcher(root))).toEqual(['note.md']);
    } finally {
      await fsp.rm(outer, { recursive: true, force: true });
    }
  });
});
