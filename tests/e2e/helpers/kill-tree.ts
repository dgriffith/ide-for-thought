/**
 * Kill a spawned process and everything it started (#3023).
 *
 * The CLI specs start the packaged binary `detached`, and Electron's helpers
 * outlive the main process unless the whole tree goes. On macOS and Linux
 * that's the process group (`process.kill(-pid)`); Windows has no process
 * groups, so the negative pid threw, nothing was killed, and a binary still
 * running held its working directory — the spec's cleanup then failed with
 * EPERM after the test timed out. There it's `taskkill /T /F`, run from
 * System32 so a Git Bash PATH can't swap in something else.
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export function killTree(pid: number | undefined): void {
  if (!pid) return;
  try {
    if (process.platform === 'win32') {
      const taskkill = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'taskkill.exe');
      execFileSync(taskkill, ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch { /* already gone */ }
}
