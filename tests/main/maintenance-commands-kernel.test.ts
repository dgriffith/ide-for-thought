/**
 * The kernel-manager contract of `interruptCell` / `restartKernel` (#2407).
 *
 * `maintenance-commands.test.ts` runs both against the real kernel manager —
 * no kernel, and (with `python3` on PATH) a live one. What a real kernel can't
 * be made to do on demand is fail: a `signal-failed` interrupt, or a restart
 * that throws. Those are the paths where the command must report a failure
 * frame rather than reject (the menu caller has nobody to catch), so the kernel
 * manager — the module that owns the Python child process — is stubbed here and
 * nowhere else.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MaintenanceProgress, MaintenanceFinished } from '../../src/shared/maintenance';

const kernel = vi.hoisted(() => ({
  interruptKernel: vi.fn(),
  restartKernel: vi.fn(),
}));
vi.mock('../../src/main/compute/python-kernel', () => kernel);

import { interruptCell, restartKernel } from '../../src/main/maintenance-commands';

function collector() {
  const frames: MaintenanceProgress[] = [];
  return { frames, emit: (p: MaintenanceProgress) => { frames.push(p); } };
}

function terminal(frames: MaintenanceProgress[]): MaintenanceFinished {
  const done = frames.filter((f): f is MaintenanceFinished => !f.running);
  expect(done).toHaveLength(1);
  return done[0]!;
}

const ROOT = '/projects/kernel-contract';

beforeEach(() => {
  kernel.interruptKernel.mockReset();
  kernel.restartKernel.mockReset();
});

describe('interruptCell → kernel manager', () => {
  it('interrupts the kernel of the project it was asked about', async () => {
    kernel.interruptKernel.mockReturnValue({ ok: true });

    await interruptCell(ROOT, collector().emit);

    expect(kernel.interruptKernel).toHaveBeenCalledWith(ROOT);
  });

  it('interrupts exactly once', async () => {
    kernel.interruptKernel.mockReturnValue({ ok: true });

    await interruptCell(ROOT, collector().emit);

    expect(kernel.interruptKernel).toHaveBeenCalledTimes(1);
  });

  it('never restarts the kernel — an interrupt keeps the namespaces', async () => {
    kernel.interruptKernel.mockReturnValue({ ok: true });

    await interruptCell(ROOT, collector().emit);

    expect(kernel.restartKernel).not.toHaveBeenCalled();
  });

  it.each([
    [{ ok: true }, 'Interrupted the running cell'],
    [{ ok: false, reason: 'no-kernel' }, 'No Python kernel is running — nothing to interrupt'],
    [{ ok: false, reason: 'unsupported-platform' }, 'Interrupting a cell isn\'t supported on Windows'],
    [{ ok: false, reason: 'signal-failed' }, 'Couldn\'t interrupt the running cell'],
  ])('reports %o as "%s"', async (result, summary) => {
    kernel.interruptKernel.mockReturnValue(result);
    const { frames, emit } = collector();

    await interruptCell(ROOT, emit);

    expect(terminal(frames).outcome).toEqual({ ok: true, summary });
  });

  it('turns a throwing kernel manager into a failure frame instead of rejecting', async () => {
    kernel.interruptKernel.mockImplementation(() => { throw new Error('kernel table corrupt'); });
    const { frames, emit } = collector();

    await expect(interruptCell(ROOT, emit)).resolves.toBeUndefined();
    expect(terminal(frames).outcome).toEqual({ ok: false, error: 'kernel table corrupt' });
  });
});

describe('restartKernel → kernel manager', () => {
  it('restarts the kernel of the project it was asked about', async () => {
    kernel.restartKernel.mockResolvedValue(undefined);

    await restartKernel(ROOT, collector().emit);

    expect(kernel.restartKernel).toHaveBeenCalledWith(ROOT);
  });

  it('waits for the restart to finish before reporting it done', async () => {
    let finish!: () => void;
    kernel.restartKernel.mockReturnValue(new Promise<void>((r) => { finish = r; }));
    const { frames, emit } = collector();

    const pending = restartKernel(ROOT, emit);
    await Promise.resolve();
    expect(frames.some((f) => !f.running)).toBe(false);
    finish();
    await pending;

    expect(terminal(frames).outcome).toEqual({ ok: true, summary: 'Python kernel restarted' });
  });

  it('turns a failed restart into a failure frame instead of rejecting', async () => {
    kernel.restartKernel.mockRejectedValue(new Error('SIGKILL refused'));
    const { frames, emit } = collector();

    await expect(restartKernel(ROOT, emit)).resolves.toBeUndefined();
    expect(terminal(frames).outcome).toEqual({ ok: false, error: 'SIGKILL refused' });
  });
});
