/**
 * Per-machine clipper config (#791): persisted enable + secret. Stubs
 * `app.getPath('userData')` to a temp dir (mirrors python-settings.test) so the
 * suite is hermetic.
 */

import { it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tempDir: string;

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`unexpected getPath(${name})`);
      return tempDir;
    },
  },
}));

import {
  getClipperConfig,
  setClipperEnabled,
  regenerateClipperSecret,
  ensureClipperSecret,
  DEFAULT_CLIPPER_CONFIG,
} from '../../../src/main/clipper/clipper-config';

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-clipper-cfg-'));
});
afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

it('defaults to disabled with no secret when nothing is persisted', async () => {
  expect(await getClipperConfig()).toEqual(DEFAULT_CLIPPER_CONFIG);
  expect(DEFAULT_CLIPPER_CONFIG.enabled).toBe(false);
});

it('issues a secret on first enable and persists both', async () => {
  const cfg = await setClipperEnabled(true);
  expect(cfg.enabled).toBe(true);
  expect(cfg.secret).toMatch(/^[0-9a-f]{64}$/);
  // Persisted across reads.
  expect(await getClipperConfig()).toEqual(cfg);
});

it('keeps the same secret when toggling enable off and on', async () => {
  const first = await setClipperEnabled(true);
  await setClipperEnabled(false);
  const reEnabled = await setClipperEnabled(true);
  expect(reEnabled.secret).toBe(first.secret);
  expect(reEnabled.enabled).toBe(true);
});

it('rotates the secret on regenerate', async () => {
  const first = await setClipperEnabled(true);
  const rotated = await regenerateClipperSecret();
  expect(rotated.secret).not.toBe(first.secret);
  expect(rotated.secret).toMatch(/^[0-9a-f]{64}$/);
  expect(rotated.enabled).toBe(true); // unchanged
});

it('ensureClipperSecret generates once, then is stable', async () => {
  const s1 = await ensureClipperSecret();
  expect(s1).toMatch(/^[0-9a-f]{64}$/);
  expect(await ensureClipperSecret()).toBe(s1);
});
