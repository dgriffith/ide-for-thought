/**
 * Manual source collections (#470 phase 1).
 *
 * The whole module is a thin layer on top of a single JSON file, so
 * these tests exercise the operations against a real temp project
 * rather than mocking the fs.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  loadCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  addSourceToCollection,
  removeSourceFromCollection,
  scrubSourceFromCollections,
  rewriteCollectionMemberships,
  createSmartCollection,
  renameSmartCollection,
  deleteSmartCollection,
  updateSmartCollectionPredicate,
  resolveSmartMembers,
} from '../../../src/main/sources/collections';

function mkTemp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-collections-'));
}

describe('source collections (#470)', () => {
  let root: string;

  beforeEach(() => {
    root = mkTemp();
  });
  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('returns an empty file when collections.json is absent', async () => {
    const data = await loadCollections(root);
    expect(data).toEqual({ collections: [], smartCollections: [] });
  });

  it('creates a collection with a slug id derived from its name', async () => {
    const c = await createCollection(root, { name: 'Reading list' });
    expect(c.id).toBe('reading-list');
    expect(c.name).toBe('Reading list');
    expect(c.parent).toBeNull();
    expect(c.members).toEqual([]);
    const onDisk = JSON.parse(fs.readFileSync(path.join(root, '.minerva', 'collections.json'), 'utf-8'));
    expect(onDisk.collections).toHaveLength(1);
  });

  it('assigns -2 / -3 suffixes on slug collision', async () => {
    const a = await createCollection(root, { name: 'Reading' });
    const b = await createCollection(root, { name: 'Reading' });
    const c = await createCollection(root, { name: 'Reading' });
    expect([a.id, b.id, c.id]).toEqual(['reading', 'reading-2', 'reading-3']);
  });

  it('refuses an empty name', async () => {
    await expect(createCollection(root, { name: '   ' })).rejects.toThrow(/empty/);
  });

  it('refuses an unknown parent', async () => {
    await expect(createCollection(root, { name: 'Child', parent: 'nope' })).rejects.toThrow(/parent/i);
  });

  it('renames a collection', async () => {
    const c = await createCollection(root, { name: 'Reading list' });
    await renameCollection(root, c.id, 'Lit review');
    const data = await loadCollections(root);
    expect(data.collections[0].name).toBe('Lit review');
    // Id stays the same — renaming is cosmetic.
    expect(data.collections[0].id).toBe('reading-list');
  });

  it('deletes a collection and re-parents its children to root', async () => {
    const parent = await createCollection(root, { name: 'Research' });
    const child = await createCollection(root, { name: 'Phase 1', parent: parent.id });
    await deleteCollection(root, parent.id);
    const data = await loadCollections(root);
    expect(data.collections.map((c) => c.id)).toEqual([child.id]);
    expect(data.collections[0].parent).toBeNull();
  });

  it('add/remove of a source updates membership', async () => {
    const c = await createCollection(root, { name: 'Reading' });
    await addSourceToCollection(root, c.id, 'smith-2023');
    await addSourceToCollection(root, c.id, 'jones-2024');
    let data = await loadCollections(root);
    expect(data.collections[0].members).toEqual(['smith-2023', 'jones-2024']);
    await removeSourceFromCollection(root, c.id, 'smith-2023');
    data = await loadCollections(root);
    expect(data.collections[0].members).toEqual(['jones-2024']);
  });

  it('addSourceToCollection is idempotent', async () => {
    const c = await createCollection(root, { name: 'Reading' });
    await addSourceToCollection(root, c.id, 'smith-2023');
    await addSourceToCollection(root, c.id, 'smith-2023');
    const data = await loadCollections(root);
    expect(data.collections[0].members).toEqual(['smith-2023']);
  });

  it('a source can live in multiple collections', async () => {
    const a = await createCollection(root, { name: 'Reading' });
    const b = await createCollection(root, { name: 'Citing in chapter 3' });
    await addSourceToCollection(root, a.id, 'smith-2023');
    await addSourceToCollection(root, b.id, 'smith-2023');
    const data = await loadCollections(root);
    expect(data.collections.find((c) => c.id === a.id)!.members).toEqual(['smith-2023']);
    expect(data.collections.find((c) => c.id === b.id)!.members).toEqual(['smith-2023']);
  });

  it('scrubSourceFromCollections drops a removed source from every collection', async () => {
    const a = await createCollection(root, { name: 'A' });
    const b = await createCollection(root, { name: 'B' });
    await addSourceToCollection(root, a.id, 'smith-2023');
    await addSourceToCollection(root, b.id, 'smith-2023');
    await addSourceToCollection(root, b.id, 'jones-2024');

    await scrubSourceFromCollections(root, 'smith-2023');

    const data = await loadCollections(root);
    expect(data.collections.find((c) => c.id === a.id)!.members).toEqual([]);
    expect(data.collections.find((c) => c.id === b.id)!.members).toEqual(['jones-2024']);
  });

  it('rewriteCollectionMemberships moves src → dest in every collection', async () => {
    const a = await createCollection(root, { name: 'A' });
    const b = await createCollection(root, { name: 'B' });
    await addSourceToCollection(root, a.id, 'arxiv-1234');
    await addSourceToCollection(root, b.id, 'doi-10-1');
    await addSourceToCollection(root, b.id, 'arxiv-1234');

    await rewriteCollectionMemberships(root, 'arxiv-1234', 'doi-10-1');

    const data = await loadCollections(root);
    expect(data.collections.find((c) => c.id === a.id)!.members).toEqual(['doi-10-1']);
    // b already had dest; src is removed; no duplicate appended.
    expect(data.collections.find((c) => c.id === b.id)!.members).toEqual(['doi-10-1']);
  });

  it('rewriteCollectionMemberships is a no-op when src === dest', async () => {
    const c = await createCollection(root, { name: 'C' });
    await addSourceToCollection(root, c.id, 'smith-2023');
    await rewriteCollectionMemberships(root, 'smith-2023', 'smith-2023');
    const data = await loadCollections(root);
    expect(data.collections[0].members).toEqual(['smith-2023']);
  });

  it('tolerates a malformed collections.json by reading an empty file', async () => {
    await fsp.mkdir(path.join(root, '.minerva'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva', 'collections.json'), 'not json', 'utf-8');
    await expect(loadCollections(root)).rejects.toThrow(); // strict — better to surface than silently wipe
  });

  // ─── Smart collections (#470 phase 2) ──────────────────────────────────

  it('creates a smart collection with a tag-allOf predicate', async () => {
    const sc = await createSmartCollection(root, {
      name: 'Reading',
      predicate: { kind: 'tags', allOf: ['ml', 'review'] },
    });
    expect(sc.id).toBe('reading');
    expect(sc.name).toBe('Reading');
    expect(sc.predicate).toEqual({ kind: 'tags', allOf: ['ml', 'review'] });
    const data = await loadCollections(root);
    expect(data.smartCollections).toHaveLength(1);
  });

  it('smart and manual ids share a namespace', async () => {
    await createCollection(root, { name: 'Reading' });
    const smart = await createSmartCollection(root, {
      name: 'Reading',
      predicate: { kind: 'tags', allOf: ['x'] },
    });
    expect(smart.id).toBe('reading-2');
  });

  it('refuses empty predicate-tag entries', async () => {
    await expect(createSmartCollection(root, {
      name: 'Bad',
      predicate: { kind: 'tags', allOf: ['ok', '   '] },
    })).rejects.toThrow(/non-empty/);
  });

  it('rename / delete / update predicate operate on the smart entry', async () => {
    const sc = await createSmartCollection(root, {
      name: 'Reading',
      predicate: { kind: 'tags', allOf: ['ml'] },
    });
    await renameSmartCollection(root, sc.id, 'Lit review');
    await updateSmartCollectionPredicate(root, sc.id, { kind: 'tags', allOf: ['ml', 'review'] });
    let data = await loadCollections(root);
    expect(data.smartCollections[0]).toMatchObject({
      name: 'Lit review',
      predicate: { kind: 'tags', allOf: ['ml', 'review'] },
    });
    await deleteSmartCollection(root, sc.id);
    data = await loadCollections(root);
    expect(data.smartCollections).toEqual([]);
  });

  it('drops smart entries with an unknown predicate kind on load', async () => {
    await fsp.mkdir(path.join(root, '.minerva'), { recursive: true });
    await fsp.writeFile(
      path.join(root, '.minerva', 'collections.json'),
      JSON.stringify({
        collections: [],
        smartCollections: [
          { id: 'good', name: 'Good', predicate: { kind: 'tags', allOf: ['ml'] } },
          { id: 'bad', name: 'Bad', predicate: { kind: 'aliens-from-the-future' } },
          { id: 'no-predicate', name: 'No predicate' },
        ],
      }),
      'utf-8',
    );
    const data = await loadCollections(root);
    expect(data.smartCollections.map((s) => s.id)).toEqual(['good']);
  });

  it('coerces partial records on load (defensive)', async () => {
    await fsp.mkdir(path.join(root, '.minerva'), { recursive: true });
    await fsp.writeFile(
      path.join(root, '.minerva', 'collections.json'),
      JSON.stringify({
        collections: [
          { id: 'reading', name: 'Reading' /* members missing */ },
          { name: 'no-id' }, // dropped
          { id: 'with-string-parent', name: 'x', parent: 'reading', members: 'wrong-type' },
        ],
      }),
      'utf-8',
    );
    const data = await loadCollections(root);
    const ids = data.collections.map((c) => c.id);
    expect(ids).toContain('reading');
    expect(ids).toContain('with-string-parent');
    expect(ids).not.toContain('');
    // members defaulted to [] when the field was the wrong type
    expect(data.collections.find((c) => c.id === 'with-string-parent')!.members).toEqual([]);
  });
});

describe('resolveSmartMembers (#470 phase 2)', () => {
  /** Stub graph: tag → source-id list. */
  const sourcesByTag = (db: Record<string, string[]>) => (tag: string) =>
    (db[tag] ?? []).map((sourceId) => ({ sourceId }));

  it('returns the intersection of sources across every tag in allOf', () => {
    const lookup = sourcesByTag({
      ml: ['a', 'b', 'c'],
      review: ['b', 'c', 'd'],
    });
    const ids = resolveSmartMembers({ kind: 'tags', allOf: ['ml', 'review'] }, lookup);
    expect([...ids].sort()).toEqual(['b', 'c']);
  });

  it('returns an empty set when allOf is empty', () => {
    const ids = resolveSmartMembers({ kind: 'tags', allOf: [] }, sourcesByTag({}));
    expect(ids.size).toBe(0);
  });

  it('returns an empty set when any tag has no matching sources', () => {
    const lookup = sourcesByTag({ ml: ['a'], review: [] });
    const ids = resolveSmartMembers({ kind: 'tags', allOf: ['ml', 'review'] }, lookup);
    expect(ids.size).toBe(0);
  });

  it('single-tag predicate returns the full set for that tag', () => {
    const lookup = sourcesByTag({ ml: ['a', 'b'] });
    const ids = resolveSmartMembers({ kind: 'tags', allOf: ['ml'] }, lookup);
    expect([...ids].sort()).toEqual(['a', 'b']);
  });

  it('three-tag intersection narrows progressively', () => {
    const lookup = sourcesByTag({
      a: ['x', 'y', 'z'],
      b: ['x', 'z'],
      c: ['z', 'w'],
    });
    const ids = resolveSmartMembers({ kind: 'tags', allOf: ['a', 'b', 'c'] }, lookup);
    expect([...ids]).toEqual(['z']);
  });
});
