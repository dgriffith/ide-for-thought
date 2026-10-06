/**
 * The Kanban layout's model (#2601): which enum property a board groups by,
 * and how instances fall into columns — options in order, off-list values
 * next, No value last.
 */
import { describe, it, expect } from 'vitest';
import {
  boardColumns, canShowKanban, groupByForSpec, groupByForType, groupInstances, NO_VALUE_LABEL, parseGroupBy, resolveGroupBy,
} from '../../../src/shared/objects/kanban';
import { effectivePropertyDefs } from '../../../src/shared/objects/inheritance';
import type { PropertyDef, TypeInstanceRow } from '../../../src/shared/objects/type-def';

const row = (path: string, values: Record<string, string | null>): TypeInstanceRow => ({ path, title: path, values, cover: null });

const STATUS: PropertyDef = { name: 'status', type: 'enum', options: ['active', 'paused', 'done', 'abandoned'] };
const PRIORITY: PropertyDef = { name: 'priority', type: 'enum', options: ['low', 'high'] };
const OWNER: PropertyDef = { name: 'owner', type: 'text' };

/** Project-like parent with the enum; a subtype that declares only its own text property. */
const TYPES = [
  { id: 'project', properties: [OWNER, STATUS] },
  { id: 'client-project', parent: 'project', properties: [{ name: 'client', type: 'text' as const }] },
  { id: 'note', properties: [OWNER] },
];
const byId = new Map(TYPES.map((t) => [t.id, t] as const));

const summary = (cols: ReturnType<typeof groupInstances>) =>
  cols.map((c) => [c.label, c.kind, c.instances.map((i) => i.path)]);

describe('groupInstances (#2601)', () => {
  it('returns every option in declared order — empty ones too — then No value last', () => {
    const cols = groupInstances([
      row('a', { status: 'done' }),
      row('b', { status: 'active' }),
      row('c', { status: null }),
      row('d', { status: 'done' }),
    ], 'status', { enumOptions: STATUS.options! });
    expect(summary(cols)).toEqual([
      ['active', 'option', ['b']],
      ['paused', 'option', []],
      ['done', 'option', ['a', 'd']],
      ['abandoned', 'option', []],
      [NO_VALUE_LABEL, 'no-value', ['c']],
    ]);
    expect(cols.at(-1)!.value).toBeNull();
  });

  it('gives an off-list hand-edited value its own column after the options, in first-seen order', () => {
    const cols = groupInstances([
      row('a', { status: 'blocked' }),
      row('b', { status: 'active' }),
      row('c', { status: 'someday' }),
      row('d', { status: 'blocked' }),
    ], 'status', { enumOptions: ['active', 'done'] });
    expect(summary(cols)).toEqual([
      ['active', 'option', ['b']],
      ['done', 'option', []],
      ['blocked', 'off-list', ['a', 'd']],
      ['someday', 'off-list', ['c']],
      [NO_VALUE_LABEL, 'no-value', []],
    ]);
  });

  it('reads an empty string or a missing key as No value, and keeps the input order within a column', () => {
    const cols = groupInstances([
      row('z', { status: 'active' }),
      row('y', { status: '' }),
      row('x', {}),
      row('w', { status: 'active' }),
    ], 'status', { enumOptions: ['active'] });
    expect(summary(cols)).toEqual([
      ['active', 'option', ['z', 'w']],
      [NO_VALUE_LABEL, 'no-value', ['y', 'x']],
    ]);
  });

  it('a duplicated option is one column', () => {
    expect(groupInstances([], 'status', { enumOptions: ['a', 'b', 'a'] }).map((c) => c.label)).toEqual(['a', 'b', NO_VALUE_LABEL]);
  });

  it('groups by an inherited enum, as the subtype sees it', () => {
    const props = effectivePropertyDefs('client-project', byId);
    const by = resolveGroupBy(null, props)!;
    expect(by.name).toBe('status');
    const cols = groupInstances([row('a', { client: 'Acme', status: 'paused' })], by.name, { enumOptions: by.options ?? [] });
    expect(summary(cols)[1]).toEqual(['paused', 'option', ['a']]);
  });
});

describe('resolveGroupBy (#2601)', () => {
  const props = [OWNER, STATUS, PRIORITY];

  it('uses groupBy when it names an enum property', () => {
    expect(resolveGroupBy('priority', props)).toBe(PRIORITY);
  });

  it('defaults to the first enum property when absent, unknown, or not an enum', () => {
    expect(resolveGroupBy(null, props)).toBe(STATUS);
    expect(resolveGroupBy(undefined, props)).toBe(STATUS);
    expect(resolveGroupBy('gone', props)).toBe(STATUS);
    expect(resolveGroupBy('owner', props)).toBe(STATUS);
  });

  it('is null — no board — for a type with no enum property', () => {
    expect(resolveGroupBy(null, [OWNER])).toBeNull();
    expect(resolveGroupBy('owner', [OWNER])).toBeNull();
  });

  it('accepts an inherited enum by name', () => {
    expect(resolveGroupBy('status', effectivePropertyDefs('client-project', byId))?.name).toBe('status');
  });
});

describe('canShowKanban (#2601)', () => {
  it('only for a type with an enum property, own or inherited', () => {
    expect(canShowKanban(effectivePropertyDefs('project', byId))).toBe(true);
    expect(canShowKanban(effectivePropertyDefs('client-project', byId))).toBe(true);
    expect(canShowKanban(effectivePropertyDefs('note', byId))).toBe(false);
    expect(canShowKanban([])).toBe(false);
  });
});

describe('parsing and serialising groupBy (#2601)', () => {
  it('parseGroupBy keeps a non-empty string and drops anything else, never throwing', () => {
    expect(parseGroupBy('status')).toBe('status');
    for (const bad of [undefined, null, '', '  ', 3, ['status'], { name: 'status' }]) {
      expect(parseGroupBy(bad)).toBeNull();
    }
  });

  it('groupByForSpec keeps a valid enum choice, drops an invalid one, and keeps it when the schema is unknown', () => {
    const props = [OWNER, STATUS];
    expect(groupByForSpec('status', props)).toBe('status');
    expect(groupByForSpec('owner', props)).toBeNull();
    expect(groupByForSpec('gone', props)).toBeNull();
    expect(groupByForSpec(null, props)).toBeNull();
    expect(groupByForSpec('anything', null)).toBe('anything');
  });

  it('groupByForType checks against the effective properties from the catalog', () => {
    expect(groupByForType('status', 'client-project', TYPES)).toBe('status');
    expect(groupByForType('client', 'client-project', TYPES)).toBeNull();
    expect(groupByForType('status', 'unloaded', TYPES)).toBe('status');
  });
});

describe('boardColumns (#2602)', () => {
  const filed = [row('a', { status: 'active' }), row('b', { status: 'done' })];

  it('leaves out No value when every note has a value, and keeps empty options', () => {
    expect(summary(boardColumns(filed, STATUS))).toEqual([
      ['active', 'option', ['a']],
      ['paused', 'option', []],
      ['done', 'option', ['b']],
      ['abandoned', 'option', []],
    ]);
  });

  it('shows No value, last, when some note has no value', () => {
    expect(summary(boardColumns([...filed, row('c', { status: '' })], STATUS)).at(-1)).toEqual([NO_VALUE_LABEL, 'no-value', ['c']]);
  });

  it('a values filter on the grouping property keeps only its columns', () => {
    const cols = boardColumns(filed, STATUS, [{ property: 'status', values: ['done', 'active'] }]);
    expect(cols.map((c) => c.label)).toEqual(['active', 'done']); // declared order, not the filter's
  });

  it('two values filters on it intersect, as filters AND', () => {
    const cols = boardColumns(filed, STATUS, [
      { property: 'status', values: ['done', 'active'] },
      { property: 'status', values: ['done', 'paused'] },
    ]);
    expect(cols.map((c) => c.label)).toEqual(['done']);
  });

  it('a filter on another property, or a range filter, leaves the columns alone', () => {
    expect(boardColumns(filed, STATUS, [{ property: 'owner', values: ['Ann'] }])).toHaveLength(4);
    expect(boardColumns(filed, STATUS, [{ property: 'status', min: 'a', max: 'z' }])).toHaveLength(4);
  });

  it('an enum with no options still shows the values notes use', () => {
    expect(boardColumns(filed, { name: 'status', type: 'enum' }).map((c) => [c.label, c.kind])).toEqual([['active', 'off-list'], ['done', 'off-list']]);
  });
});
