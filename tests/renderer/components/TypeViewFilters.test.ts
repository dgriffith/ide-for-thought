/**
 * @vitest-environment happy-dom
 *
 * The view panel's filter controls (#2533): pick values present in the view
 * (with counts), or a min/max for numbers and dates; chips show and remove
 * the active filters; changes apply live.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen, within } from '@testing-library/svelte';
import TypeViewFilters from '../../../src/renderer/lib/components/TypeViewFilters.svelte';
import type { ViewFilter } from '../../../src/shared/objects/view-spec';
import type { PropertyDef, TypeInstanceRow } from '../../../src/shared/objects/type-def';

const PROPS: PropertyDef[] = [
  { name: 'city', type: 'text', label: 'City' },
  { name: 'rating', type: 'number', label: 'Rating' },
  { name: 'visited', type: 'date', label: 'Visited' },
  { name: 'location', type: 'geo', label: 'Location' },
];
const row = (city: string | null, rating: string): TypeInstanceRow => ({ path: `${city}-${rating}.md`, title: 't', values: { city, rating, visited: null, location: null }, cover: null });
const INSTANCES = [row('Prague', '5'), row('Prague', '3'), row('Budapest', '4'), row(null, '1')];
const display = (_p: PropertyDef, v: string | null) => v ?? '—';

function mount(filters: ViewFilter[] = []) {
  const onChange = vi.fn();
  render(TypeViewFilters, { properties: PROPS, instances: INSTANCES, filters, display, onChange });
  return onChange;
}
afterEach(() => cleanup());

describe('TypeViewFilters (#2533)', () => {
  it('offers every property but geo', async () => {
    mount();
    await fireEvent.click(screen.getByRole('button', { name: 'Filter ▾' }));
    const dialog = screen.getByRole('dialog', { name: 'Filter by property' });
    expect(within(dialog).getAllByRole('button').map((b) => b.textContent.trim())).toEqual(['City', 'Rating', 'Visited']);
  });

  it('lists the values present, with counts, and ticking one filters live', async () => {
    const onChange = mount();
    await fireEvent.click(screen.getByRole('button', { name: 'Filter ▾' }));
    await fireEvent.click(screen.getByRole('button', { name: 'City' }));
    const labels = screen.getAllByRole('checkbox').map((c) => c.closest('label')!.textContent.replace(/\s+/g, ' ').trim());
    expect(labels).toEqual(['Budapest1', 'Prague2']); // value + its count; the empty value isn't offered
    await fireEvent.click(screen.getByRole('checkbox', { name: /Prague/ }));
    expect(onChange).toHaveBeenLastCalledWith([{ property: 'city', values: ['Prague'] }]);
  });

  it('adds to a values filter, and keeps other filters (AND)', async () => {
    const onChange = mount([{ property: 'city', values: ['Prague'] }, { property: 'rating', min: '4', max: null }]);
    await fireEvent.click(screen.getByRole('button', { name: 'Filter ▾' }));
    await fireEvent.click(within(screen.getByRole('dialog', { name: 'Filter by property' })).getByRole('button', { name: /^City/ }));
    expect((screen.getByRole('checkbox', { name: /Prague/ })).checked).toBe(true);
    await fireEvent.click(screen.getByRole('checkbox', { name: /Budapest/ }));
    expect(onChange).toHaveBeenLastCalledWith([{ property: 'rating', min: '4', max: null }, { property: 'city', values: ['Prague', 'Budapest'] }]);
  });

  it('a number or date gets a range', async () => {
    const onChange = mount();
    await fireEvent.click(screen.getByRole('button', { name: 'Filter ▾' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Rating' }));
    await fireEvent.change(screen.getByLabelText('Min'), { target: { value: '4' } });
    expect(onChange).toHaveBeenLastCalledWith([{ property: 'rating', min: '4', max: null }]);
  });

  it('shows active filters as chips that edit and remove', async () => {
    const onChange = mount([{ property: 'city', values: ['Prague', 'Brno', 'Plzeň'] }, { property: 'rating', min: '4', max: null }, { property: 'visited', min: '2026-05', max: null }]);
    expect(screen.getByRole('button', { name: 'City: Prague, Brno +1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rating: ≥ 4' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Visited: from 2026-05' })).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Remove filter Rating: ≥ 4' }));
    expect(onChange).toHaveBeenLastCalledWith([{ property: 'city', values: ['Prague', 'Brno', 'Plzeň'] }, { property: 'visited', min: '2026-05', max: null }]);
    await fireEvent.click(screen.getByRole('button', { name: 'City: Prague, Brno +1' }));
    expect(screen.getByRole('dialog', { name: 'Filter by property' })).toBeTruthy(); // opened on that filter
  });

  it('Escape closes the popover', async () => {
    mount();
    await fireEvent.click(screen.getByRole('button', { name: 'Filter ▾' }));
    await fireEvent.keyDown(screen.getByRole('dialog', { name: 'Filter by property' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('TypeViewFilters — dismissal', () => {
  it('stays open while choosing a property, closes on a press outside', async () => {
    mount();
    await fireEvent.click(screen.getByRole('button', { name: 'Filter ▾' }));
    const city = screen.getByRole('button', { name: 'City' });
    await fireEvent.pointerDown(city);
    await fireEvent.click(city);
    expect(screen.getByRole('checkbox', { name: /Prague/ })).toBeTruthy();
    await fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
