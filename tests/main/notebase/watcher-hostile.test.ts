/**
 * The notes watcher over an adversarial thoughtbase (#2372).
 *
 * Real chokidar against the hostile tree from `tests/helpers/hostile-
 * thoughtbase.ts`: escaping file + directory links, a dangling link, a
 * symlink loop and a directory linked to its own parent, a folder and a note
 * the process may not read, bad-byte notes, 255-byte names and a note at
 * PATH_MAX. The watcher must come up (its `ready` gates project open), keep
 * reporting ordinary edits, and never surface a path from outside the root.
 *
 * Negative assertions are sequenced behind a positive control event written
 * AFTER the change that must not be reported, as in `watcher-symlinks.test.ts`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { silenceLogTags } from '../../helpers/quiet-logs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { startWatching, stopWatching, type WatcherTarget } from '../../../src/main/notebase/watcher';
import {
  useHostileThoughtbase,
  ALL_HOSTILE_FEATURES,
  CONTROL_NOTES,
} from '../../helpers/hostile-thoughtbase';

function recorder(events: string[]): WatcherTarget {
  return {
    isAlive: () => true,
    fileCreated: (p) => events.push(`created ${p}`),
    fileChanged: (p) => events.push(`changed ${p}`),
    fileDeleted: (p) => events.push(`deleted ${p}`),
    renamed: (pairs) => pairs.forEach((x) => events.push(`renamed ${x.old} ${x.new}`)),
  };
}

async function until(predicate: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out after ${timeoutMs}ms`);
}

const noop = { onFileCreated: () => undefined, onFileChanged: () => undefined, onFileDeleted: () => undefined };

// Expected: these tests drive failure paths the code logs (#2390).
silenceLogTags('watcher');

describe('startWatching on a hostile thoughtbase (#2372)', () => {
  const tb = useHostileThoughtbase(ALL_HOSTILE_FEATURES, 'minerva-watch-hostile-');
  let events: string[];
  let id = 23720;

  beforeEach(() => {
    events = [];
    id++;
  });

  // Registered after the fixture's hooks, so under vitest's 'stack' order it
  // runs first: the watcher is closed before its tree is deleted.
  afterEach(async () => {
    stopWatching(id);
    await new Promise((r) => setTimeout(r, 50));
  });

  it('becomes ready instead of hanging or throwing', async () => {
    await expect(startWatching(tb.manifest.root, recorder(events), id, noop)).resolves.toBeUndefined();
  });

  it('reports ordinary edits to a well-formed note', async () => {
    await startWatching(tb.manifest.root, recorder(events), id, noop);

    await fsp.appendFile(path.join(tb.manifest.root, CONTROL_NOTES.alpha), 'more\n');

    await until(() => events.includes(`changed ${CONTROL_NOTES.alpha}`));
  });

  it('reports a note created beside the hostile entries', async () => {
    await startWatching(tb.manifest.root, recorder(events), id, noop);
    const rel = path.join('links', 'fresh.md');

    await fsp.writeFile(path.join(tb.manifest.root, rel), '# fresh\n');

    await until(() => events.includes(`created ${rel}`));
  });

  it('reports an edit to the invalid-UTF-8 note and the PATH_MAX-deep note', async () => {
    await startWatching(tb.manifest.root, recorder(events), id, noop);
    const targets = [
      tb.manifest.paths['invalid-utf8']![0],
      ...(tb.manifest.paths['long-path'] ?? []),
    ];

    for (const rel of targets) await fsp.appendFile(path.join(tb.manifest.root, rel), Buffer.from([0xff, 0x0a]));

    await until(() => targets.every((rel) => events.includes(`changed ${rel}`)));
  });

  it('never reports a path through a link that leaves the root', async () => {
    await startWatching(tb.manifest.root, recorder(events), id, noop);

    await fsp.writeFile(path.join(tb.manifest.outside, 'secret-dir', 'inner.md'), 'changed\n');
    await fsp.writeFile(path.join(tb.manifest.outside, 'secret-dir', 'new.md'), 'new\n');
    await new Promise((r) => setTimeout(r, 300));
    await fsp.writeFile(path.join(tb.manifest.root, 'after.md'), '# after\n');
    await until(() => events.includes('created after.md'));
    await new Promise((r) => setTimeout(r, 300));

    // The link itself may be reported (it is an in-root entry); nothing
    // BEHIND it may be.
    expect(events.filter((e) => e.includes('escape-dir/') || e.includes('self-dir/'))).toEqual([]);
  });

  it('keeps watching the folder that holds a permission-denied subfolder', async () => {
    const locked = tb.manifest.paths['unreadable-dir']?.[0];
    if (!locked) return; // running as root: nothing was locked
    await startWatching(tb.manifest.root, recorder(events), id, noop);
    const rel = path.join(path.dirname(locked), 'beside-locked.md');

    await fsp.writeFile(path.join(tb.manifest.root, rel), '# beside\n');

    await until(() => events.includes(`created ${rel}`));
  });
});
