/**
 * Writing a user object type ("Save Note as Object Type") — the serializer
 * round-trips through parse.ts, and saveType writes a file the loader reads back.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { serializeTypeFile, saveType } from '../../../src/main/types/write';
import { parseType } from '../../../src/main/types/parse';
import { loadTypeCatalog } from '../../../src/main/types/loader';
import type { PropertyDef } from '../../../src/shared/objects/type-def';

const PROPS: PropertyDef[] = [
  { name: 'author', type: 'link-to-type', label: 'Author', targetType: 'person' },
  { name: 'rating', type: 'number', label: 'Rating' },
  { name: 'status', type: 'enum', label: 'Status', options: ['reading', 'read'] },
];

describe('serializeTypeFile (#save-as-type)', () => {
  it('round-trips through parseType — id, label, and every property', () => {
    const content = serializeTypeFile('book', { label: 'Book', properties: PROPS });
    const r = parseType(content, 'user', '/x/book.md');
    expect(r.errors).toEqual([]);
    expect(r.type?.id).toBe('book');
    expect(r.type?.label).toBe('Book');
    const byName = new Map((r.type?.properties ?? []).map((p) => [p.name, p]));
    expect(byName.get('author')).toMatchObject({ type: 'link-to-type', targetType: 'person' });
    expect(byName.get('rating')).toMatchObject({ type: 'number' });
    expect(byName.get('status')).toMatchObject({ type: 'enum', options: ['reading', 'read'] });
  });
});

describe('saveType (#save-as-type)', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-save-type-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  it('writes .minerva/types/<id>.md and the loader picks it up', async () => {
    const { id, filePath } = await saveType(root, { label: 'Reading Note', properties: PROPS });
    expect(id).toBe('reading-note'); // slugified
    expect(filePath).toBe('.minerva/types/reading-note.md');
    expect(fs.existsSync(path.join(root, filePath))).toBe(true);

    const catalog = await loadTypeCatalog(root);
    const t = catalog.types.find((x) => x.id === 'reading-note');
    expect(t).toBeTruthy();
    expect(t!.label).toBe('Reading Note');
    expect(t!.properties.map((p) => p.name)).toEqual(['author', 'rating', 'status']);
    expect(t!.source).toBe('user');
  });

  it('rejects an empty name', async () => {
    await expect(saveType(root, { label: '   ', properties: [] })).rejects.toThrow(/empty/i);
  });
});
