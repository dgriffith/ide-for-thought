/**
 * `list_object_types` (#2069) — read-only, no proposal round-trip. Returns
 * full property detail (type/options/targetType), unlike the raw SPARQL
 * `infer-types.md` used to run, which only saw materialized triples
 * (id/label/property names).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { listObjectTypes } from '../../../../src/main/llm/tools/list-object-types';
import { saveType } from '../../../../src/main/types/write';
import { useGraphProject } from '../../../helpers/temp-project';

const project = useGraphProject('minerva-list-object-types-');
let root: string;

beforeEach(() => {
  root = project.root;
});

describe('list_object_types tool (#2069)', () => {
  it('lists stock types with full property detail', async () => {
    const res = await listObjectTypes.run({ rootPath: root }, {}, {});
    expect(res.isError).toBe(false);
    // `book` is a stock type — confirm at least one property's full shape
    // (type, not just its name) comes through.
    expect(res.content).toContain('book —');
    expect(res.content).toMatch(/author \(text\)/);
  });

  it('includes a user type with enum options and a link-to-type target', async () => {
    await saveType(root, {
      label: 'Recipe',
      properties: [
        { name: 'difficulty', type: 'enum', options: ['easy', 'hard'] },
        { name: 'author', type: 'link-to-type', targetType: 'person' },
      ],
    });
    const res = await listObjectTypes.run({ rootPath: root }, {}, {});
    expect(res.content).toContain('recipe —');
    expect(res.content).toMatch(/difficulty \(enum\).*options: \[easy, hard\]/);
    expect(res.content).toMatch(/author \(link-to-type\).*targetType: person/);
  });

  it('reports parent and shows the default body itself (#2492)', async () => {
    await saveType(root, { label: 'Cookbook', parent: 'book', template: '# {{title}}\n\nBy {{author}}', properties: [] });
    const res = await listObjectTypes.run({ rootPath: root }, {}, {});
    const block = res.content.split('\n\n').find((b) => b.startsWith('cookbook —'));
    expect(block).toContain('parent: book');
    expect(res.content).toContain('  default body:\n    # {{title}}');
    expect(res.content).toContain('    By {{author}}');
  });

  it('shows an inherited body and says where it came from (#2494)', async () => {
    await saveType(root, { label: 'Venue', template: '## Visit\n{{address}}', properties: [{ name: 'address', type: 'text' }] });
    await saveType(root, { label: 'Shop', parent: 'venue', properties: [{ name: 'category', type: 'text' }] });
    const res = await listObjectTypes.run({ rootPath: root }, {}, {});
    const shop = res.content.slice(res.content.indexOf('shop —'));
    expect(shop).toContain('default body (inherited from venue):\n    ## Visit\n    {{address}}');
  });

  it('truncates a long body in the listing, and type_id returns it in full', async () => {
    const long = Array.from({ length: 60 }, (_, i) => `Line ${i} of a long default body.`).join('\n');
    await saveType(root, { label: 'Dossier', template: long, properties: [] });
    const listing = await listObjectTypes.run({ rootPath: root }, {}, {});
    expect(listing.content).toContain('…(truncated — call list_object_types with type_id: "dossier" for the full body)');
    expect(listing.content).not.toContain('Line 59 of');
    const one = await listObjectTypes.run({ rootPath: root }, { type_id: 'dossier' }, {});
    expect(one.isError).toBe(false);
    expect(one.content).toContain('Line 59 of a long default body.');
    expect(one.content).not.toContain('truncated');
    expect((await listObjectTypes.run({ rootPath: root }, { type_id: 'nope' }, {})).isError).toBe(true);
  });
});
