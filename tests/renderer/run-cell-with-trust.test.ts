/**
 * Per-project compute trust gate (#373, #1325).
 *
 * The wrapper consults `api.compute.getPythonTrust` before firing
 * `runCell` for any executable language (python / sql / sparql); if
 * untrusted, prompts; if confirmed, persists trust + executes; if
 * cancelled, returns an error result. Non-executable languages pass
 * straight through, and a single consent covers all three.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runCellWithTrust, ensureComputeTrust } from '../../src/renderer/lib/compute/run-cell-with-trust';
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

describe('runCellWithTrust (#373, #1325)', () => {
  it('SQL is trust-gated: untrusted + Cancel blocks execution', async () => {
    const showConfirm = vi.fn(() => Promise.resolve(false));
    const r = await runCellWithTrust('sql', "SELECT * FROM read_text('/etc/passwd')", 'note.md', { showConfirm });
    expect(r.ok).toBe(false);
    expect(showConfirm).toHaveBeenCalledTimes(1);
    expect(calls.runCell).toHaveLength(0);
  });

  it('SQL is trust-gated: untrusted + Run records consent and executes', async () => {
    const showConfirm = vi.fn(() => Promise.resolve(true));
    const r = await runCellWithTrust('sql', 'select 1', 'note.md', { showConfirm });
    expect(r.ok).toBe(true);
    expect(showConfirm).toHaveBeenCalledTimes(1);
    expect(calls.setTrust).toEqual([true]);
    expect(calls.runCell).toHaveLength(1);
    expect(calls.runCell[0].language).toBe('sql');
  });

  it('SPARQL is trust-gated: untrusted shows the prompt', async () => {
    const showConfirm = vi.fn(() => Promise.resolve(true));
    await runCellWithTrust('sparql', 'SELECT *', 'note.md', { showConfirm });
    expect(showConfirm).toHaveBeenCalledTimes(1);
    expect(calls.getTrust).toBe(1);
    expect(calls.runCell[0].language).toBe('sparql');
  });

  it('a single consent covers every executable language (python, then sql, then sparql)', async () => {
    const showConfirm = vi.fn(() => Promise.resolve(true));
    await runCellWithTrust('python', 'a = 1', 'note.md', { showConfirm });
    await runCellWithTrust('sql', 'select 1', 'note.md', { showConfirm });
    await runCellWithTrust('sparql', 'SELECT *', 'note.md', { showConfirm });
    // Prompted once; the persisted trust flag suppresses the rest.
    expect(showConfirm).toHaveBeenCalledTimes(1);
    expect(calls.runCell).toHaveLength(3);
  });

  it('Python aliases (py / python3, any case) are gated too, not just "python"', async () => {
    for (const lang of ['py', 'python3', 'PYTHON', 'Sql']) {
      trustState.trusted = false;
      calls.setTrust = [];
      const showConfirm = vi.fn(() => Promise.resolve(false));
      const r = await runCellWithTrust(lang, 'x', 'note.md', { showConfirm });
      expect(r.ok, `${lang} must be gated`).toBe(false);
      expect(showConfirm).toHaveBeenCalledTimes(1);
    }
  });

  it('a non-executable language passes straight through (no gate)', async () => {
    const showConfirm = vi.fn(() => Promise.resolve(true));
    const r = await runCellWithTrust('mermaid', 'graph TD; A-->B', 'note.md', { showConfirm });
    expect(r.ok).toBe(true);
    expect(showConfirm).not.toHaveBeenCalled();
    expect(calls.getTrust).toBe(0);
    expect(calls.runCell).toHaveLength(1);
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

/**
 * ensureComputeTrust is the shared consent gate the propose_compute Run path now
 * routes through (#1411), so an AI-drafted cell hits the same per-project prompt
 * as an editor cell rather than executing unprompted.
 */
describe('ensureComputeTrust (#1411 — the conversation Run gate)', () => {
  it('untrusted python prompts; Run grants trust and clears to proceed', async () => {
    const showConfirm = vi.fn(() => Promise.resolve(true));
    const ok = await ensureComputeTrust('python', { showConfirm });
    expect(ok).toBe(true);
    expect(showConfirm).toHaveBeenCalledTimes(1);
    expect(calls.setTrust).toEqual([true]);
  });

  it('untrusted python + Cancel returns false and grants nothing', async () => {
    const showConfirm = vi.fn(() => Promise.resolve(false));
    const ok = await ensureComputeTrust('python', { showConfirm });
    expect(ok).toBe(false);
    expect(calls.setTrust).toEqual([]);
  });

  it('already-trusted proceeds without prompting', async () => {
    trustState.trusted = true;
    const showConfirm = vi.fn(() => Promise.resolve(true));
    const ok = await ensureComputeTrust('python', { showConfirm });
    expect(ok).toBe(true);
    expect(showConfirm).not.toHaveBeenCalled();
  });

  it('a non-executable language is never gated', async () => {
    const showConfirm = vi.fn(() => Promise.resolve(true));
    const ok = await ensureComputeTrust('mermaid', { showConfirm });
    expect(ok).toBe(true);
    expect(showConfirm).not.toHaveBeenCalled();
    expect(calls.getTrust).toBe(0);
  });
});
