/**
 * Kernel sandbox launch planning (#1329 P1) — pure logic, runs on any platform.
 *
 * The Seatbelt profile's actual OS enforcement is covered by
 * sandbox-integration.test.ts (macOS-only); here we pin the profile text and
 * the platform/fail-closed launch decision, which are host-independent because
 * platform + availability are injected.
 */
import { describe, it, expect } from 'vitest';
import {
  buildKernelSandboxProfile,
  planKernelLaunch,
  SANDBOX_EXEC,
  SANDBOX_UNAVAILABLE_ERROR,
} from '../../../src/main/compute/sandbox';

describe('buildKernelSandboxProfile (#1329 P1)', () => {
  it('denies IP egress and re-allows loopback when network is off', () => {
    const p = buildKernelSandboxProfile({ allowNetwork: false });
    expect(p).toContain('(allow default)');
    expect(p).toContain('(deny network-outbound (remote ip "*:*"))');
    expect(p).toContain('(deny network-inbound (local ip "*:*"))');
    expect(p).toContain('(allow network-outbound (remote ip "localhost:*"))');
  });

  it('imposes no network restriction when network is allowed', () => {
    const p = buildKernelSandboxProfile({ allowNetwork: true });
    expect(p).toContain('(allow default)');
    expect(p).not.toContain('deny network');
  });
});

describe('planKernelLaunch (#1329 P1)', () => {
  it('wraps the interpreter in sandbox-exec on macOS', () => {
    const launch = planKernelLaunch('/usr/bin/python3', '/k/kernel.py', {
      allowNetwork: false,
      platform: 'darwin',
      sandboxAvailable: true,
    });
    expect(launch.command).toBe(SANDBOX_EXEC);
    // sandbox-exec -p <profile> <py> <script>
    expect(launch.args[0]).toBe('-p');
    expect(launch.args[1]).toContain('(deny network-outbound');
    expect(launch.args.slice(2)).toEqual(['/usr/bin/python3', '/k/kernel.py']);
  });

  it('passes allowNetwork through to the profile it wraps', () => {
    const launch = planKernelLaunch('/py', '/k.py', {
      allowNetwork: true,
      platform: 'darwin',
      sandboxAvailable: true,
    });
    expect(launch.args[1]).not.toContain('deny network');
  });

  it('fails closed on macOS when sandbox-exec is unavailable', () => {
    expect(() =>
      planKernelLaunch('/py', '/k.py', { allowNetwork: false, platform: 'darwin', sandboxAvailable: false }),
    ).toThrow(SANDBOX_UNAVAILABLE_ERROR);
  });

  it('runs the interpreter directly on non-darwin (dev/CI — we ship macOS)', () => {
    const launch = planKernelLaunch('/usr/bin/python3', '/k/kernel.py', {
      allowNetwork: false,
      platform: 'linux',
      sandboxAvailable: false,
    });
    expect(launch).toEqual({ command: '/usr/bin/python3', args: ['/k/kernel.py'] });
  });
});
