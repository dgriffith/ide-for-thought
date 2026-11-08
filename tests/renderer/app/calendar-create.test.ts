/**
 * A new event drawn on the Calendar, Minerva's half (#2954): the note's
 * frontmatter for a timed and an all-day creation, the type's template with
 * its placeholders filled, the subtype choice, cancel creating nothing, a
 * `date` property keeping only the day, and a taken name.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  writeFile: vi.fn(),
  showPrompt: vi.fn(),
  showTypePicker: vi.fn(),
  refresh: vi.fn(),
  announce: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { notebase: { writeFile: h.writeFile, fileExists: async (p: string) => h.disk.has(p) } },
}));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({
  getDialogStore: () => ({ showPrompt: h.showPrompt, showTypePicker: h.showTypePicker }),
}));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({ getNotebaseStore: () => ({ refresh: h.refresh }) }));
vi.mock('../../../src/renderer/lib/stores/announcer.svelte', () => ({ announce: h.announce }));

import { createCalendarEvent, noteNameFor, type CreateEventRequest } from '../../../src/renderer/lib/app/calendar-create';
import type { TypeInfo } from '../../../src/shared/objects/type-def';

const EVENT: TypeInfo = {
  id: 'event', label: 'Event', classLocalName: 'Event',
  properties: [{ name: 'date', type: 'datetime' }, { name: 'end', type: 'datetime' }, { name: 'place', type: 'text' }],
  template: '# {{title}}\n\nStarts {{prop:date}}.\n', // {{date}} is the built-in (today); a property needs prop:
};
const MEETING: TypeInfo = { id: 'meeting', label: 'Meeting', classLocalName: 'Meeting', parent: 'event', properties: [], effectivePropertyNames: ['date', 'end', 'place', 'room'] };
const JOURNAL: TypeInfo = { id: 'journal', label: 'Journal', classLocalName: 'Journal', properties: [{ name: 'published', type: 'date' }] };

function req(over: Partial<CreateEventRequest> = {}): CreateEventRequest {
  return {
    type: EVENT, catalog: [EVENT], properties: EVENT.properties,
    dates: { dateProperty: 'date', endProperty: 'end' },
    start: '2026-10-07T09:00', end: '2026-10-07T10:30', cause: 'Created by Calendar', ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.disk.clear();
  h.writeFile.mockImplementation((p: string, c: string) => { h.disk.set(p, c); return Promise.resolve(); });
  h.showPrompt.mockResolvedValue('Design review');
});

describe('createCalendarEvent (#2954)', () => {
  it('a timed event: the type, its date and end, its template filled; with the cause; announced', async () => {
    expect(await createCalendarEvent(req())).toBe('Design review.md');
    expect(h.showPrompt).toHaveBeenCalledWith('New Event — title:');
    expect(h.disk.get('Design review.md')).toBe(
      '---\ntype: event\ndate: 2026-10-07T09:00\nend: 2026-10-07T10:30\nplace:\n---\n\n# Design review\n\nStarts 2026-10-07T09:00.\n',
    );
    expect(h.writeFile).toHaveBeenCalledWith('Design review.md', expect.any(String), { cause: 'Created by Calendar' });
    expect(h.refresh).toHaveBeenCalled();
    expect(h.announce).toHaveBeenCalledWith('Created Design review.');
    expect(h.showTypePicker).not.toHaveBeenCalled(); // no subtypes
  });

  it('an all-day event: a day, and an end only for a run of days', async () => {
    await createCalendarEvent(req({ type: { ...EVENT, template: '' }, start: '2026-10-07', end: null }));
    expect(h.disk.get('Design review.md')).toContain('date: 2026-10-07\nend:\n');
    h.showPrompt.mockResolvedValue('Offsite');
    await createCalendarEvent(req({ start: '2026-10-07', end: '2026-10-09' }));
    expect(h.disk.get('Offsite.md')).toContain('date: 2026-10-07\nend: 2026-10-09\n');
  });

  it('a parent type\'s view asks which type, and makes the one chosen', async () => {
    h.showTypePicker.mockResolvedValue(MEETING);
    await createCalendarEvent(req({ catalog: [EVENT, MEETING, JOURNAL] }));
    expect(h.showTypePicker).toHaveBeenCalledWith([EVENT, MEETING], expect.objectContaining({ title: 'Which type is it?' }));
    expect(h.showPrompt).toHaveBeenCalledWith('New Meeting — title:');
    expect(h.disk.get('Design review.md')).toMatch(/^---\ntype: meeting\ndate: 2026-10-07T09:00\nend: 2026-10-07T10:30\nplace:\nroom:\n---\n/);
  });

  it('cancelling the type or the title creates nothing', async () => {
    h.showTypePicker.mockResolvedValue(null);
    expect(await createCalendarEvent(req({ catalog: [EVENT, MEETING] }))).toBeNull();
    h.showPrompt.mockResolvedValue(null);
    expect(await createCalendarEvent(req())).toBeNull();
    h.showPrompt.mockResolvedValue('   ');
    expect(await createCalendarEvent(req())).toBeNull();
    expect(h.writeFile).not.toHaveBeenCalled();
    expect(h.announce).not.toHaveBeenCalled();
  });

  it('a date property gets only the day, and a view with no end field writes none', async () => {
    h.showPrompt.mockResolvedValue('Autumn issue');
    await createCalendarEvent(req({ type: JOURNAL, catalog: [JOURNAL], properties: JOURNAL.properties, dates: { dateProperty: 'published', endProperty: null } }));
    expect(h.disk.get('Autumn issue.md')).toBe('---\ntype: journal\npublished: 2026-10-07\n---\n');
  });

  it('a taken name gets a number; a slash in the title is not a folder', async () => {
    h.disk.set('Design review.md', 'x');
    expect(await createCalendarEvent(req())).toBe('Design review 2.md');
    expect(noteNameFor(' a/b\\c:d ')).toBe('a-b-c-d');
  });

  it('an invalid stretch asks nothing', async () => {
    expect(await createCalendarEvent(req({ start: '2026-10-07T09:00Z' }))).toBeNull();
    expect(h.showPrompt).not.toHaveBeenCalled();
  });
});
