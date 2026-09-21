/**
 * The note path + alias index, after its split out of `GraphState`
 * (#2234 PR 2/3).
 *
 * The split's real prize is deduplication, not relocation. The alias conflict
 * policy — alphabetical-first-writer wins, canonical names beat aliases — was
 * implemented twice: in `rebuildAliasMap` (lowercased map) and in
 * `getAliasEntries` (original-cased entries), the latter carrying a comment
 * that it "matches rebuildAliasMap's second pass". Two copies of one rule, in
 * two files, with nothing asserting they agreed.
 *
 * So the cases below lean on exactly that: every conflict scenario is asserted
 * against BOTH representations, because the point of one `resolveAliases` is
 * that they can no longer diverge. If someone re-forks the policy, the paired
 * assertions fail.
 *
 * `aliases.test.ts` covers the round-trip through the real indexer; this is the
 * index itself.
 */
import { describe, it, expect } from 'vitest';
import {
  registerNotePath,
  setNoteAliases,
  forgetNotePath,
  rebuildAliasMap,
  clearNoteIndex,
  aliasMapObject,
  aliasEntries,
  aliasesForNote,
  indexedNotePaths,
} from '../../../src/main/graph/note-index';
import { projectContext } from '../../../src/main/project-context-types';

let n = 0;
const freshCtx = () => projectContext(`/tmp/minerva-note-index-${n++}`);

/** Seed a note: register its path (every note counts for canonical names) and
 *  its aliases, then settle the derived map. */
function seed(ctx: ReturnType<typeof freshCtx>, entries: Array<[string, string[]]>) {
  for (const [path, aliases] of entries) {
    registerNotePath(ctx, path);
    setNoteAliases(ctx, path, aliases);
  }
  rebuildAliasMap(ctx);
}

describe('alias conflict policy — asserted on BOTH representations (#2234)', () => {
  it('alphabetically-first path wins a contested alias', () => {
    const ctx = freshCtx();
    seed(ctx, [['zebra.md', ['shared']], ['alpha.md', ['shared']]]);

    expect(aliasMapObject(ctx)).toEqual({ shared: 'alpha.md' });
    expect(aliasEntries(ctx)).toEqual([{ alias: 'shared', relativePath: 'alpha.md' }]);
  });

  it('a real note\'s stem beats another note\'s alias of the same name', () => {
    // The reason `paths` is a superset of `aliasesPerNote.keys()`: a file at
    // JFK.md must win even though it declares no aliases itself.
    const ctx = freshCtx();
    seed(ctx, [['JFK.md', []], ['president.md', ['JFK']]]);

    expect(aliasMapObject(ctx)).toEqual({});
    expect(aliasEntries(ctx)).toEqual([]);
  });

  it('a real note\'s BASENAME beats an alias, even when the note is nested', () => {
    const ctx = freshCtx();
    seed(ctx, [['people/JFK.md', []], ['president.md', ['JFK']]]);

    expect(aliasMapObject(ctx)).toEqual({});
    expect(aliasEntries(ctx)).toEqual([]);
  });

  it('matches case-insensitively when deciding a collision', () => {
    const ctx = freshCtx();
    seed(ctx, [['jfk.md', []], ['president.md', ['JFK']]]);
    expect(aliasEntries(ctx)).toEqual([]);
  });

  it('keeps the ORIGINAL casing in entries and the LOWERCASE in the map', () => {
    // #492: the autocomplete inserts `[[JFK]]`, resolution matches `jfk`.
    const ctx = freshCtx();
    seed(ctx, [['president.md', ['JFK']]]);

    expect(aliasMapObject(ctx)).toEqual({ jfk: 'president.md' });
    expect(aliasEntries(ctx)).toEqual([{ alias: 'JFK', relativePath: 'president.md' }]);
  });

  it('survives a note claiming several aliases, and several notes claiming several', () => {
    const ctx = freshCtx();
    seed(ctx, [
      ['b.md', ['Second', 'Shared']],
      ['a.md', ['First', 'Shared']],
    ]);

    expect(aliasMapObject(ctx)).toEqual({
      first: 'a.md', shared: 'a.md', second: 'b.md',
    });
    expect(aliasEntries(ctx)).toEqual([
      { alias: 'First', relativePath: 'a.md' },
      { alias: 'Shared', relativePath: 'a.md' },
      { alias: 'Second', relativePath: 'b.md' },
    ]);
  });
});

describe('note index — maintenance', () => {
  it('registerNotePath is idempotent', () => {
    const ctx = freshCtx();
    registerNotePath(ctx, 'a.md');
    registerNotePath(ctx, 'a.md');
    expect(indexedNotePaths(ctx)).toEqual(['a.md']);
  });

  it('setNoteAliases with an empty list drops the entry rather than storing []', () => {
    const ctx = freshCtx();
    seed(ctx, [['a.md', ['Alias']]]);
    expect(aliasesForNote(ctx, 'a.md')).toEqual(['Alias']);

    setNoteAliases(ctx, 'a.md', []);
    rebuildAliasMap(ctx);
    expect(aliasesForNote(ctx, 'a.md')).toEqual([]);
    expect(aliasMapObject(ctx)).toEqual({});
  });

  it('forgetNotePath reports what actually changed', () => {
    // `removeNote` needs both flags: a note with NO aliases still affects the
    // map through the canonical-name rule, so dropping it has to trigger a
    // rebuild even though `hadAliases` is false.
    const ctx = freshCtx();
    seed(ctx, [['withAliases.md', ['x']], ['bare.md', []]]);

    expect(forgetNotePath(ctx, 'withAliases.md')).toEqual({ hadAliases: true, wasTracked: true });
    expect(forgetNotePath(ctx, 'bare.md')).toEqual({ hadAliases: false, wasTracked: true });
    expect(forgetNotePath(ctx, 'never-seen.md')).toEqual({ hadAliases: false, wasTracked: false });
  });

  it('deleting the note that blocked an alias frees it', () => {
    // The canonical-name rule is not a one-way door: remove JFK.md and the
    // other note's "JFK" alias should start resolving.
    const ctx = freshCtx();
    seed(ctx, [['JFK.md', []], ['president.md', ['JFK']]]);
    expect(aliasMapObject(ctx)).toEqual({});

    forgetNotePath(ctx, 'JFK.md');
    rebuildAliasMap(ctx);
    expect(aliasMapObject(ctx)).toEqual({ jfk: 'president.md' });
  });

  it('clearNoteIndex drops paths, aliases and the derived map', () => {
    const ctx = freshCtx();
    seed(ctx, [['a.md', ['Alias']]]);
    clearNoteIndex(ctx);

    expect(indexedNotePaths(ctx)).toEqual([]);
    expect(aliasesForNote(ctx, 'a.md')).toEqual([]);
    expect(aliasMapObject(ctx)).toEqual({});
  });
});

describe('note index — empty and isolated', () => {
  it('reads answer emptily for a project that was never indexed', () => {
    const ctx = freshCtx();
    expect(aliasMapObject(ctx)).toEqual({});
    expect(aliasEntries(ctx)).toEqual([]);
    expect(aliasesForNote(ctx, 'anything.md')).toEqual([]);
    expect(indexedNotePaths(ctx)).toEqual([]);
    expect(() => clearNoteIndex(ctx)).not.toThrow();
  });

  it('keeps projects apart', () => {
    // Free when these maps hung off one project's GraphState; earned now.
    const a = freshCtx();
    const b = freshCtx();
    seed(a, [['note.md', ['FromA']]]);
    seed(b, [['note.md', ['FromB']]]);

    expect(aliasMapObject(a)).toEqual({ froma: 'note.md' });
    expect(aliasMapObject(b)).toEqual({ fromb: 'note.md' });
  });
});
