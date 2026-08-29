/**
 * The bulk `relativePath → typeId` projection behind the type icons on note
 * rows (sidebar tree, tabs, quick-open, backlinks). One read for the whole
 * thoughtbase, so a list doesn't fan out to `getNoteTypedProperties` per row.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexAllNotes, getNoteTypeMap, reloadTypeCatalog } from '../../../src/main/graph/index';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

let root: string;
let ctx: ProjectContext;

function writeNote(rel: string, content: string): void {
  const fp = path.join(root, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf-8');
}

const project = useGraphProject('minerva-notetypemap-');
beforeEach(() => {
  root = project.root;
  ctx = project.ctx;
});

describe('note→type map', () => {
  it('maps each typed note to its type id, and omits untyped notes', async () => {
    writeNote('Dune.md', `---\ntitle: Dune\ntype: book\n---\n`);
    writeNote('people/Ada.md', `---\ntitle: Ada\ntype: person\n---\n`);
    writeNote('Scratch.md', `---\ntitle: Scratch\n---\njust a note\n`);
    await indexAllNotes(ctx);

    const map = await getNoteTypeMap(ctx);
    expect(map['Dune.md']).toBe('book');
    // Keyed by project-relative path, not basename — nested notes included.
    expect(map['people/Ada.md']).toBe('person');
    expect(map['Scratch.md']).toBeUndefined();
  });

  it('is empty for a thoughtbase with no typed notes', async () => {
    writeNote('Scratch.md', `---\ntitle: Scratch\n---\n`);
    await indexAllNotes(ctx);

    expect(await getNoteTypeMap(ctx)).toEqual({});
  });

  it('an unknown `type:` yields no entry, so the row falls back to its file icon', async () => {
    writeNote('Odd.md', `---\ntitle: Odd\ntype: not-a-real-type\n---\n`);
    await indexAllNotes(ctx);

    expect((await getNoteTypeMap(ctx))['Odd.md']).toBeUndefined();
  });

  it('reports a subtype instance as its OWN type, not its parent', async () => {
    // A row should show the most specific icon the note declares.
    fs.mkdirSync(path.join(root, '.minerva/types'), { recursive: true });
    fs.writeFileSync(
      path.join(root, '.minerva/types/novel.md'),
      `---\nlabel: Novel\nparent: book\nicon: 📕\n---\n`,
      'utf-8',
    );
    writeNote('Dune.md', `---\ntitle: Dune\ntype: novel\n---\n`);
    await reloadTypeCatalog(ctx); // the catalog was loaded before this type existed
    await indexAllNotes(ctx);

    expect((await getNoteTypeMap(ctx))['Dune.md']).toBe('novel');
  });

  it('drops a note from the map once its type is removed', async () => {
    writeNote('Dune.md', `---\ntitle: Dune\ntype: book\n---\n`);
    await indexAllNotes(ctx);
    expect((await getNoteTypeMap(ctx))['Dune.md']).toBe('book');

    writeNote('Dune.md', `---\ntitle: Dune\n---\n`);
    await indexAllNotes(ctx);
    expect((await getNoteTypeMap(ctx))['Dune.md']).toBeUndefined();
  });
});
