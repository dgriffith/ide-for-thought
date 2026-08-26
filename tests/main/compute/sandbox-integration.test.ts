/**
 * macOS Seatbelt profile — real OS enforcement (#1329 P1).
 *
 * Runs the actual `sandbox-exec` with the kernel profile against a real python3
 * and asserts the boundary holds. Skips off macOS or when python3 is absent, so
 * non-darwin CI doesn't fail. No real network is contacted: the deny path raises
 * *before* the connection, and the loopback/child probes hit closed ports.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildKernelSandboxProfile, SANDBOX_EXEC, resolveRealPath } from '../../../src/main/compute/sandbox';

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

describe('sandbox-integration environment gate (#1931)', () => {
  it('the environment supports running sandbox-exec tests (macOS + python3)', () => {
    // If canRun() returns false, the gated suite below becomes describe.skip,
    // which looks like a pass in CI — so this assertion ensures the gate's
    // conditions are met or fails loudly. This is a security boundary, so
    // silent vanishing is not acceptable.
    if (process.platform !== 'darwin') {
      // Expected on Linux CI; non-fatal.
      expect.soft(true).toBe(true);
      return;
    }
    expect(canRun()).toBe(true);
  });
});

skip('kernel Seatbelt profile — OS enforcement (#1329 P1/P2)', () => {
  let projectRoot: string;
  let tempHome: string;
  let outsideDir: string;
  let netOff: string;

  beforeAll(() => {
    projectRoot = resolveRealPath(fs.mkdtempSync(path.join(os.tmpdir(), 'mv-sandbox-proj-')));
    tempHome = resolveRealPath(fs.mkdtempSync(path.join(os.tmpdir(), 'mv-sandbox-home-')));
    // Create an "outside" dir completely outside TMP_WRITE_SUBPATHS for testing denied writes.
    // Use /var/tmp which is different from os.tmpdir() (which resolves to /var/folders on macOS).
    outsideDir = path.resolve('/var/tmp/mv-sandbox-outside-' + Math.random().toString(36).slice(2));
    fs.mkdirSync(outsideDir, { recursive: true });
    netOff = buildKernelSandboxProfile({ allowNetwork: false, projectRoot, homeDir: tempHome });
  });
  afterAll(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
    fs.rmSync(tempHome, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

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
    const netOn = buildKernelSandboxProfile({ allowNetwork: true, projectRoot, homeDir: tempHome });
    const r = runSandboxed(netOn, "import socket; socket.create_connection(('127.0.0.1', 1), 2)");
    expect(r.out).not.toMatch(/not permitted|PermissionError/);
  });

  // ── Filesystem containment (P2) ──────────────────────────────────────────

  it('permits writes inside the project root', () => {
    const r = runSandboxed(netOff, `open(${JSON.stringify(path.join(projectRoot, 'out.txt'))}, 'w').write('ok'); print('WROTE')`);
    expect(r.out).toContain('WROTE');
  });

  it('denies writes outside the project (e.g. into $HOME)', () => {
    const target = path.join(outsideDir, 'mv_sandbox_evil.txt');
    const r = runSandboxed(netOff, `open(${JSON.stringify(target)}, 'w').write('x')`);
    expect(r.code).not.toBe(0);
    expect(r.out).toMatch(/not permitted|PermissionError/);
    expect(fs.existsSync(target)).toBe(false); // nothing was written
  });

  it('denies reads of a sensitive location (~/.ssh)', () => {
    // Plant a file under ~/.ssh, confirm the sandbox blocks reading it, clean up.
    const sshDir = path.join(tempHome, '.ssh');
    const planted = path.join(sshDir, 'mv_sandbox_probe');
    fs.mkdirSync(sshDir, { recursive: true });
    fs.writeFileSync(planted, 'SECRET');
    try {
      const r = runSandboxed(netOff, `print(open(${JSON.stringify(planted)}).read())`);
      expect(r.code).not.toBe(0);
      expect(r.out).toMatch(/not permitted|PermissionError/);
      expect(r.out).not.toContain('SECRET');
    } finally {
      fs.rmSync(planted, { force: true });
    }
  });

  it('the write boundary is inherited by child processes', () => {
    const target = path.join(outsideDir, 'mv_sandbox_child_evil.txt');
    // The parent builds the child's -c code with %r so the path is safely quoted
    // as a Python literal, avoiding nested-quote fragility.
    const snippet = [
      'import subprocess, sys',
      `target = ${JSON.stringify(target)}`,
      "code = \"open(%r, 'w').write('x')\" % target",
      'p = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)',
      "print('BLOCKED' if p.returncode != 0 else 'WROTE')",
    ].join('\n');
    const r = runSandboxed(netOff, snippet);
    expect(r.out).toContain('BLOCKED');
    expect(fs.existsSync(target)).toBe(false);
  });
});
