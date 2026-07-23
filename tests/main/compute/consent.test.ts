/**
 * Content-addressed compute consent (#1412).
 *
 * Consent is stored per-machine under `app.getPath('userData')` — never in the
 * thoughtbase — and keyed on a hash of each cell's code, so editing a cell
 * re-prompts and a shared thoughtbase can't ship trust. We stub
 * `electron.app.getPath` to a temp dir (same trick as python-settings.test).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let userDataDir: string;

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`unexpected getPath(${name})`);
      return userDataDir;
    },
  },
}));

// Import after the mock so the module captures the stubbed `app`.
import { cellHash, consentStatus, grantConsent, computeConsentGuard } from '../../../src/main/compute/consent';

const PROJECT = '/some/thoughtbase';
const OTHER = '/other/thoughtbase';

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-consent-'));
});
afterEach(() => {
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

describe('compute consent (#1412)', () => {
  it('a never-run cell is unconsented and the guard refuses it', () => {
    expect(consentStatus(PROJECT, 'python', 'print(1)')).toBe('none');
    const guard = computeConsentGuard(PROJECT, 'python', 'print(1)');
    expect(guard).not.toBeNull();
    expect(guard?.ok).toBe(false);
  });

  it('granting cell consent trusts that exact code, and the guard lets it run', () => {
    grantConsent(PROJECT, 'python', 'print(1)', 'cell');
    expect(consentStatus(PROJECT, 'python', 'print(1)')).toBe('cell');
    expect(computeConsentGuard(PROJECT, 'python', 'print(1)')).toBeNull();
  });

  it('editing the cell (different code) re-prompts — the old consent does not carry over', () => {
    grantConsent(PROJECT, 'python', 'print(1)', 'cell');
    expect(consentStatus(PROJECT, 'python', 'print(2)')).toBe('none');
    expect(computeConsentGuard(PROJECT, 'python', 'print(2)')).not.toBeNull();
  });

  it('blanket project trust covers any cell (but is reported as blanket, not cell)', () => {
    grantConsent(PROJECT, 'python', '', 'project');
    expect(consentStatus(PROJECT, 'python', 'anything()')).toBe('blanket');
    expect(computeConsentGuard(PROJECT, 'python', 'anything()')).toBeNull();
    // A cell consented explicitly still reports 'cell' (so the conversation path
    // can tell an eyes-on-code'd cell from a merely-blanket one).
    grantConsent(PROJECT, 'python', 'x=1', 'cell');
    expect(consentStatus(PROJECT, 'python', 'x=1')).toBe('cell');
  });

  it('consent is per-project — trusting one thoughtbase does not trust another', () => {
    grantConsent(PROJECT, 'python', 'print(1)', 'cell');
    expect(consentStatus(OTHER, 'python', 'print(1)')).toBe('none');
  });

  it('consent lives per-machine (userData), not in the thoughtbase folder', () => {
    grantConsent(PROJECT, 'python', 'print(1)', 'cell');
    expect(fs.existsSync(path.join(userDataDir, 'compute-consent.json'))).toBe(true);
    // Nothing was written under the (fake) project path.
    expect(fs.existsSync(path.join(PROJECT, '.minerva'))).toBe(false);
  });

  it('cellHash folds language + code and is stable', () => {
    expect(cellHash('python', 'print(1)')).toBe(cellHash('PYTHON', 'print(1)'));
    expect(cellHash('python', 'print(1)')).not.toBe(cellHash('python', 'print(2)'));
    expect(cellHash('python', 'x')).not.toBe(cellHash('sql', 'x'));
  });
});
