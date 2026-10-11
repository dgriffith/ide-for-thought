/**
 * The view-layout registry's rules (#2623): which layouts a type can show, in
 * the switcher's order, and the lookups the rest of the app derives from.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VIEW_LAYOUT, VIEW_LAYOUTS, isViewLayout, layoutDef, layoutIdList, layoutsFor,
} from '../../../src/shared/objects/view-layouts';
import type { PropertyDef } from '../../../src/shared/objects/type-def';

const prop = (name: string, type: PropertyDef['type']): PropertyDef => ({ name, type });
const ctx = (properties: PropertyDef[], catalog = [{ id: 't', properties }]) => ({ typeId: 't', properties, catalog });

describe('layoutsFor', () => {
  it('a plain type gets list, table and gallery', () => {
    expect(layoutsFor(ctx([prop('title', 'text')]))).toEqual(['list', 'table', 'gallery']);
  });

  it('map needs a geo property, kanban an enum, timeline and calendar a date', () => {
    expect(layoutsFor(ctx([prop('where', 'geo')]))).toEqual(['list', 'table', 'gallery', 'map']);
    expect(layoutsFor(ctx([prop('status', 'enum')]))).toEqual(['list', 'table', 'gallery', 'kanban']);
    expect(layoutsFor(ctx([prop('when', 'date')]))).toEqual(['list', 'table', 'gallery', 'timeline', 'calendar']);
  });

  it('a date inherited through the catalog counts', () => {
    const catalog = [{ id: 'event', properties: [prop('date', 'date')] }, { id: 't', parent: 'event', properties: [] }];
    expect(layoutsFor({ typeId: 't', properties: [prop('date', 'date')], catalog })).toContain('timeline');
  });

  it('everything at once, in registry order', () => {
    expect(layoutsFor(ctx([prop('w', 'geo'), prop('s', 'enum'), prop('d', 'datetime')])))
      .toEqual(VIEW_LAYOUTS.map((l) => l.id));
  });
});

describe('lookups', () => {
  it('isViewLayout accepts exactly the registered ids', () => {
    for (const l of VIEW_LAYOUTS) expect(isViewLayout(l.id)).toBe(true);
    for (const bad of ['board', 'Table', '', null, 3]) expect(isViewLayout(bad)).toBe(false);
  });

  it('labels, note names and the dated flag', () => {
    expect(layoutDef('kanban')).toMatchObject({ label: 'Kanban', noteName: 'board', dated: false });
    expect(layoutDef('calendar').dated).toBe(true);
    expect(layoutDef('timeline').dated).toBe(true);
    expect(DEFAULT_VIEW_LAYOUT).toBe('table');
  });

  it('the id list reads as the embed parser\'s message always did', () => {
    expect(layoutIdList()).toBe('"list", "table", "gallery", "map", "kanban", "timeline", "calendar"');
  });
});
