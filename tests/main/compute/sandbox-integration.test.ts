/**
 * macOS Seatbelt profile — real OS enforcement (#1329 P1).
 *
 * Runs the actual `sandbox-exec` with the kernel profile against a real python3
 * and asserts the boundary holds. Skips off macOS or when python3 is absent, so
 * non-darwin CI doesn't fail. No real network is contacted: the deny path raises
 * *before* the connection, and the loopback/child probes hit closed ports.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { buildKernelSandboxProfile, SANDBOX_EXEC } from '../../../src/main/compute/sandbox';

const PY = process.env.MINERVA_PYTHON ?? 'python3';

function canRun(): boolean {
  if (process.platform !== 'darwin') return false;
  try {
    execFileSync(SANDBOX_EXEC, ['-p', '(version 1)(allow default)', PY, '--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Run `python -c snippet` under the given profile; return {code, out}. */
function runSandboxed(profile: string, snippet: string): { code: number; out: string } {
  try {
    const out = execFileSync(SANDBOX_EXEC, ['-p', profile, PY, '-c', snippet], { encoding: 'utf-8' });
    return { code: 0, out: out.trim() };
  } catch (e) {
    const err = e as { status?: number; stdout?: string; stderr?: string };
    return { code: err.status ?? 1, out: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

const skip = canRun() ? describe : describe.skip;

skip('kernel Seatbelt profile — OS enforcement (#1329 P1)', () => {
  const netOff = buildKernelSandboxProfile({ allowNetwork: false });

  it('a benign cell still runs (profile does not break Python startup)', () => {
    expect(runSandboxed(netOff, 'print(6*7)').out).toBe('42');
  });

  it('blocks outbound IP egress at the OS level', () => {
    // 1.1.1.1 — the guard raises PermissionError before any packet leaves.
    const r = runSandboxed(netOff, "import socket; socket.create_connection(('1.1.1.1', 80), 2)");
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/not permitted|PermissionError/);
  });

  it('the deny is INHERITED by child processes (closes the subprocess escape)', () => {
    const r = runSandboxed(
      netOff,
      'import subprocess, sys; '
      + "p = subprocess.run([sys.executable, '-c', \"import socket; socket.create_connection(('1.1.1.1',80),2)\"], capture_output=True, text=True); "
      + "print('BLOCKED' if p.returncode != 0 else 'REACHED')",
    );
    expect(r.out).toContain('BLOCKED');
  });

  it('permits loopback (reaches the OS — connection refused, not sandbox-denied)', () => {
    const r = runSandboxed(netOff, "import socket; socket.create_connection(('127.0.0.1', 1), 2)");
    expect(r.out).toMatch(/ConnectionRefused|refused/);
    expect(r.out).not.toMatch(/not permitted|PermissionError/);
  });

  it('imposes no network restriction when allowNetwork is on', () => {
    // Can't hit the real network in a test, but a loopback connect must not be
    // sandbox-denied under the permissive profile.
    const netOn = buildKernelSandboxProfile({ allowNetwork: true });
    const r = runSandboxed(netOn, "import socket; socket.create_connection(('127.0.0.1', 1), 2)");
    expect(r.out).not.toMatch(/not permitted|PermissionError/);
  });
});
