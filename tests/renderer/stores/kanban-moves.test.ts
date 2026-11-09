/**
 * The Kanban move store (#2603). The IPC client is a tiny in-memory disk; the
 * editor and dialog stores are mocked. Asserted: a move writes one field
 * through `writeFile` (the normal save path) and nothing for a card already in
 * place; open tabs reload, and a dirty one is asked first; the move is
 * announced; failures toast rather than throw; and ⌘Z's undo restores the
 * exact previous text, falls back to the field when the note was edited
 * since, and leaves a note alone whose field moved on.
 *
 * The Calendar's reschedule (#2703) is the same store generalised to "set
 * these fields": the start and end in ONE write (so one Local History
 * revision and one undo entry), their precision and written form kept, CRLF
 * and a BOM preserved, refusals spoken without a write, and ⌘Z per surface
 * with a per-field check.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  disk: new Map<string, string>(),
  writeFile: vi.fn(),
  isPathDirty: vi.fn((_p: string) => false),
  reloadTabFromDisk: vi.fn(),
  showConfirm: vi.fn(),
  announce: vi.fn(),
  push: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    notebase: {
      readFile: (p: string) => (h.disk.has(p) ? Promise.resolve(h.disk.get(p)!) : Promise.reject(new Error(`ENOENT: ${p}`))),
      writeFile: h.writeFile,
    },
  },
}));
vi.mock('../../../src/renderer/lib/stores/editor.svelte', () => ({
  getEditorStore: () => ({ isPathDirty: h.isPathDirty, reloadTabFromDisk: h.reloadTabFromDisk }),
}));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({
  getDialogStore: () => ({ showConfirm: h.showConfirm }),
}));
vi.mock('../../../src/renderer/lib/stores/announcer.svelte', () => ({ announce: h.announce }));
// Mocked rather than `silenceLogTags`: `freshStore` re-imports, which a
// per-tag override on the original logger instance wouldn't reach.
vi.mock('../../../src/shared/logger', () => ({ logger: () => ({ warn: h.warn, error: h.warn, info: vi.fn(), debug: vi.fn() }) }));
vi.mock('../../../src/renderer/lib/stores/toasts.svelte', () => ({ getToastStore: () => ({ push: h.push }) }));

import { CONFIRM_KEYS } from '../../../src/renderer/lib/confirm-keys';
import type { MoveTarget } from '../../../src/shared/objects/kanban-move';

const DONE: MoveTarget = { value: 'done', label: 'done', kind: 'option' };
const NONE: MoveTarget = { value: null, label: 'No value', kind: 'no-value' };
const SHED = '---\ntype: project\nstatus: active # keep\nowner: Ann\n---\n# Garden Shed\n';
const BOAT = '---\ntype: project\n---\n# Someday Boat\n';

/** A fresh store module per test: the undo stack is module state, and the
 *  store deliberately has no reset API (#1944). */
async function freshStore() {
  vi.resetModules();
  return (await import('../../../src/renderer/lib/stores/kanban-moves.svelte')).getKanbanMoveStore();
}

beforeEach(() => {
  vi.clearAllMocks();
  h.disk.clear();
  h.disk.set('shed.md', SHED);
  h.disk.set('boat.md', BOAT);
  h.writeFile.mockImplementation((p: string, c: string) => { h.disk.set(p, c); return Promise.resolve(); });
  h.isPathDirty.mockReturnValue(false);
  h.showConfirm.mockResolvedValue(true);
});

describe('kanban-moves store (#2603)', () => {
  it('writes the one field through writeFile, reloads the open tab, announces, bumps revision', async () => {
    const store = await freshStore();
    const paths = await store.moveCards([{ path: 'shed.md', title: 'Garden Shed' }], 'status', DONE);

    expect(paths).toEqual(['shed.md']);
    expect(h.writeFile).toHaveBeenCalledOnce();
    expect(h.disk.get('shed.md')).toBe(SHED.replace('status: active', 'status: done'));
    expect(h.reloadTabFromDisk).toHaveBeenCalledWith('shed.md');
    expect(h.showConfirm).not.toHaveBeenCalled();
    expect(h.announce).toHaveBeenCalledWith('Moved Garden Shed to done.');
    expect(store.revision).toBe(1);
    expect(store.lastMove).toEqual({ seq: 1, paths: ['shed.md'] });
    expect(store.canUndo).toBe(true);
  });

  it('No value removes the key; a card already there is not written', async () => {
    const store = await freshStore();
    await store.moveCards([{ path: 'shed.md', title: 'Garden Shed' }, { path: 'boat.md', title: 'Someday Boat' }], 'status', NONE);
    expect(h.writeFile).toHaveBeenCalledOnce();
    expect(h.disk.get('shed.md')).toBe('---\ntype: project\nowner: Ann\n---\n# Garden Shed\n');
    expect(h.disk.get('boat.md')).toBe(BOAT);
    expect(h.announce).toHaveBeenCalledWith('Moved Garden Shed to No value.');
  });

  it('a no-op move writes, announces and records nothing', async () => {
    const store = await freshStore();
    const paths = await store.moveCards([{ path: 'boat.md', title: 'Someday Boat' }], 'status', NONE);
    expect(paths).toEqual([]);
    expect(h.writeFile).not.toHaveBeenCalled();
    expect(h.announce).not.toHaveBeenCalled();
    expect(store.revision).toBe(0);
    expect(store.canUndo).toBe(false);
  });

  it('an open tab with unsaved edits gets the conflict prompt; keeping the edits skips the reload', async () => {
    const store = await freshStore();
    h.isPathDirty.mockReturnValue(true);
    h.showConfirm.mockResolvedValue(false);
    await store.moveCards([{ path: 'shed.md', title: 'Garden Shed' }], 'status', DONE);
    expect(h.showConfirm).toHaveBeenCalledWith(expect.stringContaining('"shed.md" is open with unsaved edits'), CONFIRM_KEYS.rewriteConflict, 'Load disk');
    expect(h.reloadTabFromDisk).not.toHaveBeenCalled();

    h.showConfirm.mockResolvedValue(true);
    await store.moveCards([{ path: 'shed.md', title: 'Garden Shed' }], 'status', NONE);
    expect(h.reloadTabFromDisk).toHaveBeenCalledWith('shed.md');
  });

  it('reports a failed write with a toast and keeps going', async () => {
    const store = await freshStore();
    h.writeFile.mockImplementationOnce(() => Promise.reject(new Error('EACCES')));
    const paths = await store.moveCards(
      [{ path: 'shed.md', title: 'Garden Shed' }, { path: 'boat.md', title: 'Someday Boat' }], 'status', DONE,
    );
    expect(paths).toEqual(['boat.md']);
    expect(h.push).toHaveBeenCalledWith({ message: 'Couldn’t move Garden Shed: EACCES' });
    expect(h.warn).toHaveBeenCalledWith('kanban move failed for', 'shed.md', expect.any(Error));
    expect(h.announce).toHaveBeenCalledWith('Moved Someday Boat to done.');
  });

  it('refuses a note whose frontmatter does not parse', async () => {
    const store = await freshStore();
    h.disk.set('bad.md', '---\nstatus: [x\n---\n');
    await store.moveCards([{ path: 'bad.md', title: 'Bad' }], 'status', DONE);
    expect(h.writeFile).not.toHaveBeenCalled();
    expect(h.push).toHaveBeenCalledWith({ message: expect.stringContaining('YAML error') });
  });

  describe('undo', () => {
    it('writes the previous text back byte for byte, announces, and empties the stack', async () => {
      const store = await freshStore();
      await store.moveCards([{ path: 'shed.md', title: 'Garden Shed' }], 'status', DONE);
      h.reloadTabFromDisk.mockClear();
      const paths = await store.undoLastMove();
      expect(paths).toEqual(['shed.md']);
      expect(h.disk.get('shed.md')).toBe(SHED);
      expect(h.announce).toHaveBeenLastCalledWith('Undid the move: Garden Shed back to active.');
      expect(h.reloadTabFromDisk).toHaveBeenCalledWith('shed.md');
      expect(store.canUndo).toBe(false);
      expect(store.lastMove?.paths).toEqual(['shed.md']);
    });

    it('walks back moves newest first', async () => {
      const store = await freshStore();
      await store.moveCards([{ path: 'shed.md', title: 'Garden Shed' }], 'status', DONE);
      await store.moveCards([{ path: 'shed.md', title: 'Garden Shed' }], 'status', NONE);
      await store.undoLastMove();
      expect(groupLine()).toBe('status: done # keep');
      await store.undoLastMove();
      expect(h.disk.get('shed.md')).toBe(SHED);
    });

    it('puts only the field back when the note was edited since the move', async () => {
      const store = await freshStore();
      await store.moveCards([{ path: 'shed.md', title: 'Garden Shed' }], 'status', DONE);
      h.disk.set('shed.md', `${h.disk.get('shed.md')!}\nA new paragraph.\n`);
      await store.undoLastMove();
      expect(h.disk.get('shed.md')).toBe(`${SHED}\nA new paragraph.\n`);
    });

    it('leaves a note alone whose field changed since, and says so', async () => {
      const store = await freshStore();
      await store.moveCards([{ path: 'shed.md', title: 'Garden Shed' }], 'status', DONE);
      h.disk.set('shed.md', SHED.replace('status: active', 'status: paused'));
      h.writeFile.mockClear();
      expect(await store.undoLastMove()).toEqual([]);
      expect(h.writeFile).not.toHaveBeenCalled();
      expect(h.announce).toHaveBeenLastCalledWith('Nothing undone: Garden Shed changed since the move.');
    });

    it('with nothing to undo, says so and writes nothing', async () => {
      const store = await freshStore();
      expect(await store.undoLastMove()).toEqual([]);
      expect(h.writeFile).not.toHaveBeenCalled();
      expect(h.announce).toHaveBeenCalledWith('Nothing to undo on the board.');
    });
  });
});

function groupLine(): string | undefined {
  return h.disk.get('shed.md')!.split('\n').find((l) => l.startsWith('status:'));
}

describe('reschedule (#2703)', () => {
  const TRIP = '\uFEFF---\r\ntype: event\r\ndate: 2026-10-09\r\nend: "2026-10-14" # quoted\r\nplace: Rome\r\n---\r\n# Trip\r\n';
  const CALL = '---\ntype: event\ndate: 2026-10-05T09:00:05.5+05:30\n---\n# Call\n';
  const ev = (path: string, title: string) => ({ path, title });
  const FIELDS = { start: 'date', end: 'end' };
  const LABELS = { to: 'Sunday, 11 October 2026', back: 'Friday, 9 October 2026' };

  it('writes the start and the end in ONE save, keeping BOM, CRLF, quoting and duration; announces; reloads the tab', async () => {
    const store = await freshStore();
    h.disk.set('trip.md', TRIP);
    const out = await store.rescheduleEvent(ev('trip.md', 'Trip'), FIELDS, 2, LABELS);
    expect(out).toEqual({ ok: true, paths: ['trip.md'] });
    expect(h.writeFile).toHaveBeenCalledOnce();
    expect(h.disk.get('trip.md')).toBe(TRIP.replace('date: 2026-10-09', 'date: 2026-10-11').replace('"2026-10-14"', '"2026-10-16"'));
    expect(h.announce).toHaveBeenCalledWith('Moved Trip to Sunday, 11 October 2026.');
    expect(h.reloadTabFromDisk).toHaveBeenCalledWith('trip.md');
    expect(store.revision).toBe(1);
    expect(store.canUndoReschedule).toBe(true);
    expect(store.canUndo).toBe(false); // the board's ⌘Z has nothing
  });

  it('a datetime keeps its time, fraction and offset verbatim; with no end written only the start changes', async () => {
    const store = await freshStore();
    h.disk.set('call.md', CALL);
    await store.rescheduleEvent(ev('call.md', 'Call'), FIELDS, 30, LABELS);
    expect(h.disk.get('call.md')).toBe(CALL.replace('2026-10-05T', '2026-11-04T'));
  });

  it('reads the dates as written on disk, and crosses a leap day without clamping', async () => {
    const store = await freshStore();
    h.disk.set('leap.md', '---\ndate: 2028-02-28\nend: 2028-02-29\n---\n');
    await store.rescheduleEvent(ev('leap.md', 'Leap'), FIELDS, 1, LABELS);
    expect(h.disk.get('leap.md')).toBe('---\ndate: 2028-02-29\nend: 2028-03-01\n---\n');
  });

  it('refuses a month-only start or end: says why, writes and records nothing', async () => {
    const store = await freshStore();
    h.disk.set('moon.md', '---\ndate: 1969-07\n---\n');
    h.disk.set('launch.md', '---\ndate: 2026-10-20\nend: 2026-11\n---\n');
    expect(await store.rescheduleEvent(ev('moon.md', 'Moon'), FIELDS, 1, LABELS))
      .toEqual({ ok: false, refusal: '1969-07 has no day to move; open it to edit.' });
    expect(await store.rescheduleEvent(ev('launch.md', 'Launch'), FIELDS, 1, LABELS))
      .toEqual({ ok: false, refusal: 'Launch ends 2026-11, which has no day to move; open it to edit.' });
    expect(h.announce).toHaveBeenCalledWith('1969-07 has no day to move; open it to edit.');
    expect(h.writeFile).not.toHaveBeenCalled();
    expect(store.canUndoReschedule).toBe(false);
  });

  it('a YAML error or a failed write toasts instead of throwing', async () => {
    const store = await freshStore();
    h.disk.set('bad.md', '---\ndate: [x\n---\n');
    expect(await store.rescheduleEvent(ev('bad.md', 'Bad'), FIELDS, 1, LABELS)).toEqual({ ok: false, refusal: null });
    expect(h.push).toHaveBeenCalledWith({ message: expect.stringContaining('YAML error') });
    h.disk.set('trip.md', TRIP);
    h.writeFile.mockImplementationOnce(() => Promise.reject(new Error('EACCES')));
    expect(await store.rescheduleEvent(ev('trip.md', 'Trip'), FIELDS, 1, LABELS)).toEqual({ ok: false, refusal: null });
    expect(h.push).toHaveBeenLastCalledWith({ message: 'Couldn’t move Trip: EACCES' });
  });

  describe('undo', () => {
    it('writes the previous text back byte for byte, in one save', async () => {
      const store = await freshStore();
      h.disk.set('trip.md', TRIP);
      await store.rescheduleEvent(ev('trip.md', 'Trip'), FIELDS, 2, LABELS);
      h.writeFile.mockClear();
      expect(await store.undoLastMove('calendar')).toEqual(['trip.md']);
      expect(h.writeFile).toHaveBeenCalledOnce();
      expect(h.disk.get('trip.md')).toBe(TRIP);
      expect(h.announce).toHaveBeenLastCalledWith('Undid the move: Trip back to Friday, 9 October 2026.');
    });

    it('each surface undoes its own moves: ⌘Z on a calendar never undoes a board move', async () => {
      const store = await freshStore();
      h.disk.set('trip.md', TRIP);
      await store.rescheduleEvent(ev('trip.md', 'Trip'), FIELDS, 2, LABELS);
      await store.moveCards([{ path: 'shed.md', title: 'Garden Shed' }], 'status', DONE);
      await store.undoLastMove('calendar');
      expect(h.disk.get('trip.md')).toBe(TRIP);
      expect(groupLine()).toBe('status: done # keep');
      expect(await store.undoLastMove('calendar')).toEqual([]);
      expect(h.announce).toHaveBeenLastCalledWith('Nothing to undo on the calendar.');
      await store.undoLastMove();
      expect(h.disk.get('shed.md')).toBe(SHED);
    });

    it('puts both fields back when only the body changed since', async () => {
      const store = await freshStore();
      h.disk.set('trip.md', TRIP);
      await store.rescheduleEvent(ev('trip.md', 'Trip'), FIELDS, 2, LABELS);
      h.disk.set('trip.md', `${h.disk.get('trip.md')!}More notes.\r\n`);
      await store.undoLastMove('calendar');
      expect(h.disk.get('trip.md')).toBe(`${TRIP}More notes.\r\n`);
    });

    it('leaves the note alone when EITHER moved field changed since (the per-field check)', async () => {
      const store = await freshStore();
      h.disk.set('trip.md', TRIP);
      await store.rescheduleEvent(ev('trip.md', 'Trip'), FIELDS, 2, LABELS);
      const edited = h.disk.get('trip.md')!.replace('"2026-10-16"', '"2026-10-20"');
      h.disk.set('trip.md', edited);
      h.writeFile.mockClear();
      expect(await store.undoLastMove('calendar')).toEqual([]);
      expect(h.writeFile).not.toHaveBeenCalled();
      expect(h.disk.get('trip.md')).toBe(edited);
      expect(h.announce).toHaveBeenLastCalledWith('Nothing undone: Trip changed since the move.');
    });
  });
});

describe('retime by minutes (#2953)', () => {
  const STANDUP = '---\ntype: event\ndate: 2026-10-07T09:00\nend: 2026-10-07T09:30 # short\n---\n# Standup\n';
  const CALL = '---\ntype: event\ndate: 2026-10-07T14:00\n---\n# Call\n';
  const ev = (path: string, title: string) => ({ path, title });
  const FIELDS = { start: 'date', end: 'end' };
  const at = (w: { start: string; end: string | null }) => w.start.slice(11, 16);
  const labels = { to: at, back: '9:00' };

  it('moves start and end in ONE save, keeping comments; announces; ⌘Z puts it back', async () => {
    const store = await freshStore();
    h.disk.set('standup.md', STANDUP);
    expect(await store.retimeEvent(ev('standup.md', 'Standup'), FIELDS, 75, 'move', labels)).toEqual({ ok: true, paths: ['standup.md'] });
    expect(h.writeFile).toHaveBeenCalledOnce();
    expect(h.disk.get('standup.md')).toBe(STANDUP.replace('T09:00', 'T10:15').replace('T09:30', 'T10:45'));
    expect(h.announce).toHaveBeenCalledWith('Moved Standup to 10:15.');
    expect(store.canUndoReschedule).toBe(true);
    await store.undoLastMove('calendar');
    expect(h.disk.get('standup.md')).toBe(STANDUP);
  });

  it('a resize writes only the end, and creates one never written', async () => {
    const store = await freshStore();
    h.disk.set('standup.md', STANDUP);
    h.disk.set('call.md', CALL);
    const endAt = { to: (w: { start: string; end: string | null }) => `at ${w.end!.slice(11, 16)}`, back: 'no end' };
    await store.retimeEvent(ev('standup.md', 'Standup'), FIELDS, 15, 'resize', endAt);
    expect(h.disk.get('standup.md')).toBe(STANDUP.replace('T09:30', 'T09:45'));
    expect(h.announce).toHaveBeenLastCalledWith('Standup now ends at 09:45.');
    await store.retimeEvent(ev('call.md', 'Call'), FIELDS, 30, 'resize', endAt);
    expect(h.disk.get('call.md')).toBe('---\ntype: event\ndate: 2026-10-07T14:00\nend: 2026-10-07T15:00\n---\n# Call\n');
    await store.undoLastMove('calendar');
    expect(h.disk.get('call.md')).toBe(CALL);
  });

  it('refuses aloud: a start with no time, an end before the start, a view with no end field', async () => {
    const store = await freshStore();
    h.disk.set('day.md', '---\ndate: 2026-10-07\n---\n');
    h.disk.set('standup.md', STANDUP);
    expect(await store.retimeEvent(ev('day.md', 'Holiday'), FIELDS, 30, 'move', labels))
      .toEqual({ ok: false, refusal: '2026-10-07 has no time to move; open it to edit.' });
    expect(await store.retimeEvent(ev('standup.md', 'Standup'), FIELDS, -45, 'resize', labels))
      .toEqual({ ok: false, refusal: 'Standup can’t end before it starts.' });
    expect(await store.retimeEvent(ev('standup.md', 'Standup'), { start: 'date', end: null }, 15, 'resize', labels))
      .toEqual({ ok: false, refusal: 'Standup has no end to change in this view.' });
    expect(h.writeFile).not.toHaveBeenCalled();
    expect(h.announce).toHaveBeenCalledTimes(3);
  });

  it('writes with the plugin\'s cause, for Local History', async () => {
    const store = await freshStore();
    h.disk.set('standup.md', STANDUP);
    await store.retimeEvent(ev('standup.md', 'Standup'), FIELDS, 15, 'move', labels, { cause: 'Moved by Calendar' });
    expect(h.writeFile).toHaveBeenCalledWith('standup.md', expect.any(String), { cause: 'Moved by Calendar' });
  });
});

describe('reschedule a group (#2938)', () => {
  const A = '---\ntype: event\ndate: 2026-10-05\n---\n# Dentist\n';
  const B = '---\ntype: event\ndate: 2026-10-07\nend: 2026-10-09\n---\n# Trip\n';
  const MONTH = '---\ntype: event\ndate: 2026-10\n---\n# Offsite\n';
  const FIELDS = { start: 'date', end: 'end' };
  const LABELS = { to: 'Wednesday, 7 October 2026', back: 'Monday, 5 October 2026' };
  const ev = (path: string, title: string) => ({ path, title });
  const sentence = async () => (await import('../../../src/shared/calendar/reschedule-refusal')).groupRefusal;

  it('moves every event by the same days, keeping their spacing, as ONE undo step', async () => {
    const store = await freshStore();
    h.disk.set('a.md', A);
    h.disk.set('b.md', B);
    const out = await store.rescheduleEvents([ev('a.md', 'Dentist'), ev('b.md', 'Trip')], 'a.md', FIELDS, 2, LABELS, await sentence());
    expect(out).toEqual({ ok: true, paths: ['a.md', 'b.md'] });
    expect(h.disk.get('a.md')).toContain('date: 2026-10-07');
    expect(h.disk.get('b.md')).toContain('date: 2026-10-09\nend: 2026-10-11');
    expect(h.announce).toHaveBeenLastCalledWith('Moved 2 events, Dentist to Wednesday, 7 October 2026.');
    expect(store.revision).toBe(1);
    // One ⌘Z puts both back.
    expect(await store.undoLastMove('calendar')).toEqual(['a.md', 'b.md']);
    expect(h.disk.get('a.md')).toBe(A);
    expect(h.disk.get('b.md')).toBe(B);
    expect(h.announce).toHaveBeenLastCalledWith('Undid the move: 2 events.');
    expect(store.canUndoReschedule).toBe(false);
  });

  it('moves none when any can\'t move, and says which', async () => {
    const store = await freshStore();
    h.disk.set('a.md', A);
    h.disk.set('m.md', MONTH);
    const out = await store.rescheduleEvents([ev('a.md', 'Dentist'), ev('m.md', 'Offsite')], 'a.md', FIELDS, 2, LABELS, await sentence());
    expect(out.ok).toBe(false);
    const refusal = (out as { refusal: string }).refusal;
    expect(refusal).toBe("Can't move these 2 events together. Offsite: 2026-10 has no day to move; open it to edit. Deselect it to move the rest.");
    expect(h.announce).toHaveBeenLastCalledWith(refusal);
    expect(h.writeFile).not.toHaveBeenCalled();
    expect(h.disk.get('a.md')).toBe(A);
    expect(store.canUndoReschedule).toBe(false);
  });
});
