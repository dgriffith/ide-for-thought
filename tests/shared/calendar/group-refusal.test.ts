/**
 * A selection moved together is all or none (#2938): the sentence when any
 * event can't move names each one, and says the way out.
 */
import { describe, it, expect } from 'vitest';
import { groupRefusal } from '../../../src/shared/calendar/reschedule-refusal';

describe('groupRefusal (#2938)', () => {
  it('is null when every event can move', () => {
    expect(groupRefusal([{ title: 'A', refusal: null }, { title: 'B', refusal: null }])).toBeNull();
  });

  it('names each refused event by its own sentence, counting the whole group', () => {
    expect(groupRefusal([
      { title: 'Dentist', refusal: null },
      { title: 'Trip', refusal: 'Trip ends 2026-11, which has no day to move; open it to edit.' },
      { title: 'Call', refusal: null },
    ])).toBe("Can't move these 3 events together. Trip ends 2026-11, which has no day to move; open it to edit. Deselect it to move the rest.");
  });

  it('says whose a sentence is when it leads with the date', () => {
    expect(groupRefusal([
      { title: 'Offsite', refusal: '2026-10 has no day to move; open it to edit.' },
      { title: 'Harvest', refusal: '2026 has no day to move; open it to edit.' },
    ])).toBe("Can't move these 2 events together. Offsite: 2026-10 has no day to move; open it to edit. Harvest: 2026 has no day to move; open it to edit. Deselect them to move the rest.");
  });
});
