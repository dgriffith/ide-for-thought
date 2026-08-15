/**
 * Frame sequencing for the File ▸ maintenance operations (#1814).
 *
 * The renderer clears its overlay on the terminal frame and nothing else, so
 * "exactly one terminal frame, always" is the invariant that keeps a failed
 * rebuild from leaving the app wedged behind a spinner. These assert it holds
 * on the success path, the failure path, and the non-Error-throw path.
 */
import { describe, it, expect, vi } from 'vitest';
import { runMaintenance, pluralizeNotes } from '../../src/main/maintenance';
import type { MaintenanceProgress } from '../../src/shared/maintenance';
import { maintenanceLabel, maintenanceOutcomeMessage } from '../../src/shared/maintenance';

function collector() {
  const frames: MaintenanceProgress[] = [];
  return { frames, emit: (p: MaintenanceProgress) => { frames.push(p); } };
}

const BASE = {
  task: 'rebuildIndexes' as const,
  label: 'Rebuilding indexes',
  style: 'blocking' as const,
};

describe('runMaintenance', () => {
  it('opens with a running frame before the work starts', async () => {
    const { frames, emit } = collector();
    let framesAtStart = 0;

    await runMaintenance({
      ...BASE,
      emit,
      run: async () => { framesAtStart = frames.length; return 3; },
      summary: (n) => `Rebuilt ${n}`,
    });

    // The affordance is on screen before the slow part, not after it.
    expect(framesAtStart).toBe(1);
    expect(frames[0]).toMatchObject({ running: true, label: 'Rebuilding indexes' });
  });

  it('forwards determinate progress as the work reports it', async () => {
    const { frames, emit } = collector();

    await runMaintenance({
      ...BASE,
      emit,
      run: async (report) => { report(1, 10); report(7, 10); return 10; },
      summary: (n) => `Rebuilt indexes — ${pluralizeNotes(n)}`,
    });

    const running = frames.filter((f) => f.running);
    expect(running.map((f) => (f.running ? [f.done, f.total] : null))).toEqual([
      [undefined, undefined], [1, 10], [7, 10],
    ]);
  });

  it('ends with exactly one terminal frame carrying the summary', async () => {
    const { frames, emit } = collector();

    const result = await runMaintenance({
      ...BASE,
      emit,
      run: async () => 210,
      summary: (n) => `Rebuilt indexes — ${pluralizeNotes(n)}`,
    });

    expect(result).toBe(210);
    const terminal = frames.filter((f) => !f.running);
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({
      running: false,
      outcome: { ok: true, summary: 'Rebuilt indexes — 210 notes' },
    });
  });

  it('reports a failure instead of throwing it into a menu click', async () => {
    // The handlers are `click:` callbacks — a rejection here had nowhere to go,
    // so a failed rebuild was indistinguishable from a no-op menu item.
    const { frames, emit } = collector();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runMaintenance({
      ...BASE,
      emit,
      run: async () => { throw new Error('ENOSPC: no space left on device'); },
      summary: () => 'unreachable',
    });

    expect(result).toBeUndefined();
    const terminal = frames.filter((f) => !f.running);
    expect(terminal).toHaveLength(1);
    expect(terminal[0]).toMatchObject({
      running: false,
      outcome: { ok: false, error: 'ENOSPC: no space left on device' },
    });
  });

  it('still terminates when something throws a non-Error', async () => {
    const { frames, emit } = collector();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    await runMaintenance({
      ...BASE,
      emit,
      run: async () => {
        // The point of the case: main can't assume a thrown value is an Error.
        // eslint-disable-next-line @typescript-eslint/only-throw-error
        throw 'just a string';
      },
      summary: () => 'unreachable',
    });

    expect(frames.filter((f) => !f.running)).toHaveLength(1);
  });
});

describe('frame → display text', () => {
  it('shows a count only when the operation knows its own size', () => {
    expect(maintenanceLabel({ ...BASE, running: true, done: 7, total: 10 }))
      .toBe('Rebuilding indexes 7/10…');
    expect(maintenanceLabel({ ...BASE, running: true })).toBe('Rebuilding indexes…');
    // A zero total would render "0/0", which reads as broken rather than as
    // "starting up".
    expect(maintenanceLabel({ ...BASE, running: true, done: 0, total: 0 }))
      .toBe('Rebuilding indexes…');
  });

  it('names the operation when reporting a failure', () => {
    expect(maintenanceOutcomeMessage({
      ...BASE, running: false, outcome: { ok: false, error: 'disk full' },
    })).toBe('Rebuilding indexes failed: disk full');
  });

  it('passes a success summary through as written', () => {
    expect(maintenanceOutcomeMessage({
      ...BASE, running: false, outcome: { ok: true, summary: 'Rebuilt indexes — 1 note' },
    })).toBe('Rebuilt indexes — 1 note');
  });

  it('pluralizes the note count', () => {
    expect(pluralizeNotes(1)).toBe('1 note');
    expect(pluralizeNotes(0)).toBe('0 notes');
    expect(pluralizeNotes(210)).toBe('210 notes');
  });
});
