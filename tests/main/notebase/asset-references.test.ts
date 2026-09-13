/**
 * findOrphanedInlineAssets (#1799) — the reference-detector behind the
 * "Unreferenced images" inspection. Real files on a real temp dir (no
 * mocking of fs): every case here is really about which DIRECTORIES/text the
 * scan does or doesn't look at, which a mock would just assert back at us.
 */
import { describe, it, expect } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { useTempDir } from '../../helpers/temp-project';
import { findOrphanedInlineAssets } from '../../../src/main/notebase/asset-references';

const ASSET_DIR = '.minerva/assets/inline';

const project = useTempDir('minerva-asset-refs-');

async function writeFile(root: string, relativePath: string, content: string): Promise<void> {
  const abs = path.join(root, relativePath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content, 'utf-8');
}

async function writeAsset(root: string, filename: string, bytes = 'fake-image-bytes'): Promise<string> {
  const relativePath = `${ASSET_DIR}/${filename}`;
  await writeFile(root, relativePath, bytes);
  return relativePath;
}

describe('findOrphanedInlineAssets (#1799)', () => {
  it('returns nothing when the asset dir does not exist', async () => {
    expect(await findOrphanedInlineAssets(project.root)).toEqual([]);
  });

  it('returns nothing when the asset dir is empty', async () => {
    await fsp.mkdir(path.join(project.root, ASSET_DIR), { recursive: true });
    expect(await findOrphanedInlineAssets(project.root)).toEqual([]);
  });

  it('flags an asset no note references', async () => {
    const relativePath = await writeAsset(project.root, 'abc123-orphan.png');
    await writeFile(project.root, 'notes/a.md', 'Nothing to see here.');

    const orphans = await findOrphanedInlineAssets(project.root);
    expect(orphans.map((o) => o.relativePath)).toEqual([relativePath]);
    expect(orphans[0]!.sizeBytes).toBeGreaterThan(0);
  });

  it('does not flag an asset referenced by a markdown image in a note', async () => {
    const relativePath = await writeAsset(project.root, 'abc123-screenshot.png');
    await writeFile(project.root, 'notes/a.md', `![a screenshot](${relativePath})`);

    expect(await findOrphanedInlineAssets(project.root)).toEqual([]);
  });

  it('does not flag an asset referenced via raw HTML <img>', async () => {
    const relativePath = await writeAsset(project.root, 'abc123-raw.png');
    await writeFile(project.root, 'notes/a.md', `<img src="${relativePath}">`);

    expect(await findOrphanedInlineAssets(project.root)).toEqual([]);
  });

  it('does not flag an asset referenced from a stylesheet (publish: css: target, or site.css)', async () => {
    const relativePath = await writeAsset(project.root, 'abc123-bg.png');
    await writeFile(project.root, 'styles/theme.css', `body { background: url(../${relativePath}); }`);

    expect(await findOrphanedInlineAssets(project.root)).toEqual([]);
  });

  it('does not flag an asset only reachable through retained note history', async () => {
    // A .snap file is exactly what a history revision is on disk (store.ts).
    // The live note no longer references the image; only its history does.
    const relativePath = await writeAsset(project.root, 'abc123-history.png');
    await writeFile(project.root, 'notes/a.md', 'The image was removed since.');
    await writeFile(project.root, `.minerva/history/notes/a.md/1000.snap`, `![old](${relativePath})`);

    expect(await findOrphanedInlineAssets(project.root)).toEqual([]);
  });

  it('flags an asset whose only reference was in a revision that has aged out (#2167 compaction)', async () => {
    // The compacted revision's .snap is gone (exactly what #2167 does to an
    // aged-out `initial` revision) — only its index.json metadata survives,
    // which never contains the asset's content, just its timestamp/origin.
    const relativePath = await writeAsset(project.root, 'abc123-compacted.png');
    await writeFile(project.root, 'notes/a.md', 'No image here anymore.');
    await writeFile(
      project.root,
      '.minerva/history/notes/a.md/index.json',
      JSON.stringify([{ ts: 1000, origin: 'edit', initial: true }]),
    );

    const orphans = await findOrphanedInlineAssets(project.root);
    expect(orphans.map((o) => o.relativePath)).toEqual([relativePath]);
  });

  it('does not scan .minerva/assets itself (a binary sibling asset never "references" another)', async () => {
    const relativePath = await writeAsset(project.root, 'abc123-lonely.png');
    // A second asset whose bytes happen to be readable text containing the
    // first asset's filename — this must NOT count as a reference.
    await writeAsset(project.root, 'def456-other.png', `not really referencing ${path.basename(relativePath)}, just bytes`);

    const orphans = await findOrphanedInlineAssets(project.root);
    expect(orphans.map((o) => o.relativePath).sort()).toEqual(
      [relativePath, `${ASSET_DIR}/def456-other.png`].sort(),
    );
  });

  it('does not treat a copy in the publish cache as a live reference', async () => {
    const relativePath = await writeAsset(project.root, 'abc123-cached.png');
    // Simulate a static-site export having copied the (still-live-at-export-
    // time) asset into the output — this is a derived artifact, not a source
    // of truth about whether the ORIGINAL asset is still referenced.
    await writeFile(project.root, '.minerva/publish-cache/site/abc123-cached.png', 'copied bytes');
    await writeFile(project.root, 'notes/a.md', 'No image reference anymore.');

    const orphans = await findOrphanedInlineAssets(project.root);
    expect(orphans.map((o) => o.relativePath)).toEqual([relativePath]);
  });

  it('handles several assets in one pass, some referenced and some not', async () => {
    const live = await writeAsset(project.root, 'abc123-live.png');
    const dead = await writeAsset(project.root, 'def456-dead.png');
    await writeFile(project.root, 'notes/a.md', `![](${live})`);

    const orphans = await findOrphanedInlineAssets(project.root);
    expect(orphans.map((o) => o.relativePath)).toEqual([dead]);
  });
});
