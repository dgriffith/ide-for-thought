/**
 * The folder "View Objects ▸" submenu's types (#2532): direct types plus
 * their ancestors, counted the way each type's view would count.
 */
import { describe, it, expect } from 'vitest';
import { objectTypesInFolder } from '../../../src/renderer/lib/objects/folder-object-types';
import type { TypeInfo } from '../../../src/shared/objects/type-def';

const t = (id: string, label: string, parent?: string): TypeInfo =>
  ({ id, label, classLocalName: label, source: 'user', properties: [], ...(parent ? { parent } : {}) });
const TYPES = [t('place', 'Place'), t('restaurant', 'Restaurant', 'place'), t('museum', 'Museum', 'place'), t('book', 'Book')];
const byPath: Record<string, string> = {
  'trip/prague/Lokal.md': 'restaurant',
  'trip/prague/Kampa.md': 'museum',
  'trip/prague/sub/Mucha.md': 'museum',
  'trip/budapest/Gerbeaud.md': 'restaurant',
  'reading/Dune.md': 'book',
  'trip/prague/plain.md': '',
};
const lookup = (p: string) => TYPES.find((x) => x.id === byPath[p]) ?? null;
const summary = (folder: string) => objectTypesInFolder(folder, Object.keys(byPath), lookup, TYPES)
  .map((f) => `${f.type.id}:${f.count}${f.direct ? '' : '^'}`);

describe('objectTypesInFolder', () => {
  it('lists direct types (recursively) then inherited ones, with view-style counts', () => {
    expect(summary('trip/prague')).toEqual(['museum:2', 'restaurant:1', 'place:3^']);
  });

  it('a parent counts every subtype\'s notes, across subfolders', () => {
    expect(summary('trip')).toEqual(['museum:2', 'restaurant:2', 'place:4^']);
  });

  it('a folder with no objects lists nothing; untyped notes are ignored', () => {
    expect(summary('elsewhere')).toEqual([]);
  });

  it('a type a note declares directly is direct even when it is also some note\'s parent', () => {
    const local = { ...byPath, 'trip/prague/Square.md': 'place' };
    const look = (p: string) => TYPES.find((x) => x.id === local[p]) ?? null;
    expect(objectTypesInFolder('trip/prague', Object.keys(local), look, TYPES).find((f) => f.type.id === 'place'))
      .toMatchObject({ count: 4, direct: true });
  });

  it('survives a cyclic parent chain', () => {
    const cyc = [t('a', 'A', 'b'), t('b', 'B', 'a')];
    expect(objectTypesInFolder('', ['x.md'], () => cyc[0]!, cyc).map((f) => f.type.id)).toEqual(['a', 'b']);
  });
});
