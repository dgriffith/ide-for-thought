/**
 * Layouts a built-in plugin draws (#2828): offered only while the plugin is
 * on; a saved view keeps its layout either way.
 */
import { describe, it, expect } from 'vitest';
import { isViewLayout, layoutAvailable, layoutsFor, VIEW_LAYOUTS, type ViewLayoutDef } from '../../../src/shared/objects/view-layouts';

const ctx = { typeId: 't', properties: [], catalog: [] };
const withPlugin: ViewLayoutDef[] = [
  ...VIEW_LAYOUTS.filter((l) => ['list', 'table'].includes(l.id)),
  { id: 'kanban', label: 'Kanban', noteName: 'board', appliesTo: () => true, dated: false, grouped: true, specFields: [], plugin: 'kanban' },
];

describe('plugin-drawn layouts (#2828)', () => {
  it('are offered only while their plugin is on', () => {
    expect(layoutsFor({ ...ctx, pluginOn: () => true }, withPlugin)).toEqual(['list', 'table', 'kanban']);
    expect(layoutsFor({ ...ctx, pluginOn: () => false }, withPlugin)).toEqual(['list', 'table']);
    expect(layoutsFor(ctx, withPlugin)).toEqual(['list', 'table', 'kanban']); // no answer yet: on
  });

  it('a built-in layout is always available, and a saved id stays valid', () => {
    expect(layoutAvailable('table', () => false)).toBe(true);
    expect(isViewLayout('kanban')).toBe(true);
  });
});
