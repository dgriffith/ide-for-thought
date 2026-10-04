/**
 * Eyes-on-code compute consent (#373, #1325, #1411, #1412), main-owned (#2568).
 *
 * The renderer no longer draws the consent dialog or grants consent: for a
 * gated language it asks main (`api.compute.requestConsent`), which shows its
 * own native dialog, records the answer and replies. What's left here is the
 * renderer's half: ask for every executable language (aliases included), pass
 * `forceReview` for the conversation path, and run only on a yes. Main's half
 * (status, blanket trust, forceReview, the dialog itself) is in
 * tests/main/ipc/register-compute.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { runCellWithTrust, ensureComputeConsent } from '../../../src/renderer/lib/app/compute-ops';

const state = {
  reply: 'cell' as 'cell' | 'project' | 'cancel',
  requests: [] as Array<{ language: string; code: string; forceReview: boolean | undefined }>,
  runCell: [] as Array<{ language: string; code: string; notePath?: string }>,
};

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    compute: {
      requestConsent: vi.fn((language: string, code: string, forceReview?: boolean) => {
        state.requests.push({ language, code, forceReview });
        return Promise.resolve(state.reply);
      }),
      runCell: vi.fn((language: string, code: string, notePath?: string) => {
        state.runCell.push({ language, code, notePath });
        return Promise.resolve({ ok: true, output: { type: 'text', value: `${language}-result` } });
      }),
    },
  },
}));

beforeEach(() => {
  state.reply = 'cell';
  state.requests = [];
  state.runCell = [];
});

describe('runCellWithTrust (#1412, #2568)', () => {
  it('asks main with the exact code, and runs on a yes', async () => {
    const r = await runCellWithTrust('sql', 'select 1', 'n.md');
    expect(r.ok).toBe(true);
    expect(state.requests).toEqual([{ language: 'sql', code: 'select 1', forceReview: false }]);
    expect(state.runCell).toHaveLength(1);
  });

  it('a "trust this thoughtbase" answer runs too', async () => {
    state.reply = 'project';
    expect((await runCellWithTrust('python', 'x=1', 'n.md')).ok).toBe(true);
  });

  it('Cancel blocks execution', async () => {
    state.reply = 'cancel';
    const r = await runCellWithTrust('python', 'print(1)', 'n.md');
    expect(r.ok).toBe(false);
    expect(state.runCell).toHaveLength(0);
  });

  it('Python aliases (py / python3 / any case) are gated too', async () => {
    state.reply = 'cancel';
    for (const lang of ['py', 'python3', 'PYTHON', 'Sql']) {
      const r = await runCellWithTrust(lang, 'x', 'n.md');
      expect(r.ok, `${lang} must be gated`).toBe(false);
    }
    expect(state.requests).toHaveLength(4);
  });

  it('a non-executable language passes straight through, asking nothing', async () => {
    const r = await runCellWithTrust('mermaid', 'graph TD; A-->B', 'n.md');
    expect(r.ok).toBe(true);
    expect(state.requests).toHaveLength(0);
    expect(state.runCell).toHaveLength(1);
  });
});

describe('ensureComputeConsent — forceReview (the conversation propose_compute gate)', () => {
  it('passes forceReview to main, which shows AI code even under blanket trust', async () => {
    expect(await ensureComputeConsent('python', 'os.system("x")', { forceReview: true })).toBe(true);
    expect(state.requests).toEqual([{ language: 'python', code: 'os.system("x")', forceReview: true }]);
  });

  it('declining leaves the cell un-run (returns false)', async () => {
    state.reply = 'cancel';
    expect(await ensureComputeConsent('python', 'evil()', { forceReview: true })).toBe(false);
  });
});
