/**
 * Per-project Python trust gate (#373).
 *
 * The wrapper consults `api.compute.getPythonTrust` before firing
 * `runCell` for Python; if untrusted, prompts; if confirmed,
 * persists trust + executes; if cancelled, returns an error result.
 * Non-Python languages pass straight through.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runCellWithTrust } from '../../src/renderer/lib/compute/run-cell-with-trust';
import { CONFIRM_KEYS } from '../../src/renderer/lib/confirm-keys';

const trustState = { trusted: false };
const calls = {
  getTrust: 0,
  setTrust: [] as boolean[],
  runCell: [] as Array<{ language: string; code: string; notePath?: string }>,
};

vi.mock('../../src/renderer/lib/ipc/client', () => ({
  api: {
    compute: {
      getPythonTrust: vi.fn(() => {
        calls.getTrust += 1;
        return Promise.resolve(trustState.trusted);
      }),
      setPythonTrust: vi.fn((trusted: boolean) => {
        trustState.trusted = trusted;
        calls.setTrust.push(trusted);
        return Promise.resolve();
      }),
      runCell: vi.fn((language: string, code: string, notePath?: string) => {
        calls.runCell.push({ language, code, notePath });
        return Promise.resolve({
          ok: true,
          output: { type: 'text', value: `${language}-result` },
        });
      }),
    },
  },
}));

beforeEach(() => {
  trustState.trusted = false;
  calls.getTrust = 0;
  calls.setTrust = [];
  calls.runCell = [];
});

describe('runCellWithTrust (#373)', () => {
  it('non-Python (sparql) bypasses the trust check entirely', async () => {
    const showConfirm = vi.fn(() => Promise.resolve(true));
    const r = await runCellWithTrust('sparql', 'SELECT *', 'note.md', { showConfirm });
    expect(r.ok).toBe(true);
    expect(showConfirm).not.toHaveBeenCalled();
    expect(calls.getTrust).toBe(0);
    expect(calls.runCell).toHaveLength(1);
    expect(calls.runCell[0].language).toBe('sparql');
  });

  it('non-Python (sql) bypasses too', async () => {
    const showConfirm = vi.fn(() => Promise.resolve(true));
    await runCellWithTrust('sql', 'select 1', 'note.md', { showConfirm });
    expect(showConfirm).not.toHaveBeenCalled();
  });

  it('Python with no prior trust shows the prompt; clicking Run records trust + executes', async () => {
    const showConfirm = vi.fn(() => Promise.resolve(true));
    const r = await runCellWithTrust('python', 'print("hi")', 'note.md', { showConfirm });
    expect(r.ok).toBe(true);
    expect(showConfirm).toHaveBeenCalledTimes(1);
    // Prompt key matches the dedicated trust key, hideDontAskAgain=true.
    const [, key, label, options] = showConfirm.mock.calls[0];
    expect(key).toBe(CONFIRM_KEYS.pythonTrust);
    expect(label).toBe('Run');
    expect(options).toEqual({ hideDontAskAgain: true });
    // Trust was set true; cell executed.
    expect(calls.setTrust).toEqual([true]);
    expect(calls.runCell).toHaveLength(1);
  });

  it('Python with prior trust skips the prompt and executes immediately', async () => {
    trustState.trusted = true;
    const showConfirm = vi.fn(() => Promise.resolve(true));
    const r = await runCellWithTrust('python', 'print("hi")', 'note.md', { showConfirm });
    expect(r.ok).toBe(true);
    expect(showConfirm).not.toHaveBeenCalled();
    // setTrust was NOT called again — the gate only writes the flag
    // on the consent transition, not on every subsequent run.
    expect(calls.setTrust).toEqual([]);
    expect(calls.runCell).toHaveLength(1);
  });

  it('Python with no prior trust + Cancel blocks execution and does not record consent', async () => {
    const showConfirm = vi.fn(() => Promise.resolve(false));
    const r = await runCellWithTrust('python', 'print("hi")', 'note.md', { showConfirm });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/declined/);
    expect(calls.setTrust).toEqual([]);
    expect(calls.runCell).toHaveLength(0);
  });

  it('after consent in cell A, cell B in the same session does not re-prompt', async () => {
    const showConfirm = vi.fn(() => Promise.resolve(true));
    await runCellWithTrust('python', 'a = 1', 'note.md', { showConfirm });
    await runCellWithTrust('python', 'b = 2', 'note.md', { showConfirm });
    expect(showConfirm).toHaveBeenCalledTimes(1);
    expect(calls.runCell).toHaveLength(2);
  });
});
