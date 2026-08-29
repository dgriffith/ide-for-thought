/**
 * Type-instances projection behind the multi-view (#1070): the list of a type's
 * instances with their declared-property values as columns, plus the designated
 * cover property for the gallery. A pure read over the #1062/#1063 index.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexAllNotes, getTypeInstances } from '../../../src/main/graph/index';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

const project = useGraphProject('minerva-type-instances-');
let root: string;
let ctx: ProjectContext;

function writeNote(rel: string, content: string): void {
  const fp = path.join(root, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf-8');
}
function writeType(id: string, frontmatter: string): void {
  const dir = path.join(root, '.minerva', 'types');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.md`), `---\n${frontmatter}\n---\n`, 'utf-8');
}

beforeEach(() => {
  root = project.root;
  ctx = project.ctx;
});

describe('type-instances projection (#1070)', () => {
  it('lists every instance of a type with its declared-property values', async () => {
    // `book` is a stock type declaring author, published, rating, status, isbn.
    writeNote('Dune.md', `---\ntitle: Dune\ntype: book\nauthor: Frank Herbert\nrating: 5\n---\n`);
    writeNote('Neuro.md', `---\ntitle: Neuromancer\ntype: book\nauthor: William Gibson\nrating: 4\n---\n`);
    await indexAllNotes(ctx);

    const res = await getTypeInstances(ctx, 'book');
    expect(res.type?.id).toBe('book');
    // Ordered by LCASE(title): Dune before Neuromancer.
    expect(res.instances.map((i) => i.title)).toEqual(['Dune', 'Neuromancer']);
    expect(res.instances.map((i) => i.path)).toEqual(['Dune.md', 'Neuro.md']);

    const dune = res.instances[0]!;
    expect(dune.values.author).toBe('Frank Herbert');
    expect(dune.values.rating).toBe('5');
    expect(dune.values.published).toBeNull(); // declared but empty → column present, value null
    // No cover declared on the stock book type.
    expect(dune.cover).toBeNull();
  });

  it('returns an empty projection for an unknown type', async () => {
    const res = await getTypeInstances(ctx, 'not-a-type');
    expect(res.type).toBeNull();
    expect(res.instances).toEqual([]);
  });

  it('projects the designated cover property for the gallery', async () => {
    writeType('gadget', 'label: Gadget\nid: gadget\ncover: image\nproperties:\n  - name: image\n    type: text\n  - name: maker\n    type: text');
    writeNote('Widget.md', `---\ntitle: Widget\ntype: gadget\nimage: https://example.com/widget.png\nmaker: Acme\n---\n`);
    writeNote('Gizmo.md', `---\ntitle: Gizmo\ntype: gadget\nmaker: Globex\n---\n`);
    await indexAllNotes(ctx);

    const res = await getTypeInstances(ctx, 'gadget');
    expect(res.instances).toHaveLength(2);
    const byTitle = new Map(res.instances.map((i) => [i.title, i]));
    expect(byTitle.get('Widget')!.cover).toBe('https://example.com/widget.png');
    expect(byTitle.get('Widget')!.values.maker).toBe('Acme');
    expect(byTitle.get('Gizmo')!.cover).toBeNull(); // no cover value → gallery falls back
  });
});
