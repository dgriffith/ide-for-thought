/**
 * Moving a Kanban card (#2603) — the pure half: the single-field write, what
 * *Move to ▸* lists, and reading the field back for undo.
 *
 * The write's contract is "one field, every other byte untouched", so these
 * assert on whole strings: comments, key order, odd spacing, flow lists and
 * the body all come back byte-identical.
 */
import { describe, it, expect } from 'vitest';
import {
  groupValueOf, moveTargets, setGroupValue, sharedColumnValue, targetOfColumn,
} from '../../../src/shared/objects/kanban-move';
import type { KanbanColumn } from '../../../src/shared/objects/kanban';
import type { PropertyDef } from '../../../src/shared/objects/type-def';

const NOTE = [
  '---',
  '# a project note',
  'type: project',
  'title:   Garden Shed',
  'status: active # moved by hand once',
  'tags: [build, outdoors]',
  '',
  '# owner below',
  'owner: Ann',
  '---',
  '# Garden Shed',
  '',
  'status: active is in the body too, and stays.',
  '',
].join('\n');

describe('setGroupValue (#2603)', () => {
  it('changes only the grouping line; every other byte is identical', () => {
    const r = setGroupValue(NOTE, 'status', 'done')!;
    expect(r.changed).toBe(true);
    expect(r.content).toBe(NOTE.replace('status: active # moved by hand once', 'status: done # moved by hand once'));
  });

  it('removes the key for No value, leaving the rest as it was', () => {
    const r = setGroupValue(NOTE, 'status', null)!;
    expect(r.changed).toBe(true);
    expect(r.content).toBe(NOTE.replace('status: active # moved by hand once\n', ''));
  });

  it('adds the key at the end of the block when the note has none', () => {
    const src = '---\ntype: project\n# keep me\nowner: Bo\n---\nBody\n';
    const r = setGroupValue(src, 'status', 'paused')!;
    expect(r.content).toBe('---\ntype: project\n# keep me\nowner: Bo\nstatus: paused\n---\nBody\n');
  });

  it('creates a block for a note with no frontmatter', () => {
    const r = setGroupValue('# Loose\n\nText.\n', 'status', 'active')!;
    expect(r.changed).toBe(true);
    expect(r.content).toMatch(/^---\nstatus: active\n---\n/);
    expect(r.content.endsWith('# Loose\n\nText.\n')).toBe(true);
  });

  it('a card dropped where it already is changes nothing', () => {
    expect(setGroupValue(NOTE, 'status', 'active')).toEqual({ content: NOTE, changed: false });
    const none = '---\ntype: project\n---\nBody\n';
    expect(setGroupValue(none, 'status', null)).toEqual({ content: none, changed: false });
  });

  it('quotes a value that would otherwise read back as another type', () => {
    const r = setGroupValue('---\nstatus: active\n---\n', 'status', 'true')!;
    expect(groupValueOf(r.content, 'status')).toBe('true');
    expect(r.content).not.toContain('status: true\n');
  });

  it('refuses frontmatter that does not parse (null), rather than overwrite it', () => {
    expect(setGroupValue('---\nstatus: [unclosed\n---\n', 'status', 'done')).toBeNull();
  });
});

describe('groupValueOf', () => {
  it('reads the value, null when absent or blank, undefined when the YAML is broken', () => {
    expect(groupValueOf(NOTE, 'status')).toBe('active');
    expect(groupValueOf(NOTE, 'priority')).toBeNull();
    expect(groupValueOf('---\nstatus: ""\n---\n', 'status')).toBeNull();
    expect(groupValueOf('No frontmatter', 'status')).toBeNull();
    expect(groupValueOf('---\nstatus: [x\n---\n', 'status')).toBeUndefined();
  });
});

const STATUS: PropertyDef = { name: 'status', type: 'enum', options: ['active', 'paused', 'done'] };
const col = (value: string | null, kind: KanbanColumn['kind'], paths: string[]): KanbanColumn => ({
  value, label: value ?? 'No value', kind,
  instances: paths.map((path) => ({ path, title: path, values: {}, cover: null })),
});

describe('moveTargets', () => {
  it('lists every option, then the off-list columns on the board, then No value', () => {
    // A values filter hid "paused" from the board; Move to still offers it.
    const board = [col('active', 'option', ['a.md']), col('done', 'option', []), col('someday', 'off-list', ['s.md'])];
    expect(moveTargets(STATUS, board).map((t) => [t.label, t.value, t.kind])).toEqual([
      ['active', 'active', 'option'],
      ['paused', 'paused', 'option'],
      ['done', 'done', 'option'],
      ['someday', 'someday', 'off-list'],
      ['No value', null, 'no-value'],
    ]);
  });
});

describe('targetOfColumn / sharedColumnValue', () => {
  it('maps a column’s data attributes to a target; "" is No value', () => {
    expect(targetOfColumn('done', 'option')).toEqual({ value: 'done', label: 'done', kind: 'option' });
    expect(targetOfColumn('', 'no-value')).toEqual({ value: null, label: 'No value', kind: 'no-value' });
    expect(targetOfColumn('x', 'off-list').kind).toBe('off-list');
  });

  it('names the column a selection shares, or undefined when mixed', () => {
    const board = [col('active', 'option', ['a.md', 'b.md']), col(null, 'no-value', ['n.md'])];
    expect(sharedColumnValue(board, ['a.md', 'b.md'])).toBe('active');
    expect(sharedColumnValue(board, ['n.md'])).toBeNull();
    expect(sharedColumnValue(board, ['a.md', 'n.md'])).toBeUndefined();
    expect(sharedColumnValue(board, ['gone.md'])).toBeUndefined();
  });
});
