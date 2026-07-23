/**
 * Eyes-on-code compute consent (#373, #1325, #1411, #1412).
 *
 * The run gate is now content-addressed: it asks `api.compute.consentStatus`
 * before firing, shows the code + prompts when a cell isn't yet consented, and
 * records the choice (this cell / trust-all) via `grantConsent`. Non-executable
 * languages pass straight through. The conversation path passes `forceReview` so
 * AI-authored code is shown even under blanket trust.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  runCellWithTrust,
  ensureComputeConsent,
  type ComputeConsentChoice,
} from '../../src/renderer/lib/compute/run-cell-with-trust';

const state = {
  status: 'none' as 'cell' | 'blanket' | 'none',
  grants: [] as Array<{ language: string; code: string; scope: 'cell' | 'project' }>,
  runCell: [] as Array<{ language: string; code: string; notePath?: string }>,
};

vi.mock('../../src/renderer/lib/ipc/client', () => ({
  api: {
    compute: {
      consentStatus: vi.fn((_language: string, _code: string) => Promise.resolve(state.status)),
      grantConsent: vi.fn((language: string, code: string, scope: 'cell' | 'project') => {
        state.grants.push({ language, code, scope });
        state.status = scope === 'project' ? 'blanket' : 'cell';
        return Promise.resolve();
      }),
      runCell: vi.fn((language: string, code: string, notePath?: string) => {
        state.runCell.push({ language, code, notePath });
        return Promise.resolve({ ok: true, output: { type: 'text', value: `${language}-result` } });
      }),
    },
  },
}));

function consenter(choice: ComputeConsentChoice) {
  return vi.fn((_message: string, _code: string) => Promise.resolve(choice));
}

beforeEach(() => {
  state.status = 'none';
  state.grants = [];
  state.runCell = [];
});

describe('runCellWithTrust — eyes-on-code (#1412)', () => {
  it('unconsented cell: Cancel blocks execution and grants nothing', async () => {
    const showConsent = consenter('cancel');
    const r = await runCellWithTrust('python', 'print(1)', 'n.md', { showConsent });
    expect(r.ok).toBe(false);
    expect(showConsent).toHaveBeenCalledTimes(1);
    expect(showConsent.mock.calls[0][1]).toBe('print(1)'); // the code is shown
    expect(state.runCell).toHaveLength(0);
    expect(state.grants).toHaveLength(0);
  });

  it('unconsented cell: "Run this cell" grants the cell hash and executes', async () => {
    const r = await runCellWithTrust('sql', 'select 1', 'n.md', { showConsent: consenter('cell') });
    expect(r.ok).toBe(true);
    expect(state.grants).toEqual([{ language: 'sql', code: 'select 1', scope: 'cell' }]);
    expect(state.runCell).toHaveLength(1);
  });

  it('unconsented cell: "Trust all here" grants blanket project trust and executes', async () => {
    const r = await runCellWithTrust('python', 'x=1', 'n.md', { showConsent: consenter('project') });
    expect(r.ok).toBe(true);
    expect(state.grants).toEqual([{ language: 'python', code: 'x=1', scope: 'project' }]);
  });

  it('an already-consented cell runs with no prompt', async () => {
    state.status = 'cell';
    const showConsent = consenter('cell');
    const r = await runCellWithTrust('python', 'print(1)', 'n.md', { showConsent });
    expect(r.ok).toBe(true);
    expect(showConsent).not.toHaveBeenCalled();
    expect(state.grants).toHaveLength(0);
  });

  it('blanket trust runs editor cells with no prompt', async () => {
    state.status = 'blanket';
    const showConsent = consenter('cell');
    await runCellWithTrust('python', 'anything()', 'n.md', { showConsent });
    expect(showConsent).not.toHaveBeenCalled();
  });

  it('Python aliases (py / python3 / any case) are gated too', async () => {
    for (const lang of ['py', 'python3', 'PYTHON', 'Sql']) {
      state.status = 'none';
      const showConsent = consenter('cancel');
      const r = await runCellWithTrust(lang, 'x', 'n.md', { showConsent });
      expect(r.ok, `${lang} must be gated`).toBe(false);
      expect(showConsent).toHaveBeenCalledTimes(1);
    }
  });

  it('a non-executable language passes straight through', async () => {
    const showConsent = consenter('cell');
    const r = await runCellWithTrust('mermaid', 'graph TD; A-->B', 'n.md', { showConsent });
    expect(r.ok).toBe(true);
    expect(showConsent).not.toHaveBeenCalled();
    expect(state.runCell).toHaveLength(1);
  });
});

describe('ensureComputeConsent — forceReview (the conversation propose_compute gate)', () => {
  it('forceReview shows AI code even under blanket trust', async () => {
    state.status = 'blanket';
    const showConsent = consenter('cell');
    const ok = await ensureComputeConsent('python', 'os.system("x")', { showConsent }, { forceReview: true });
    expect(ok).toBe(true);
    expect(showConsent).toHaveBeenCalledTimes(1); // blanket did NOT skip the review
    expect(state.grants).toEqual([{ language: 'python', code: 'os.system("x")', scope: 'cell' }]);
  });

  it('forceReview does NOT re-prompt a cell already consented by hash', async () => {
    state.status = 'cell';
    const showConsent = consenter('cell');
    const ok = await ensureComputeConsent('python', 'print(1)', { showConsent }, { forceReview: true });
    expect(ok).toBe(true);
    expect(showConsent).not.toHaveBeenCalled();
  });

  it('declining forceReview leaves the cell un-run (returns false)', async () => {
    state.status = 'blanket';
    const ok = await ensureComputeConsent('python', 'evil()', { showConsent: consenter('cancel') }, { forceReview: true });
    expect(ok).toBe(false);
    expect(state.grants).toHaveLength(0);
  });
});
