/**
 * macOS OS-sandbox for the Python compute kernel — Phase 1 (#1329, #1421).
 *
 * Wraps the kernel spawn in `sandbox-exec` with a Seatbelt profile so the
 * interpreter runs under an OS-enforced boundary, not just the in-process
 * guards. Phase 1 contains **network egress**: it denies IP outbound/inbound
 * (re-allowing loopback) while leaving the filesystem open — filesystem
 * containment is Phase 2 (#1422).
 *
 * Two properties make this a real boundary rather than an advisory one:
 *   - Seatbelt policies are **inherited by child processes**, so a `subprocess`
 *     spawned from a cell also can't reach the network. Denying IP egress alone
 *     therefore closes the shell-out escape — no `(deny process-exec*)` needed
 *     (which would break pyenv/venv shim interpreters that re-exec the real
 *     binary, and we run fail-closed so a broken interpreter = no compute).
 *   - The deny filters are **IP-only**, so unix-domain sockets are untouched and
 *     the kernel's RPC channel to main (`MINERVA_IPC_SOCKET`) keeps working with
 *     no special carve-out.
 *
 * Fail-closed (decided): on macOS, if `sandbox-exec` is unavailable the kernel
 * refuses to run rather than falling back to unsandboxed. On non-darwin
 * (dev/CI only — we ship macOS) the interpreter runs directly; a shipping macOS
 * build always sandboxes-or-refuses.
 */
import fs from 'node:fs';

export const SANDBOX_EXEC = '/usr/bin/sandbox-exec';

export const SANDBOX_UNAVAILABLE_ERROR =
  'Compute is unavailable: the macOS sandbox (sandbox-exec) could not be found, ' +
  'and Minerva will not run compute without it.';

/**
 * Seatbelt (SBPL) profile for the kernel. `(allow default)` keeps Python startup
 * working (dyld, frameworks, site-packages, mach services); we subtract only IP
 * network egress. When `allowNetwork` is set (the per-machine Settings toggle),
 * the profile imposes no network restriction — the setting stays the single
 * source of truth for network posture.
 */
export function buildKernelSandboxProfile(opts: { allowNetwork: boolean }): string {
  if (opts.allowNetwork) {
    return '(version 1)\n(allow default)\n';
  }
  return [
    '(version 1)',
    '(allow default)',
    '; Block IP network egress (#1329 P1). Inherited by any child process, so a',
    '; subprocess cannot reach the network either. Loopback stays allowed (not an',
    '; exfiltration risk), and unix-domain sockets are untouched by the IP filters',
    "; so the kernel's RPC channel to main keeps working.",
    '(deny network-outbound (remote ip "*:*"))',
    '(deny network-inbound (local ip "*:*"))',
    '(allow network-outbound (remote ip "localhost:*"))',
    '',
  ].join('\n');
}

/** True when the macOS Seatbelt wrapper can be applied on this machine. */
export function isMacSandboxAvailable(): boolean {
  return process.platform === 'darwin' && fs.existsSync(SANDBOX_EXEC);
}

export interface KernelLaunch {
  command: string;
  args: string[];
}

/**
 * Decide how to launch the kernel process. On macOS the interpreter is wrapped
 * in `sandbox-exec -p <profile> <py> <script>` (fail-closed — throws
 * `SANDBOX_UNAVAILABLE_ERROR` if the sandbox binary is missing). On non-darwin
 * the interpreter runs directly (dev/CI only).
 *
 * `platform` / `sandboxAvailable` are injectable so the decision is unit-testable
 * off a real macOS; production passes neither and they resolve from the host.
 */
export function planKernelLaunch(
  pythonBin: string,
  scriptPath: string,
  opts: { allowNetwork: boolean; platform?: NodeJS.Platform; sandboxAvailable?: boolean },
): KernelLaunch {
  const platform = opts.platform ?? process.platform;
  if (platform !== 'darwin') {
    // Not the ship target — no macOS sandbox to apply.
    return { command: pythonBin, args: [scriptPath] };
  }
  const available = opts.sandboxAvailable ?? isMacSandboxAvailable();
  if (!available) throw new Error(SANDBOX_UNAVAILABLE_ERROR);
  const profile = buildKernelSandboxProfile({ allowNetwork: opts.allowNetwork });
  return { command: SANDBOX_EXEC, args: ['-p', profile, pythonBin, scriptPath] };
}
