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
  // Reversible fake so the secret's at-rest encryption path (#1326) is exercised.
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from('FAKEENC:' + s, 'utf-8'),
    decryptString: (buf: Buffer) => {
      const s = buf.toString('utf-8');
      if (!s.startsWith('FAKEENC:')) throw new Error('bad ciphertext');
      return s.slice('FAKEENC:'.length);
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

it('encrypts the secret at rest but keeps it plaintext in memory (#1326)', async () => {
  const cfg = await setClipperEnabled(true);
  // In-memory secret stays plaintext hex for the loopback compare.
  expect(cfg.secret).toMatch(/^[0-9a-f]{64}$/);
  // On-disk copy is encrypted, not the raw hex.
  const onDisk = fs.readFileSync(path.join(tempDir, 'clipper-config.json'), 'utf-8');
  expect(onDisk).not.toContain(cfg.secret);
  expect((JSON.parse(onDisk).secret as string).startsWith('enc:v1:')).toBe(true);
  // Round-trips back to the same plaintext on read.
  expect((await getClipperConfig()).secret).toBe(cfg.secret);
});

it('reads a legacy plaintext secret unchanged, then re-encrypts on next write (#1326)', async () => {
  const legacy = 'a'.repeat(64);
  fs.writeFileSync(
    path.join(tempDir, 'clipper-config.json'),
    JSON.stringify({ enabled: true, secret: legacy }),
  );
  // Legacy plaintext still resolves.
  expect((await getClipperConfig()).secret).toBe(legacy);
  // A write (rotate) migrates the file to encrypted form.
  await setClipperEnabled(false);
  const onDisk = fs.readFileSync(path.join(tempDir, 'clipper-config.json'), 'utf-8');
  expect((JSON.parse(onDisk).secret as string).startsWith('enc:v1:')).toBe(true);
});

it('re-encrypts a legacy plaintext secret on read, before any write (#1642)', async () => {
  const legacy = 'b'.repeat(64);
  const file = path.join(tempDir, 'clipper-config.json');
  fs.writeFileSync(file, JSON.stringify({ enabled: true, secret: legacy }));
  // The read itself upgrades the on-disk copy to encrypted-at-rest…
  expect((await getClipperConfig()).secret).toBe(legacy);
  expect((JSON.parse(fs.readFileSync(file, 'utf-8')).secret as string).startsWith('enc:v1:')).toBe(true);
  // …and the caller keeps seeing the usable plaintext secret afterwards.
  expect((await getClipperConfig()).secret).toBe(legacy);
});
