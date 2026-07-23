/**
 * Compute-trust enforcement boundary (#1411).
 *
 * The trust check now lives in MAIN, so an execution entry point that reaches
 * the IPC without the renderer prompt is refused — not silently run. This is
 * what makes the consent an actual boundary rather than renderer UX (and what
 * closes the propose_compute Run bypass).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { computeTrustGuard } from '../../../src/main/compute/trust';
import { getPythonTrust, setPythonTrust } from '../../../src/main/project-config';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-compute-trust-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('computeTrustGuard (#1411)', () => {
  it('an untrusted project defaults to refused (getPythonTrust is false)', () => {
    expect(getPythonTrust(root)).toBe(false);
    const guard = computeTrustGuard(root);
    expect(guard).not.toBeNull();
    expect(guard?.ok).toBe(false);
    if (guard && !guard.ok) expect(guard.error).toMatch(/not trusted/i);
  });

  it('once trust is granted, the guard lets execution proceed (returns null)', () => {
    setPythonTrust(root, true);
    expect(computeTrustGuard(root)).toBeNull();
  });

  it('revoking trust re-arms the guard', () => {
    setPythonTrust(root, true);
    expect(computeTrustGuard(root)).toBeNull();
    setPythonTrust(root, false);
    expect(computeTrustGuard(root)).not.toBeNull();
  });
});
