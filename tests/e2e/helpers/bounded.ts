/**
 * Bounds for the e2e calls that have none of their own (#2458).
 *
 * Every Playwright `expect` and action carries a timeout, but three kinds of
 * call do not: `app.evaluate` (runs in the main process over the Node
 * inspector), `page.evaluate`, and `ElectronApplication.close()`. A hang in any
 * of them used to spend the whole 60s test timeout and end with no error but
 * "Test timeout of 60000ms exceeded" — nothing named the call, and nothing said
 * whether the main process or the renderer was the one stuck (#2458: a11y ›
 * proposals panel, 1 in 46 CI runs, then an app that never quit).
 *
 * `withinBound` turns such a hang into an error that names the step, and — when
 * given a `diagnose` — says what the app was doing when the bound fired.
 * `probeApp` is that diagnosis: whether main still answers a trivial evaluate
 * within 2s separates "main wedged" from "renderer slow".
 *
 * The bounds themselves are set well above measured normal times; see the
 * constants below for the numbers they were set against.
 */
import { test, type ElectronApplication, type Page } from '@playwright/test';
import { execFile, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';

/** How long a probe waits for a trivial answer before calling the side wedged. */
export const PROBE_MS = 2_000;

class BoundExceeded extends Error {}

/** True while a Playwright test is running in this worker (steps, annotations
 *  and soft expects all throw outside one — e.g. from a finally block that
 *  only resumes after the test already timed out). */
export function inTest(): boolean {
  try {
    test.info();
    return true;
  } catch {
    return false;
  }
}

/** Record a diagnostic on the current attempt, where the JSON report — and so
 *  scripts/e2e-flake-report.mjs — can read it. A no-op outside a test. */
export function annotate(type: string, description: string): void {
  if (!inTest()) return;
  test.info().annotations.push({ type, description });
}

/**
 * Settle `work`, or throw `"<label> did not settle within <ms>ms"` plus
 * whatever `diagnose` reports about the app at that moment. The losing
 * promise's eventual rejection is swallowed so it can't surface later as an
 * unhandled rejection in an unrelated test.
 */
export async function withinBound<T>(
  label: string,
  ms: number,
  work: Promise<T>,
  diagnose?: () => Promise<string>,
): Promise<T> {
  work.catch(() => { /* reported below if it lost the race */ });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bound = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BoundExceeded()), ms);
  });
  try {
    return await Promise.race([work, bound]);
  } catch (err) {
    if (!(err instanceof BoundExceeded)) throw err;
    const state = diagnose ? await diagnose().catch((e: unknown) => `probe itself failed: ${String(e)}`) : '';
    const message = `${label} did not settle within ${ms}ms` + (state ? `\n${state}` : '');
    annotate('hang', message);
    throw new Error(message, { cause: err });
  } finally {
    clearTimeout(timer);
  }
}

/** Race `p` against `ms`; true if it settled (either way) in time. */
export async function settlesWithin(p: Promise<unknown>, ms: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const lost = new Promise<false>((r) => { timer = setTimeout(() => r(false), ms); });
  try {
    return await Promise.race([p.then(() => true, () => true), lost]);
  } finally {
    clearTimeout(timer);
  }
}

async function timed<T>(p: Promise<T>): Promise<{ ok: true; value: T; ms: number } | { ok: false; ms: number; error?: string }> {
  const start = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const lost = new Promise<'timeout'>((r) => { timer = setTimeout(() => r('timeout'), PROBE_MS); });
  try {
    const out = await Promise.race([p.then((value) => ({ value }), (e: unknown) => ({ error: String(e) })), lost]);
    if (out === 'timeout') return { ok: false, ms: Date.now() - start };
    if ('error' in out) return { ok: false, ms: Date.now() - start, error: out.error };
    return { ok: true, value: out.value, ms: Date.now() - start };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * What the app is doing right now, in a few lines: is the child alive, does the
 * main process answer a trivial evaluate, does each renderer answer one. Every
 * probe is bounded at {@link PROBE_MS}, so this cannot itself hang.
 */
export async function probeApp(app: ElectronApplication): Promise<string> {
  const lines: string[] = [];
  const child = app.process();
  lines.push(`child pid ${child.pid}: ${child.exitCode === null && child.signalCode === null ? 'running' : `exited (code ${child.exitCode}, signal ${child.signalCode})`}`);

  const main = await timed(app.evaluate(() => process.uptime()));
  const mainError = main.ok ? '' : firstLine(main.error ?? '');
  lines.push(main.ok
    ? `main process: answered a trivial evaluate in ${main.ms}ms (uptime ${main.value.toFixed(1)}s) — main is NOT wedged`
    : !main.error
      ? `main process: NO answer to a trivial evaluate within ${PROBE_MS}ms — main is wedged (event loop blocked, or its inspector is)`
      : /has been closed/.test(mainError)
        // Playwright's close() closes its inspector connection only AFTER main
        // answered the app.quit() it sent — so main was responsive at quit time,
        // and what is still running is the quit itself: main.ts's before-quit
        // flush, or Electron's native shutdown after it.
        ? `main process: inspector already closed — main accepted app.quit(), and the process is still exiting (before-quit flush, or Electron's native shutdown)`
        : `main process: trivial evaluate failed after ${main.ms}ms: ${mainError}`);

  if (!main.ok && !main.error) lines.push(await captureProcessState(child, 'main-wedged'));

  for (const page of app.windows()) {
    // CDP to a renderer is relayed by the browser process — which in Electron
    // IS the main process — so a wedged main silences every renderer probe too.
    const r = await probePage(page);
    lines.push(!main.ok && !main.error && r.includes('NO answer') ? `${r} (expected while main is wedged: CDP is relayed through it)` : r);
  }
  if (app.windows().length === 0) lines.push('renderer: no windows open');
  return lines.join('\n');
}

const firstLine = (text: string) => text.split('\n')[0]!.trim();

/**
 * Snapshot a live process for the report: its child processes, and — on macOS,
 * where CI runs — a 1s `sample` of every thread's stack, attached to the
 * attempt as `<label>-process-state.txt`. Only called on a failure path (a
 * wedged main, an app that won't quit), where the stack of the stuck thread is
 * the single most useful thing to have and the ~2-5s it costs is irrelevant.
 * Bounded; never throws. Returns a one-line summary for the message.
 */
export async function captureProcessState(child: ChildProcess, label: string): Promise<string> {
  const pid = child.pid;
  if (!pid || child.exitCode !== null || child.signalCode !== null) return '';
  const run = (cmd: string, args: string[]) =>
    new Promise<string>((resolve) => {
      execFile(cmd, args, { timeout: 20_000, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) =>
        resolve(String(stdout || '') + (err ? `\n[${cmd} failed: ${firstLine(String(stderr || err.message))}]` : '')));
    });
  const kids = (await run('/usr/bin/pgrep', ['-P', String(pid)])).split(/\s+/).filter((x) => /^\d+$/.test(x));
  const ps = await run('/bin/ps', ['-o', 'pid,ppid,stat,%cpu,etime,command', '-p', [String(pid), ...kids].join(',')]);
  const kidRows = ps.split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((c) => c[0] && c[0] !== String(pid));
  const summary = `process ${pid} has ${kids.length} child process(es)` +
    (kidRows.length ? ` (pid stat: ${kidRows.map((c) => `${c[0]} ${c[2]}`).join(', ')})` : '');
  let body = `# ${label}: process state of pid ${pid}\n\n## ps\n${ps}\n`;
  if (process.platform === 'darwin') {
    // The call graph is what matters; the trailing binary-image list is most of
    // the bytes and none of the answer.
    const sample = await run('/usr/bin/sample', [String(pid), '1']);
    body += `\n## sample (1s, all threads)\n${sample.split('\nBinary Images:')[0]}`;
  }
  if (!inTest()) return summary;
  try {
    // A file attachment (under test-results/, uploaded with the report) rather
    // than an inline body, which would be base64'd into playwright-report.json.
    const info = test.info();
    const file = info.outputPath(`${label}-process-state-${pid}.txt`);
    fs.writeFileSync(file, body);
    await info.attach(`${label}-process-state.txt`, { path: file, contentType: 'text/plain' });
    fs.rmSync(file, { force: true });
    return `${summary} (stacks attached as ${label}-process-state.txt)`;
  } catch {
    return summary;
  }
}

/** One renderer's answer to a trivial evaluate. */
export async function probePage(page: Page): Promise<string> {
  const r = await timed(page.evaluate(() => `${document.readyState} ${location.pathname.split('/').pop() ?? ''}`));
  return r.ok
    ? `renderer: answered in ${r.ms}ms (readyState ${r.value})`
    : r.error
      ? `renderer: evaluate failed after ${r.ms}ms: ${r.error}`
      : `renderer: NO answer within ${PROBE_MS}ms — renderer is wedged or mid-navigation`;
}
