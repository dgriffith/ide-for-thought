/**
 * A locally customized stock type has to behave like any other type end to end:
 * its added property indexes, and its instances stay on the SAME ontology class
 * as before the customization (`classLocalName` derives from the id, which the
 * override keeps). If that ever drifted, customizing Book would silently orphan
 * every existing Book note.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexAllNotes, queryGraph, getNoteTypedProperties, reloadTypeCatalog } from '../../../src/main/graph/index';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

const project = useGraphProject('minerva-custstock-');
let root: string;
let ctx: ProjectContext;

function write(rel: string, content: string): void {
  const fp = path.join(root, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf-8');
}

beforeEach(() => {
  root = project.root;
  ctx = project.ctx;
});

describe('customized stock type', () => {
  it('indexes a note under types:Book and reads back the added property', async () => {
    // Book customized with an extra `shelf` field.
    write('.minerva/types/book.md', [
      '---', 'label: Book', 'id: book',
      'properties:',
      '  - name: author', '    type: text',
      '  - name: shelf', '    type: text',
      '---', '',
    ].join('\n'));
    write('Dune.md', `---\ntitle: Dune\ntype: book\nauthor: Frank Herbert\nshelf: A3\n---\n`);
    await reloadTypeCatalog(ctx);
    await indexAllNotes(ctx);

    // Same class as an uncustomized Book would have used.
    const { results } = await queryGraph(
      ctx,
      `SELECT ?path WHERE { ?n a types:Book ; minerva:relativePath ?path }`,
    );
    expect((results as Array<{ path: string }>).map((r) => r.path)).toEqual(['Dune.md']);

    const read = await getNoteTypedProperties(ctx, 'Dune.md');
    expect(read.type?.id).toBe('book');
    const byName = Object.fromEntries(read.properties.map((p) => [p.name, p.value]));
    expect(byName.shelf).toBe('A3');       // the customization
    expect(byName.author).toBe('Frank Herbert'); // carried-over stock field
  });

  it('leaves existing instances on the same class when the label is customized', async () => {
    write('Dune.md', `---\ntitle: Dune\ntype: book\n---\n`);
    await indexAllNotes(ctx);

    // Now customize only the label.
    write('.minerva/types/book.md', `---\nlabel: Tome\nid: book\nproperties: []\n---\n`);
    await reloadTypeCatalog(ctx);
    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `SELECT ?path WHERE { ?n a types:Book ; minerva:relativePath ?path }`);
    expect((results as Array<{ path: string }>).map((r) => r.path)).toEqual(['Dune.md']);
    expect((await getNoteTypedProperties(ctx, 'Dune.md')).type?.label).toBe('Tome');
  });
});
