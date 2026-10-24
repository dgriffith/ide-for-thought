/**
 * The Kanban plugin's test kit (#2828): a fake plugin API that records every
 * call and can send events, and a view state built the way the host builds it
 * — grouped by the app's own `boardColumns`, cards prepared by its own
 * `selectInstanceCardFields` — so the board is tested against what it gets.
 */
import { vi } from 'vitest';
import type { MinervaPlugin, PluginViewState } from '../../../plugin-api/index';
import { boardColumns, columnKey, resolveGroupBy } from '../../../src/shared/objects/kanban';
import { selectInstanceCardFields } from '../../../src/shared/objects/card';
import type { PropertyDef, TypeInfo, TypeInstanceRow } from '../../../src/shared/objects/type-def';

export function fakeMinerva() {
  const calls: Array<{ method: string; params: unknown }> = [];
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const method = (name: string) => vi.fn(async (params: unknown = {}) => { calls.push({ method: name, params }); return {}; });
  const group = (names: string[]) => Object.fromEntries(names.map((n) => [n.split('.')[1]!, method(n)]));
  const minerva = {
    apiVersion: '1.5.0',
    call: (m: string, p: unknown) => method(m)(p),
    on: (event: string, fn: (data: unknown) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
      return () => { listeners.get(event)?.delete(fn); };
    },
    close: vi.fn(),
    notes: group(['notes.list', 'notes.read', 'notes.setProperties', 'notes.write', 'notes.create']),
    graph: group(['graph.query']),
    tables: group(['tables.query']),
    llm: group(['llm.propose']),
    ui: group(['ui.openNote', 'ui.announce', 'ui.copyText', 'ui.revealNote', 'ui.showMenu', 'ui.releaseFocus', 'ui.forwardKey', 'ui.showNoteMenu', 'ui.previewNote', 'ui.hidePreview']),
    view: group(['view.setState', 'view.provideExport', 'view.click', 'view.selectAll', 'view.clearSelection', 'view.moveCard', 'view.undoMove', 'view.moveColumn', 'view.reschedule', 'view.setHeight']),
  } as unknown as MinervaPlugin;
  return {
    minerva,
    calls,
    /** The params of every call to `name`, in order. */
    of: (name: string) => calls.filter((c) => c.method === name).map((c) => c.params),
    emit: (event: string, data: unknown) => { for (const fn of listeners.get(event) ?? []) fn(data); },
  };
}

export const PROJECT: TypeInfo = {
  id: 'project', label: 'Project', classLocalName: 'Project', icon: '🚀', source: 'stock',
  properties: [
    { name: 'status', type: 'enum', options: ['active', 'paused', 'done', 'abandoned'] },
    { name: 'priority', type: 'enum', label: 'Priority', options: ['low', 'high'] },
    { name: 'owner', type: 'text', label: 'Owner' },
  ],
};

export const row = (path: string, title: string, values: Record<string, string | null>): TypeInstanceRow =>
  ({ path, title, values: { status: null, priority: null, owner: null, ...values }, cover: null });

export const FILED = [
  row('a.md', 'Alpha', { status: 'active', owner: 'Ann', priority: 'high' }),
  row('c.md', 'Charlie', { status: 'active' }),
  row('d.md', 'Delta', { status: 'paused', priority: 'low' }),
  row('b.md', 'Bravo', { status: 'done', owner: 'Bo' }),
];

/** A view state as the host sends it, for `rows` of `type` grouped by `groupBy`. */
export function viewOf(rows: readonly TypeInstanceRow[], over: Partial<PluginViewState> & {
  type?: TypeInfo; groupBy?: string | null; columnOrder?: string[]; showEmptyColumns?: boolean;
  refPath?: (prop: PropertyDef, value: string | null) => string | null;
} = {}): PluginViewState {
  const type = over.type ?? PROJECT;
  const group = resolveGroupBy(over.groupBy ?? null, type.properties);
  const board = group ? boardColumns(rows, group, [], { columnOrder: over.columnOrder ?? [], showEmptyColumns: over.showEmptyColumns ?? true }) : [];
  const byName = new Map(type.properties.map((p) => [p.name, p] as const));
  const { type: _t, groupBy: _g, columnOrder: _c, showEmptyColumns: _s, refPath, ...rest } = over;
  return {
    layout: 'kanban',
    type: { id: type.id, label: type.label, ...(type.icon ? { icon: type.icon } : {}) },
    properties: type.properties.map((p) => ({ name: p.name, type: p.type, ...(p.label ? { label: p.label } : {}), ...(p.options ? { options: p.options } : {}) })),
    visible: null,
    instances: rows.map((inst) => ({
      path: inst.path, title: inst.title, values: inst.values,
      fields: selectInstanceCardFields(type, type.properties, inst, { omit: group ? [group.name] : [] }).map((f) => {
        const ref = refPath && byName.get(f.name) ? refPath(byName.get(f.name)!, f.value) : null;
        return { name: f.name, label: f.label, text: f.value ?? '', ...(ref ? { ref } : {}) };
      }),
      icon: { glyph: type.icon ?? '◆', label: type.label },
    })),
    sortColumn: null, sortDir: 'asc',
    spec: { groupBy: group?.name ?? null, columnOrder: over.columnOrder ?? [], showEmptyColumns: over.showEmptyColumns ?? true },
    readOnly: false, exportMode: false,
    selected: [], selectable: true, rowMenu: true,
    groupProperty: group?.name ?? null,
    groups: board.map((col) => ({ key: columnKey(col), label: col.label, kind: col.kind, value: col.value, paths: col.instances.map((i) => i.path) })),
    movable: true, canUndoMove: false, lastMove: null,
    ...rest,
  };
}
