/**
 * Object views are places in back/forward history: view → map pin → note →
 * Back lands on the view, Forward on the note again (the real store).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { getNavigationStore } from '../../../src/renderer/lib/stores/navigation.svelte';

const nav = getNavigationStore();
const map = { type: 'type-view' as const, typeId: 'place', folder: 'trip/prague' };
const note = { type: 'note' as const, relativePath: 'trip/prague/Kampa.md', offset: 0 };

beforeEach(() => nav.clear());

describe('type-view positions', () => {
  it('view → note → Back → view → Forward → note', () => {
    nav.record(map);
    nav.record(note);
    expect(nav.goBack()).toEqual(map);
    nav.doneNavigating();
    expect(nav.goForward()).toEqual(note);
    nav.doneNavigating();
  });

  it('the same view re-recorded (say, re-sorted) is one place; another folder is another', () => {
    nav.record(map);
    nav.record({ ...map, view: { layout: 'table', sortColumn: 'city', sortDir: 'asc', columns: null, filters: [] } });
    expect(nav.canGoBack).toBe(false);
    nav.record({ ...map, folder: 'trip/budapest' });
    expect(nav.canGoBack).toBe(true);
  });
});
