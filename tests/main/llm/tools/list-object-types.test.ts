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

  it('reports parent and template presence', async () => {
    await saveType(root, { label: 'Cookbook', parent: 'book', template: '# {{title}}', properties: [] });
    const res = await listObjectTypes.run({ rootPath: root }, {}, {});
    const block = res.content.split('\n\n').find((b) => b.startsWith('cookbook —'));
    expect(block).toContain('parent: book');
    expect(block).toContain('template: yes');
  });
});
