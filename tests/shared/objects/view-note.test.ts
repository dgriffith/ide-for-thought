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
    expect(parseObjectViewSpec(fenceBody(content))).toEqual({ ...spec, folder: null, filters: [] });
  });

  it('leave defaults out of the block, and read back as the same defaults', () => {
    const plain = { typeId: 'place', layout: 'map' as const, sortColumn: null, sortDir: 'asc' as const, columns: null };
    const body = fenceBody(buildViewNoteContent('Places', plain));
    expect(JSON.parse(body)).toEqual({ typeId: 'place', layout: 'map' });
    expect(parseObjectViewSpec(body)).toEqual({ ...plain, folder: null, filters: [] });
  });

  it('carry a folder scope and filters through to the embed parser (#2531)', () => {
    const scoped = { ...spec, folder: 'trip/prague', filters: [{ property: 'city', values: ['Prague'] }, { property: 'rating', min: '4', max: null }] };
    expect(parseObjectViewSpec(fenceBody(buildViewNoteContent('Prague places', scoped)))).toEqual(scoped);
  });

  it('write no folder or filters keys when there are none', () => {
    const body = JSON.parse(fenceBody(buildViewNoteContent('All', { ...spec, folder: null, filters: [] }))) as Record<string, unknown>;
    expect(body).not.toHaveProperty('folder');
    expect(body).not.toHaveProperty('filters');
  });

  it('suggest a name from the type and layout', () => {
    expect(suggestViewNoteName('Restaurant', 'map')).toBe('Restaurant map');
    expect(suggestViewNoteName('  ', 'list')).toBe('Objects list');
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
