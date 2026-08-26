/**
 * Kernel network guard (#1413).
 *
 * The compute kernel installs a socket guard at bootstrap that blocks outbound
 * connections to non-local addresses unless MINERVA_ALLOW_NETWORK == '1'. These
 * tests import `minerva_kernel` (which runs the guard at module load, but NOT
 * `main()`, since `__name__` isn't `__main__`) in a real python3 and assert the
 * guard's behavior directly — no actual network is touched because the guard
 * raises *before* the underlying connect runs.
 *
 * Skips when python3 isn't on PATH so CI without Python doesn't fail.
 */

import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const PY = process.env.MINERVA_PYTHON ?? 'python3';
const RESOURCES = path.join(process.cwd(), 'resources', 'python');

function pythonAvailable(): boolean {
  try {
    execFileSync(PY, ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Run a Python snippet with `minerva_kernel` importable; return trimmed stdout. */
function runPy(snippet: string, env: Record<string, string> = {}): string {
  return execFileSync(PY, ['-c', snippet], {
    env: { ...process.env, PYTHONPATH: RESOURCES, ...env },
    encoding: 'utf-8',
  }).trim();
}

const skipIfNoPython = pythonAvailable() ? describe : describe.skip;

describe('network-guard environment gate (#1931)', () => {
  it('python3 is available so the network guard tests can run', () => {
    // If pythonAvailable() returns false, the gated suite below becomes describe.skip,
    // which looks like a pass in CI — so this assertion ensures Python is present
    // or fails loudly. The network guard is a security boundary.
    expect(pythonAvailable()).toBe(true);
  });
});

skipIfNoPython('kernel network guard (#1413)', () => {
  it('installs the guard by default (connect is wrapped)', () => {
    const out = runPy('import minerva_kernel, socket; print(socket.socket.connect.__name__)');
    expect(out).toBe('guarded_connect');
  });

  it('blocks a non-local connection with a clear error — before any real connect', () => {
    // 203.0.113.0 is TEST-NET-3 (RFC 5737): guaranteed non-routable. The guard
    // raises immediately, so this never actually reaches the network.
    const out = runPy(
      'import minerva_kernel, socket\n' +
      'try:\n' +
      "    socket.socket(socket.AF_INET, socket.SOCK_STREAM).connect(('203.0.113.0', 80))\n" +
      "    print('NO-RAISE')\n" +
      'except OSError as e:\n' +
      "    print('disabled' if 'Network access is disabled' in str(e) else 'OTHER: ' + str(e))",
    );
    expect(out).toBe('disabled');
  });

  it('lets loopback through the guard (reaches the real connect)', () => {
    // 127.0.0.1 on an almost-certainly-closed port: the guard permits it, so the
    // real connect runs and is refused — proving the guard did NOT block it.
    const out = runPy(
      'import minerva_kernel, socket\n' +
      's = socket.socket(socket.AF_INET, socket.SOCK_STREAM)\n' +
      's.settimeout(1)\n' +
      'try:\n' +
      "    s.connect(('127.0.0.1', 1))\n" +
      "    print('CONNECTED')\n" +
      'except OSError as e:\n' +
      "    print('blocked' if 'Network access is disabled' in str(e) else 'passed-guard')",
    );
    expect(out).toBe('passed-guard');
  });

  it('does NOT install the guard when MINERVA_ALLOW_NETWORK=1', () => {
    const out = runPy(
      'import minerva_kernel, socket; print(socket.socket.connect.__name__)',
      { MINERVA_ALLOW_NETWORK: '1' },
    );
    expect(out).toBe('connect');
  });
});
