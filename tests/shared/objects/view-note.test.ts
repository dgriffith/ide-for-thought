/**
 * @vitest-environment happy-dom
 *
 * (happy-dom only because the real embed parser's module also holds the
 * Svelte mount code.)
 *
 * Saving a view writes a note with a live object-view embed (#2507).
 */
import { describe, it, expect } from 'vitest';
import MarkdownIt from 'markdown-it';
import {
  buildViewEmbed,
  buildViewNoteContent,
  firstFreePath,
  suggestViewNoteName,
  viewNoteFilename,
} from '../../../src/shared/objects/view-note';
import { parseObjectViewSpec } from '../../../src/renderer/lib/markdown/object-view-renderer';

const spec = { typeId: 'restaurant', layout: 'table' as const, sortColumn: 'rating', sortDir: 'desc' as const, columns: ['cuisine', 'rating'] };

/** The fence body, exactly as the preview's embed parser receives it. */
function fenceBody(content: string): string {
  const tok = new MarkdownIt().parse(content, {}).find((t) => t.type === 'fence' && t.info === 'object-view');
  if (!tok) throw new Error('no object-view fence');
  return tok.content;
}

describe('view notes', () => {
  it('embed the view so the preview renders exactly what was saved', () => {
    const content = buildViewNoteContent('Restaurants by rating', spec);
    expect(content.startsWith('# Restaurants by rating\n')).toBe(true);
    expect(parseObjectViewSpec(fenceBody(content))).toEqual({ ...spec, folder: null, filters: [], mapStyle: 'auto', height: 360, groupBy: null, columnOrder: [], showEmptyColumns: true, from: null, to: null, month: null, dateBy: null });
  });

  it('leave defaults out of the block, and read back as the same defaults', () => {
    const plain = { typeId: 'place', layout: 'map' as const, sortColumn: null, sortDir: 'asc' as const, columns: null };
    const body = fenceBody(buildViewNoteContent('Places', plain));
    expect(JSON.parse(body)).toEqual({ typeId: 'place', layout: 'map' });
    expect(parseObjectViewSpec(body)).toEqual({ ...plain, folder: null, filters: [], mapStyle: 'auto', height: 360, groupBy: null, columnOrder: [], showEmptyColumns: true, from: null, to: null, month: null, dateBy: null });
  });

  it('carry a folder scope and filters through to the embed parser (#2531)', () => {
    const scoped = { ...spec, folder: 'trip/prague', filters: [{ property: 'city', values: ['Prague'] }, { property: 'rating', min: '4', max: null }] };
    expect(parseObjectViewSpec(fenceBody(buildViewNoteContent('Prague places', scoped)))).toEqual({ ...scoped, mapStyle: 'auto', height: 360, groupBy: null, columnOrder: [], showEmptyColumns: true, from: null, to: null, month: null, dateBy: null });
  });

  it('omit an auto map style, and keep an explicit light or dark one (#2665)', () => {
    const map = { typeId: 'place', layout: 'map' as const, sortColumn: null, sortDir: 'asc' as const, columns: null };
    const auto = JSON.parse(fenceBody(buildViewNoteContent('Places', { ...map, mapStyle: 'auto' }))) as Record<string, unknown>;
    expect(auto).toEqual({ typeId: 'place', layout: 'map' });
    for (const mapStyle of ['light', 'dark'] as const) {
      const body = fenceBody(buildViewNoteContent('Places', { ...map, mapStyle }));
      expect(JSON.parse(body)).toEqual({ typeId: 'place', layout: 'map', mapStyle });
      expect(parseObjectViewSpec(body)).toEqual({ ...map, folder: null, filters: [], mapStyle, height: 360, groupBy: null, columnOrder: [], showEmptyColumns: true, from: null, to: null, month: null, dateBy: null });
    }
  });

  it('carry a kanban groupBy through, and omit it when it is the default (#2601)', () => {
    const board = { typeId: 'project', layout: 'kanban' as const, sortColumn: null, sortDir: 'asc' as const, columns: null };
    expect(JSON.parse(fenceBody(buildViewNoteContent('Projects', { ...board, groupBy: null })))).toEqual({ typeId: 'project', layout: 'kanban' });
    const body = fenceBody(buildViewNoteContent('Projects', { ...board, groupBy: 'status' }));
    expect(JSON.parse(body)).toEqual({ typeId: 'project', layout: 'kanban', groupBy: 'status' });
    expect(parseObjectViewSpec(body)).toEqual({ ...board, folder: null, filters: [], mapStyle: 'auto', height: 360, groupBy: 'status', columnOrder: [], showEmptyColumns: true, from: null, to: null, month: null, dateBy: null });
  });

  it('carry a kanban column order and Show empty columns through, omitting the defaults (#2614)', () => {
    const board = { typeId: 'project', layout: 'kanban' as const, sortColumn: null, sortDir: 'asc' as const, columns: null };
    expect(JSON.parse(fenceBody(buildViewNoteContent('Projects', { ...board, columnOrder: [], showEmptyColumns: true })))).toEqual({ typeId: 'project', layout: 'kanban' });
    const body = fenceBody(buildViewNoteContent('Projects', { ...board, columnOrder: ['done', '', 'active'], showEmptyColumns: false }));
    expect(JSON.parse(body)).toEqual({ typeId: 'project', layout: 'kanban', columnOrder: ['done', '', 'active'], showEmptyColumns: false });
    expect(parseObjectViewSpec(body)).toEqual({ ...board, folder: null, filters: [], mapStyle: 'auto', height: 360, groupBy: null, columnOrder: ['done', '', 'active'], showEmptyColumns: false, from: null, to: null, month: null, dateBy: null });
    // Copy as markdown is the same block, so the same round trip.
    expect(parseObjectViewSpec(fenceBody(buildViewEmbed({ ...board, columnOrder: ['paused'] }))).columnOrder).toEqual(['paused']);
  });

  it('carry a timeline range through, omitting it when it fits all (#2607)', () => {
    const timeline = { typeId: 'event', layout: 'timeline' as const, sortColumn: null, sortDir: 'asc' as const, columns: null };
    expect(JSON.parse(fenceBody(buildViewNoteContent('Events', { ...timeline, from: null, to: null })))).toEqual({ typeId: 'event', layout: 'timeline' });
    const body = fenceBody(buildViewNoteContent('Events', { ...timeline, from: '1960', to: '1975-06' }));
    expect(JSON.parse(body)).toEqual({ typeId: 'event', layout: 'timeline', from: '1960', to: '1975-06' });
    expect(parseObjectViewSpec(body)).toEqual({ ...timeline, folder: null, filters: [], mapStyle: 'auto', height: 360, groupBy: null, columnOrder: [], showEmptyColumns: true, from: '1960', to: '1975-06', month: null, dateBy: null });
    // One edge alone, and a BCE one, survive Copy as markdown's bare block too.
    expect(parseObjectViewSpec(fenceBody(buildViewEmbed({ ...timeline, from: '-0043' })))).toMatchObject({ from: '-0043', to: null });
  });

  it('carry a calendar month and dateBy through, omitting them at their defaults (#2701)', () => {
    const calendar = { typeId: 'book', layout: 'calendar' as const, sortColumn: null, sortDir: 'asc' as const, columns: null };
    expect(JSON.parse(fenceBody(buildViewNoteContent('Books', { ...calendar, month: null, dateBy: null })))).toEqual({ typeId: 'book', layout: 'calendar' });
    const body = fenceBody(buildViewNoteContent('Books', { ...calendar, month: '2026-10', dateBy: 'published' }));
    expect(JSON.parse(body)).toEqual({ typeId: 'book', layout: 'calendar', month: '2026-10', dateBy: 'published' });
    expect(parseObjectViewSpec(body)).toEqual({ ...calendar, folder: null, filters: [], mapStyle: 'auto', height: 360, groupBy: null, columnOrder: [], showEmptyColumns: true, from: null, to: null, month: '2026-10', dateBy: 'published' });
    // A BCE month survives Copy as markdown's bare block too.
    expect(parseObjectViewSpec(fenceBody(buildViewEmbed({ ...calendar, month: '-0043-03' })))).toMatchObject({ month: '-0043-03', dateBy: null });
  });

  it('write no folder or filters keys when there are none', () => {
    const body = JSON.parse(fenceBody(buildViewNoteContent('All', { ...spec, folder: null, filters: [] }))) as Record<string, unknown>;
    expect(body).not.toHaveProperty('folder');
    expect(body).not.toHaveProperty('filters');
  });

  it('suggest a name from the type and layout', () => {
    expect(suggestViewNoteName('Restaurant', 'map')).toBe('Restaurant map');
    expect(suggestViewNoteName('  ', 'list')).toBe('Objects list');
    expect(suggestViewNoteName('Project', 'kanban')).toBe('Project board');
    expect(suggestViewNoteName('Event', 'timeline')).toBe('Event timeline');
    expect(suggestViewNoteName('Book', 'calendar')).toBe('Book calendar');
  });

  it('turn a typed name into one note at the root', () => {
    expect(viewNoteFilename('Restaurant map')).toBe('Restaurant map.md');
    expect(viewNoteFilename('Prague / Budapest: food')).toBe('Prague - Budapest- food.md');
    expect(viewNoteFilename('Already.md')).toBe('Already.md');
    expect(viewNoteFilename('   ')).toBe('View.md');
  });

  it('never overwrite: take the next free name', async () => {
    const taken = new Set(['Places.md', 'Places 2.md']);
    expect(await firstFreePath('Places.md', async (p) => taken.has(p))).toBe('Places 3.md');
    expect(await firstFreePath('New.md', async (p) => taken.has(p))).toBe('New.md');
  });
});
