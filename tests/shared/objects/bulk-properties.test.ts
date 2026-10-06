/**
 * Type-aware bulk property editing (#2431): the field model (shared schema,
 * mixed-type intersection, "mixed" values) and the touched-fields-only writer.
 */
import { describe, it, expect } from 'vitest';
import {
  applyBulkEdits,
  buildBulkFieldModel,
  scalarEditFor,
  type BulkNoteInput,
} from '../../../src/shared/objects/bulk-properties';
import type { PropertyDef, TypeInfo } from '../../../src/shared/objects/type-def';

function type(id: string, properties: PropertyDef[]): TypeInfo {
  return { id, label: id[0]!.toUpperCase() + id.slice(1), classLocalName: id, properties, source: 'user' };
}
const task = type('task', [
  { name: 'due', type: 'date', label: 'Due' },
  { name: 'done', type: 'boolean', label: 'Done' },
  { name: 'owner', type: 'link-to-type', targetType: 'person' },
  { name: 'effort', type: 'number' },
]);
const bug = type('bug', [
  { name: 'due', type: 'date' },
  { name: 'done', type: 'text' }, // same name, different type: not shared
  { name: 'severity', type: 'enum', options: ['low', 'high'] },
]);
const defsFor = (t: TypeInfo) => t.properties;
const note = (path: string, t: TypeInfo | null, fm: string): BulkNoteInput =>
  ({ path, type: t, content: `---\n${fm}\n---\n# ${path}\n` });

describe('buildBulkFieldModel', () => {
  it('shows a shared type\'s schema, then title / aliases / tags', () => {
    const m = buildBulkFieldModel([
      note('a.md', task, 'type: task\ndue: 2026-01-01\ndone: false'),
      note('b.md', task, 'type: task\ndue: 2026-01-01\ndone: true'),
    ], defsFor);
    expect(m.sharedType?.id).toBe('task');
    expect(m.fields.map((f) => f.name)).toEqual(['due', 'done', 'owner', 'effort', 'title', 'aliases', 'tags']);
    const due = m.fields.find((f) => f.name === 'due')!;
    expect(due).toMatchObject({ kind: 'scalar', value: '2026-01-01', mixed: false });
    const done = m.fields.find((f) => f.name === 'done')!;
    expect(done).toMatchObject({ mixed: true, value: '' });
    expect(m.fields.find((f) => f.name === 'owner')!.kind).toBe('list');
  });

  it('a value set on some notes but not others is mixed; unset everywhere is not', () => {
    const m = buildBulkFieldModel([
      note('a.md', task, 'type: task\neffort: 3'),
      note('b.md', task, 'type: task'),
    ], defsFor);
    expect(m.fields.find((f) => f.name === 'effort')!.mixed).toBe(true);
    expect(m.fields.find((f) => f.name === 'due')).toMatchObject({ mixed: false, value: '' });
  });

  it('mixed types show only the properties both declare with the same type', () => {
    const m = buildBulkFieldModel([
      note('a.md', task, 'type: task'),
      note('b.md', bug, 'type: bug'),
    ], defsFor);
    expect(m.sharedType).toBeNull();
    expect(m.typeLabels).toEqual(['Task', 'Bug']);
    expect(m.fields.filter((f) => f.section === 'schema').map((f) => f.name)).toEqual(['due']);
    expect(m.fields.filter((f) => f.section === 'common').map((f) => f.name)).toEqual(['title', 'aliases', 'tags']);
  });

  it('an untyped note leaves only the common fields', () => {
    const m = buildBulkFieldModel([note('a.md', task, 'type: task'), note('b.md', null, 'x: 1')], defsFor);
    expect(m.hasUntyped).toBe(true);
    expect(m.fields.map((f) => f.name)).toEqual(['title', 'aliases', 'tags']);
  });

  it('counts list values across the selection, and lists other keys for removal', () => {
    const m = buildBulkFieldModel([
      note('a.md', task, 'type: task\ntags: [x, y]\nstatus: open'),
      note('b.md', task, 'type: task\ntags:\n  - x\nstatus: done\nlegacy: 1'),
    ], defsFor);
    expect(m.fields.find((f) => f.name === 'tags')!.items).toEqual([{ value: 'x', count: 2 }, { value: 'y', count: 1 }]);
    expect(m.otherKeys).toEqual([{ value: 'legacy', count: 1 }, { value: 'status', count: 2 }]);
  });

  it('reports a note whose frontmatter does not parse', () => {
    const m = buildBulkFieldModel([note('a.md', task, 'type: task\n  bad: [unclosed')], defsFor);
    expect(m.unparseable).toEqual(['a.md']);
  });
});

describe('scalarEditFor', () => {
  it('types the value by the declared property', () => {
    expect(scalarEditFor({ name: 'n', type: 'number' }, '42')).toEqual({ op: 'set', key: 'n', value: 42 });
    expect(scalarEditFor({ name: 'n', type: 'number' }, 'soon')).toBeNull();
    expect(scalarEditFor({ name: 'b', type: 'boolean' }, 'true')).toEqual({ op: 'set', key: 'b', value: true });
    expect(scalarEditFor({ name: 'b', type: 'boolean' }, 'false')).toEqual({ op: 'set', key: 'b', value: false });
    expect(scalarEditFor({ name: 'd', type: 'date' }, '2026-12-01')).toEqual({ op: 'set', key: 'd', value: '2026-12-01' });
    expect(scalarEditFor({ name: 't', type: 'text' }, ' hi ')).toEqual({ op: 'set', key: 't', value: ' hi ' });
    expect(scalarEditFor({ name: 't', type: 'text' }, '  ')).toEqual({ op: 'clear', key: 't' });
  });
});

describe('applyBulkEdits', () => {
  const original = [
    '---',
    'type: task',
    '# a comment that must survive',
    'priority:   high   # spacing a re-serialise would normalise',
    'due: 2025-01-01',
    'done: "false"',
    'tags: [alpha, Beta]',
    '---',
    'Body text.',
    '',
  ].join('\n');

  it('writes a date and a checkbox as typed YAML and leaves every other line byte-identical', () => {
    const r = applyBulkEdits(original, [
      { op: 'set', key: 'due', value: '2026-12-01' },
      { op: 'set', key: 'done', value: true },
    ])!;
    expect(r.changed).toBe(true);
    const before = original.split('\n');
    const after = r.content.split('\n');
    expect(after).toHaveLength(before.length);
    const differing = before.map((l, i) => (l === after[i] ? null : [l, after[i]])).filter(Boolean);
    expect(differing).toEqual([
      ['due: 2025-01-01', 'due: 2026-12-01'],
      ['done: "false"', 'done: true'],
    ]);
  });

  it('a trailing comment on an edited value survives', () => {
    const r = applyBulkEdits('---\neffort: 2 # estimate\nx:   y\n---\n', [{ op: 'set', key: 'effort', value: 5 }])!;
    expect(r.content).toBe('---\neffort: 5 # estimate\nx:   y\n---\n');
  });

  it('a new key is appended after the existing ones', () => {
    const r = applyBulkEdits('---\na:   1\n# trailing comment\n---\nBody\n', [{ op: 'set', key: 'done', value: false }])!;
    expect(r.content).toBe('---\na:   1\n# trailing comment\ndone: false\n---\nBody\n');
  });

  it('a multi-line value is replaced whole, and its neighbours are untouched', () => {
    const src = '---\ntags:\n  - a\n  - b\nnext:  1\n---\n';
    const r = applyBulkEdits(src, [{ op: 'list', key: 'tags', add: ['c'], remove: ['a'], style: 'tags' }])!;
    expect(r.content).toBe('---\ntags:\n  - b\n  - c\nnext:  1\n---\n');
  });

  it('a note that already holds the value is returned byte-identical', () => {
    const fm = '---\ntype: task\npriority:   high   # odd spacing\ndue: 2026-12-01\ndone: true\n---\nBody\n';
    const r = applyBulkEdits(fm, [
      { op: 'set', key: 'due', value: '2026-12-01' },
      { op: 'set', key: 'done', value: true },
      { op: 'clear', key: 'missing' },
    ])!;
    expect(r).toEqual({ content: fm, changed: false });
  });

  it('an empty edit set never rewrites', () => {
    expect(applyBulkEdits(original, [])).toEqual({ content: original, changed: false });
  });

  it('creates the frontmatter block when a note has none', () => {
    const r = applyBulkEdits('# Plain\n', [{ op: 'set', key: 'done', value: false }])!;
    expect(r.content).toBe('---\ndone: false\n---\n# Plain\n');
  });

  it('clear removes exactly the key\'s lines', () => {
    const r = applyBulkEdits(original, [{ op: 'clear', key: 'due' }])!;
    expect(r.content).toBe(original.replace('due: 2025-01-01\n', ''));
  });

  it('adds and removes tags case-insensitively, keeping the list style', () => {
    const r = applyBulkEdits(original, [{ op: 'list', key: 'tags', add: ['Gamma', 'ALPHA'], remove: ['beta'], style: 'tags' }])!;
    expect(r.content).toMatch(/tags: \[ ?alpha, gamma ?\]/);
  });

  it('removing the last tag drops the key', () => {
    const r = applyBulkEdits('---\ntags:\n  - one\n---\n', [{ op: 'list', key: 'tags', add: [], remove: ['ONE'], style: 'tags' }])!;
    expect(r.content).toBe('');
  });

  it('a link field stays a scalar with one link and becomes a list with two', () => {
    const one = applyBulkEdits('---\nowner: "[[Ada]]"\n---\n', [{ op: 'list', key: 'owner', add: ['Grace'], remove: ['ada'], style: 'link' }])!;
    expect(one.content).toBe('---\nowner: "[[Grace]]"\n---\n');
    const two = applyBulkEdits(one.content, [{ op: 'list', key: 'owner', add: ['[[Ada|A. L.]]'], remove: [], style: 'link' }])!;
    expect(two.content).toBe('---\nowner:\n  - "[[Grace]]"\n  - "[[Ada|A. L.]]"\n---\n');
  });

  it('adding a value already present is a no-op', () => {
    const r = applyBulkEdits(original, [{ op: 'list', key: 'tags', add: ['beta'], remove: [], style: 'tags' }])!;
    expect(r.changed).toBe(false);
  });

  it('aliases add to a scalar alias, making a list', () => {
    const r = applyBulkEdits('---\naliases: Ada\n---\n', [{ op: 'list', key: 'aliases', add: ['Countess'], remove: [], style: 'plain' }])!;
    expect(r.content).toBe('---\naliases:\n  - Ada\n  - Countess\n---\n');
  });

  it('refuses a note whose frontmatter does not parse', () => {
    expect(applyBulkEdits('---\na: [unclosed\n---\n', [{ op: 'set', key: 'x', value: 1 }])).toBeNull();
  });
});
