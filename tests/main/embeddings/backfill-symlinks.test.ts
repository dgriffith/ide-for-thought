/**
 * The embeddings backfill never reads through a symlink that leaves the
 * thoughtbase (#2398, follow-up to #2357). Its note walker and its loaders
 * read with plain `fs.readFile`, and the vectors feed the LLM's semantic
 * search. An in-root symlinked note IS embedded (the walker's `isFile()`
 * check used to drop every link, in-root ones included).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runBackfill, abortBackfill } from '../../../src/main/embeddings/backfill';
import * as store from '../../../src/main/embeddings/vector-store';
import type { ChunkEmbedder } from '../../../src/main/embeddings/vector-store';
import { MODEL } from '../../../src/main/embeddings/embedder';
import { projectContext } from '../../../src/main/project-context-types';

/** Every text embeds to the same unit vector; this suite checks WHAT gets
 *  embedded, not ranking. Also records every text handed to the model. */
function recordingEmbedder(seen: string[]): ChunkEmbedder {
  return {
    dim: MODEL.dim,
    async embed(texts: string[]): Promise<Float32Array[]> {
      seen.push(...texts);
      return texts.map(() => {
        const v = new Float32Array(MODEL.dim);
        v[0] = 1;
        return v;
      });
    },
  };
}

const SECRET = 'TOPSECRET-2398';

let root: string;
let outside: string;
let seen: string[];
const ctx = () => projectContext(root);

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-backfill-symlink-'));
  outside = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-backfill-outside-'));
  fs.writeFileSync(path.join(outside, 'secret.md'), `# Secret\n\n${SECRET} body\n`);
  seen = [];
  await store.init(ctx(), { dbPath: path.join(root, '.minerva', 'vectors.duckdb'), embedder: recordingEmbedder(seen) });
});
afterEach(async () => {
  abortBackfill(root);
  await store.dispose(ctx());
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

describe('runBackfill and symlinks (#2398)', () => {
  it('does not embed a symlinked note whose target is outside the thoughtbase', async () => {
    fs.writeFileSync(path.join(root, 'ordinary.md'), '# Ordinary\n\nordinary body\n');
    fs.mkdirSync(path.join(root, 'sub'));
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'leak.md'));
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'sub', 'leak.md'));

    await runBackfill(ctx());

    expect([...(await store.embeddedNotePaths(ctx()))].sort()).toEqual(['ordinary.md']);
    expect(seen.some((t) => t.includes(SECRET))).toBe(false);
  });

  it('embeds a symlinked note whose target stays inside the thoughtbase', async () => {
    fs.writeFileSync(path.join(root, 'real.md'), '# Real\n\ninside body\n');
    fs.symlinkSync('real.md', path.join(root, 'alias.md'));

    await runBackfill(ctx());

    expect([...(await store.embeddedNotePaths(ctx()))].sort()).toEqual(['alias.md', 'real.md']);
  });

  it('does not embed a source body.md that links outside the thoughtbase', async () => {
    const dir = path.join(root, '.minerva', 'sources', 'leaked');
    fs.mkdirSync(dir, { recursive: true });
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(dir, 'body.md'));

    await runBackfill(ctx());

    expect(seen.some((t) => t.includes(SECRET))).toBe(false);
    expect([...(await store.embeddedRefs(ctx(), 'source'))]).toEqual([]);
  });

  it('does not embed a note path handed in by the walker if it escapes (loader guard)', async () => {
    fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'leak.md'));

    // The injectable walker bypasses the dirent check, so this pins the
    // second layer: the loader itself refuses the escaping path.
    const res = await runBackfill(ctx(), { listNotes: async () => ['leak.md'] });

    expect(res.embedded).toBe(0);
    expect(seen.some((t) => t.includes(SECRET))).toBe(false);
  });
});
