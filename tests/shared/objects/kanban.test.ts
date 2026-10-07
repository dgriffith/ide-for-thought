/**
 * The Kanban layout's model (#2601): which enum property a board groups by,
 * and how instances fall into columns — options in order, off-list values
 * next, No value last.
 */
import { describe, it, expect } from 'vitest';
import {
  boardColumns, canShowKanban, columnKey, groupByForSpec, groupByForType, groupInstances, moveColumn, NO_VALUE_KEY, NO_VALUE_LABEL,
  orderColumns, parseColumnOrder, parseGroupBy, parseShowEmptyColumns, resolveGroupBy,
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

describe('column order (#2614)', () => {
  const mixed = [
    row('a', { status: 'done' }),
    row('b', { status: 'active' }),
    row('c', { status: null }),
    row('d', { status: 'blocked' }), // off-list
  ];
  const labels = (cols: ReturnType<typeof groupInstances>) => cols.map((c) => c.label);
  const opts = (columnOrder?: string[]) => ({ enumOptions: STATUS.options!, columnOrder });

  it('empty or absent is the enum order', () => {
    const natural = ['active', 'paused', 'done', 'abandoned', 'blocked', NO_VALUE_LABEL];
    expect(labels(groupInstances(mixed, 'status', opts()))).toEqual(natural);
    expect(labels(groupInstances(mixed, 'status', opts([])))).toEqual(natural);
  });

  it('listed columns come first, in the listed order; the rest follow in enum order, then off-list, then No value', () => {
    expect(labels(groupInstances(mixed, 'status', opts(['done', 'paused'])))).toEqual(['done', 'paused', 'active', 'abandoned', 'blocked', NO_VALUE_LABEL]);
  });

  it('an option added since the order was set lands after the listed ones', () => {
    const grown = { enumOptions: ['triage', ...STATUS.options!], columnOrder: ['done', 'active', 'paused', 'abandoned'] };
    expect(labels(groupInstances(mixed, 'status', grown))).toEqual(['done', 'active', 'paused', 'abandoned', 'triage', 'blocked', NO_VALUE_LABEL]);
  });

  it('No value stays last unless it is listed, and goes where it is listed when it is', () => {
    expect(labels(groupInstances(mixed, 'status', opts(['abandoned']))).at(-1)).toBe(NO_VALUE_LABEL);
    expect(labels(groupInstances(mixed, 'status', opts([NO_VALUE_KEY, 'done'])))).toEqual([NO_VALUE_LABEL, 'done', 'active', 'paused', 'abandoned', 'blocked']);
  });

  it('an off-list value can be listed like an option', () => {
    expect(labels(groupInstances(mixed, 'status', opts(['blocked'])))).toEqual(['blocked', 'active', 'paused', 'done', 'abandoned', NO_VALUE_LABEL]);
  });

  it('a stale entry naming an option the type no longer has is dropped, not an empty phantom column', () => {
    const cols = groupInstances(mixed, 'status', opts(['archived', 'done', 'someday']));
    expect(labels(cols)).toEqual(['done', 'active', 'paused', 'abandoned', 'blocked', NO_VALUE_LABEL]);
    expect(cols.some((c) => c.label === 'archived' || c.label === 'someday')).toBe(false);
  });

  it('cards keep their input order within a reordered column', () => {
    const cols = groupInstances([row('x', { status: 'done' }), row('y', { status: 'done' })], 'status', opts(['done']));
    expect(cols[0]!.instances.map((i) => i.path)).toEqual(['x', 'y']);
  });

  it('orderColumns is stable and ignores repeated keys', () => {
    const cols = [{ value: 'a' }, { value: 'b' }, { value: null }, { value: 'c' }];
    expect(orderColumns(cols, ['c', 'c', 'a']).map(columnKey)).toEqual(['c', 'a', 'b', NO_VALUE_KEY]);
  });
});

describe('showEmptyColumns (#2614)', () => {
  const some = [row('a', { status: 'done' }), row('b', { status: null })];

  it('defaults to on: empty options and an empty No value are kept by groupInstances', () => {
    expect(groupInstances([row('a', { status: 'done' })], 'status', { enumOptions: STATUS.options! }).map((c) => c.label))
      .toEqual(['active', 'paused', 'done', 'abandoned', NO_VALUE_LABEL]);
  });

  it('off hides every column with no cards', () => {
    expect(summary(groupInstances(some, 'status', { enumOptions: STATUS.options!, showEmptyColumns: false }))).toEqual([
      ['done', 'option', ['a']],
      [NO_VALUE_LABEL, 'no-value', ['b']],
    ]);
  });

  it('combines with a column order', () => {
    const cols = groupInstances(some, 'status', { enumOptions: STATUS.options!, columnOrder: ['paused', NO_VALUE_KEY], showEmptyColumns: false });
    expect(cols.map((c) => c.label)).toEqual([NO_VALUE_LABEL, 'done']);
  });

  it('boardColumns passes both through, on top of its own rules', () => {
    const filed = [row('a', { status: 'active' }), row('b', { status: 'done' })];
    expect(boardColumns(filed, STATUS, [], { columnOrder: ['done'] }).map((c) => c.label)).toEqual(['done', 'active', 'paused', 'abandoned']);
    expect(boardColumns(filed, STATUS, [], { showEmptyColumns: false }).map((c) => c.label)).toEqual(['active', 'done']);
    // A values filter still narrows; the order still applies to what's left.
    expect(boardColumns(filed, STATUS, [{ property: 'status', values: ['active', 'done', 'paused'] }], { columnOrder: ['paused', 'done'] }).map((c) => c.label))
      .toEqual(['paused', 'done', 'active']);
  });
});

describe('moveColumn (#2614)', () => {
  const all = [row('a', { status: 'active' }), row('b', { status: 'done' }), row('c', { status: null }), row('d', { status: 'blocked' })];

  it('moves a column before or after another, writing the full order', () => {
    expect(moveColumn(all, STATUS, [], 'done', 'active', 'before')).toEqual(['done', 'active', 'paused', 'abandoned', 'blocked']);
    expect(moveColumn(all, STATUS, [], 'active', 'abandoned', 'after')).toEqual(['paused', 'done', 'abandoned', 'active', 'blocked']);
  });

  it('builds on the current order', () => {
    const order = moveColumn(all, STATUS, [], 'done', 'active', 'before');
    expect(moveColumn(all, STATUS, order, 'abandoned', 'done', 'before')).toEqual(['abandoned', 'done', 'active', 'paused', 'blocked']);
  });

  it('leaves No value out while it is last, and writes it once it is moved', () => {
    expect(moveColumn(all, STATUS, [], 'paused', 'active', 'before')).not.toContain(NO_VALUE_KEY);
    expect(moveColumn(all, STATUS, [], NO_VALUE_KEY, 'active', 'before')).toEqual([NO_VALUE_KEY, 'active', 'paused', 'done', 'abandoned', 'blocked']);
  });

  it('a move back to the natural order is no order at all', () => {
    const order = moveColumn(all, STATUS, [], 'done', 'active', 'before');
    expect(moveColumn(all, STATUS, order, 'done', 'paused', 'after')).toEqual([]);
  });

  it('a move past a hidden (empty) column leaves that column where it was', () => {
    // paused and abandoned are empty; with them hidden, "move done left" lands before active.
    expect(moveColumn(all, STATUS, [], 'done', 'active', 'before')).toEqual(['done', 'active', 'paused', 'abandoned', 'blocked']);
  });

  it('a stale order is pruned by a move, and a move naming no column changes nothing', () => {
    expect(moveColumn(all, STATUS, ['archived', 'done'], 'active', 'done', 'before')).toEqual(['active', 'done', 'paused', 'abandoned', 'blocked']);
    expect(moveColumn(all, STATUS, ['done'], 'gone', 'active', 'before')).toEqual(['done']);
    expect(moveColumn(all, STATUS, ['done'], 'done', 'done', 'after')).toEqual(['done']);
  });
});

describe('parsing columnOrder and showEmptyColumns (#2614)', () => {
  it('parseColumnOrder keeps string entries once, in order, and reads anything else as none', () => {
    expect(parseColumnOrder(['done', '', 'active', 'done'])).toEqual(['done', '', 'active']);
    expect(parseColumnOrder(['a', 1, null, { x: 1 }, 'b'])).toEqual(['a', 'b']);
    for (const raw of [undefined, null, 'done', 3, { 0: 'a' }]) expect(parseColumnOrder(raw)).toEqual([]);
  });

  it('parseShowEmptyColumns is on unless explicitly false', () => {
    expect(parseShowEmptyColumns(false)).toBe(false);
    for (const raw of [undefined, null, true, 0, 'false', '']) expect(parseShowEmptyColumns(raw)).toBe(true);
  });
});
