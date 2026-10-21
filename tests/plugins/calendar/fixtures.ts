/**
 * The Calendar plugin's test kit (#2829): its view, mounted with a fake
 * plugin API (`tests/plugins/kanban/fixtures.ts`'s, which records each call),
 * from the props the in-app calendar took — the view state built from them
 * the way `PluginLayout` builds it — and those props' callbacks read back off
 * the calls the plugin makes: `onStateChange` from `view.setState`,
 * `onOpenNote` from `view.click`. So the calendar's tests read as they did.
 */
import { vi } from 'vitest';
import { render } from '@testing-library/svelte';
import Calendar from '../../../plugins/calendar/src/Calendar.svelte';
import type { PluginViewState } from '../../../plugin-api/index';
import type { Weekday } from '../../../src/shared/objects/calendar-grid';
import type { TypeInstanceRow } from '../../../src/shared/objects/type-def';
import { fakeMinerva } from '../kanban/fixtures';

/** What the in-app calendar was given. */
export interface CalendarProps {
  type: { id: string; label: string; icon?: string };
  properties: ReadonlyArray<{ name: string; type: string; label?: string }>;
  instances: TypeInstanceRow[];
  month?: string | null;
  dateBy?: string | null;
  readOnly?: boolean;
  exportMode?: boolean;
  locale?: string;
  weekStart?: Weekday;
  showWeekNumbers?: boolean;
}

/** The view Minerva sends for those props (`PluginLayout`). */
export function calendarView(p: CalendarProps): PluginViewState {
  return {
    layout: 'calendar',
    type: { id: p.type.id, label: p.type.label, ...(p.type.icon ? { icon: p.type.icon } : {}) },
    properties: p.properties.map((x) => ({ name: x.name, type: x.type, ...(x.label ? { label: x.label } : {}) })),
    visible: null,
    instances: p.instances.map((i) => ({ path: i.path, title: i.title, values: { ...i.values }, fields: [] })),
    sortColumn: null, sortDir: 'asc',
    spec: { month: p.month ?? null, dateBy: p.dateBy ?? null },
    filters: [],
    week: { start: p.weekStart ?? 1, numbers: p.showWeekNumbers ?? false },
    readOnly: p.readOnly ?? false, exportMode: p.exportMode ?? false,
    selected: [], selectable: false, rowMenu: false,
    groupProperty: null, groups: [], movable: !(p.readOnly || p.exportMode), canUndoMove: false, lastMove: null,
  };
}

/** Mount the plugin's calendar for `props`; `rerender` sends a new view, as new props did. */
export function renderCalendar(props: CalendarProps) {
  const api = fakeMinerva();
  const onStateChange = vi.fn();
  const onOpenNote = vi.fn();
  const m = api.minerva as unknown as { view: Record<string, (p: never) => Promise<unknown>> };
  m.view['setState'] = vi.fn(async (p: { patch: Record<string, unknown> }) => { api.calls.push({ method: 'view.setState', params: p }); onStateChange(p.patch); return {}; });
  m.view['click'] = vi.fn(async (p: { path: string }) => { api.calls.push({ method: 'view.click', params: p }); onOpenNote(p.path); return {}; });
  let current = { ...props };
  const utils = render(Calendar, { minerva: api.minerva, view: calendarView(current), ...(props.locale ? { locale: props.locale } : {}) });
  const rerender = async (patch: Partial<CalendarProps>) => {
    current = { ...current, ...patch };
    await utils.rerender({ view: calendarView(current) });
  };
  return { ...utils, rerender, api, onStateChange, onOpenNote };
}
