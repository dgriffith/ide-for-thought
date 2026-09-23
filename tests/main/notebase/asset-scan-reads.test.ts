/**
 * What the unreferenced-image scan READS (#2208 C1c).
 *
 * `findOrphanedInlineAssets` rides along on every post-save sweep and every
 * five-minute tick, and its corpus is the whole project INCLUDING every
 * retained `.minerva/history/**\/*.snap`. Measured on 1,000 notes x 20
 * revisions — 21,005 files — the shipped version took 5.8-6.5 SECONDS per
 * call, more than all seventeen SPARQL queries in the same sweep combined.
 *
 * The decomposition put the cost in the file reads, not in the matching
 * (raising the asset count from 5 to 100 moved the total by ~3%), so the gate
 * is a count of reads — deterministic, and the thing actually being defended.
 *
 * Its necessary other half is `asset-references.test.ts`, which states what
 * the scan must FIND. A gate that says "reads nothing" is satisfied perfectly
 * by a scan that reports every image as an orphan, so several cases here
 * assert the findings alongside the count on purpose.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import nodeFs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { useTempDir } from '../../helpers/temp-project';
import { findOrphanedInlineAssets } from '../../../src/main/notebase/asset-references';

const ASSET_DIR = '.minerva/assets/inline';
const project = useTempDir('minerva-asset-scan-reads-');

async function writeFile(root: string, relativePath: string, content: string): Promise<void> {
  const abs = path.join(root, relativePath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content, 'utf-8');
}

async function writeAsset(root: string, filename: string): Promise<string> {
  const relativePath = `${ASSET_DIR}/${filename}`;
  await writeFile(root, relativePath, 'fake-image-bytes');
  return relativePath;
}

/**
 * Project-relative paths handed to `readFile` while `fn` runs.
 *
 * Spying on `fsp.readFile` rather than counting through a fixture because the
 * claim under test is "this function does not open that file", which is a
 * statement about the syscall.
 */
async function readsDuring(root: string, fn: () => Promise<unknown>): Promise<string[]> {
  const reads: string[] = [];
  // `node:fs`'s `promises` object IS `node:fs/promises` — one object, so
  // patching this property is what the module under test sees.
  const original = nodeFs.promises.readFile;
  const spy = vi.spyOn(nodeFs.promises, 'readFile').mockImplementation(
    ((...args: Parameters<typeof fsp.readFile>) => {
      const target = args[0];
      if (typeof target === 'string' && target.startsWith(root)) {
        reads.push(path.relative(root, target).split(path.sep).join('/'));
      }
      return original(...args);
    }),
  );
  try {
    await fn();
  } finally {
    spy.mockRestore();
  }
  return reads;
}

afterEach(() => { vi.restoreAllMocks(); });

describe('findOrphanedInlineAssets — reads (#2208 C1c)', () => {
  it('reads each corpus file exactly once per scan', async () => {
    await writeAsset(project.root, 'abc123-orphan.png');
    for (let i = 0; i < 5; i++) await writeFile(project.root, `notes/n${i}.md`, `note ${i}`);
    await writeFile(project.root, '.minerva/history/notes/n0.md/1000.snap', 'old n0');

    const reads = await readsDuring(project.root, () => findOrphanedInlineAssets(project.root));
    expect(reads.length).toBe(new Set(reads).size);
    expect(reads).toContain('notes/n0.md');
    expect(reads).toContain('.minerva/history/notes/n0.md/1000.snap');
  });

  it('re-reads nothing on a second scan when nothing changed', async () => {
    // The steady state: a `.snap` is immutable once written, so the thousands
    // of history files that dominate a real corpus must be read once per
    // session, not once per keystroke-pause.
    const orphan = await writeAsset(project.root, 'abc123-orphan.png');
    for (let i = 0; i < 20; i++) {
      await writeFile(project.root, `.minerva/history/notes/a.md/${1000 + i}.snap`, `revision ${i}`);
    }
    await writeFile(project.root, 'notes/a.md', 'nothing here');

    const first = await readsDuring(project.root, () => findOrphanedInlineAssets(project.root));
    expect(first.length).toBeGreaterThan(20);

    const second = await readsDuring(project.root, () => findOrphanedInlineAssets(project.root));
    expect(second).toEqual([]);

    // …and it still reports the same thing, which is the half a read-count
    // gate cannot see on its own.
    const orphans = await findOrphanedInlineAssets(project.root);
    expect(orphans.map((o) => o.relativePath)).toEqual([orphan]);
  });

  it('re-reads a file that changed, and changes its verdict with it', async () => {
    const asset = await writeAsset(project.root, 'abc123-pic.png');
    await writeFile(project.root, 'notes/a.md', 'no image yet');
    expect((await findOrphanedInlineAssets(project.root)).map((o) => o.relativePath)).toEqual([asset]);

    await writeFile(project.root, 'notes/a.md', `![now referenced](${asset})`);
    const reads = await readsDuring(project.root, () => findOrphanedInlineAssets(project.root));
    expect(reads).toContain('notes/a.md');
    expect(await findOrphanedInlineAssets(project.root)).toEqual([]);
  });

  it('notices a file that shrank back to a previously-seen length', async () => {
    // The memo's stamp is `size:mtimeNs`, and this is the case a size-only
    // stamp gets wrong in the dangerous direction: same byte count, different
    // content, an asset that goes from referenced to reported-as-orphaned.
    const asset = await writeAsset(project.root, 'abc123-eq.png');
    const withRef = `![](${asset})`;
    await writeFile(project.root, 'notes/a.md', withRef);
    expect(await findOrphanedInlineAssets(project.root)).toEqual([]);

    await writeFile(project.root, 'notes/a.md', 'x'.repeat(withRef.length));
    expect((await findOrphanedInlineAssets(project.root)).map((o) => o.relativePath)).toEqual([asset]);
  });

  it('never opens the vector database, the search index, or the remote-image cache', async () => {
    // Three additions to the skip set (#2208): `.minerva/vectors.duckdb` is a
    // multi-hundred-megabyte binary, `search-index.json` is a derived copy of
    // note text the scan already reads in its original form, and
    // `.minerva/cache/` holds fetched REMOTE images under content-hashed,
    // often extensionless names.
    const orphan = await writeAsset(project.root, 'abc123-skip.png');
    await writeFile(project.root, '.minerva/vectors.duckdb', 'binary-ish');
    await writeFile(project.root, '.minerva/vectors.duckdb.wal', 'binary-ish');
    await writeFile(project.root, '.minerva/search-index.json', '{"notes":[]}');
    await writeFile(project.root, '.minerva/cache/external-images/deadbeef', 'cached bytes');
    await writeFile(project.root, '.minerva/cache/youtube/abc.jpg', 'cached bytes');
    await writeFile(project.root, 'notes/a.md', 'a note');

    const reads = await readsDuring(project.root, () => findOrphanedInlineAssets(project.root));
    expect(reads.filter((r) => r.startsWith('.minerva/cache/'))).toEqual([]);
    expect(reads).not.toContain('.minerva/vectors.duckdb');
    expect(reads).not.toContain('.minerva/vectors.duckdb.wal');
    expect(reads).not.toContain('.minerva/search-index.json');
    expect(reads).toContain('notes/a.md');
    // And skipping them didn't cost the finding.
    expect((await findOrphanedInlineAssets(project.root)).map((o) => o.relativePath)).toEqual([orphan]);
  });

  it('reads nothing at all when the project has no inline assets', async () => {
    // The early exit, pinned: a thoughtbase that has never had an image pasted
    // into it must not pay for a corpus walk at all.
    for (let i = 0; i < 5; i++) await writeFile(project.root, `notes/n${i}.md`, `note ${i}`);
    const reads = await readsDuring(project.root, () => findOrphanedInlineAssets(project.root));
    expect(reads).toEqual([]);
  });
});

describe('findOrphanedInlineAssets — the tokeniser matches what the substring scan did (#2208)', () => {
  it('counts a percent-encoded reference, where the name is inside a larger token', async () => {
    // `content.includes(name)` and "some token contains name" agree because an
    // asset name holds no token separator — so an occurrence always lands
    // inside ONE token, even when that token has encoding debris glued to it.
    // Equality-only lookup would miss this and delete a live image.
    const asset = await writeAsset(project.root, 'abc123-encoded.png');
    const encoded = `..%2F${path.basename(asset)}`;
    await writeFile(project.root, 'notes/a.md', `<img src="${encoded}">`);
    expect(await findOrphanedInlineAssets(project.root)).toEqual([]);
  });

  it('falls back to the substring scan for a hand-placed name it cannot tokenise', async () => {
    // `uploadImage` can't produce a name with a space in it, but a user
    // dropping a file into `.minerva/assets/inline/` by hand can. Being wrong
    // here means reporting a LIVE image as an orphan, so the tokeniser checks
    // rather than assumes and hands off when the assumption fails.
    const spaced = await writeAsset(project.root, 'my photo.png');
    const orphan = await writeAsset(project.root, 'abc123-gone.png');
    await writeFile(project.root, 'notes/a.md', `![](${spaced})`);

    const orphans = await findOrphanedInlineAssets(project.root);
    expect(orphans.map((o) => o.relativePath)).toEqual([orphan]);
  });
});
