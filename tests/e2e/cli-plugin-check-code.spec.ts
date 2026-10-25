/**
 * `minerva plugin check` runs a plugin's code (#2833), from the PACKAGED app
 * in CLI mode, the way the installed shim runs it: the CLI bundle has no
 * Electron, so the app's bundle hosts the worker (`plugin-code-check.ts`).
 *
 * - Note Stats (a command, and a view) passes: its command's handler runs
 *   against each fixture thoughtbase, and its view is said to need the app.
 * - Overreach declares `notes:read` and writes a note and reaches the
 *   clipboard: the broker refuses both, and the check fails naming them.
 * - A fresh `plugin new --kind command` scaffold passes as written.
 */
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { makeTempDir, minervaEnv, projectRoot } from './helpers/launch';
import type { PluginCheckReport } from '../../src/shared/plugins/check';

function packagedApp(): string | null {
  if (process.platform !== 'darwin') return null;
  const p = path.join(projectRoot, 'out', `Minerva-${process.platform}-${process.arch}`, 'Minerva.app');
  return fs.existsSync(path.join(p, 'Contents', 'MacOS', 'Minerva')) ? p : null;
}

let app: string | null;
let home: string;
let work: string;
test.beforeAll(() => {
  app = packagedApp();
  home = makeTempDir('minerva-e2e-check-code-home-');
  work = makeTempDir('minerva-e2e-check-code-work-');
});
test.afterAll(() => {
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(work, { recursive: true, force: true });
});

/**
 * Run the packaged CLI, bounded, then kill its whole process group: a worker
 * host is a renderer process, and Electron's helpers hold the pipes open.
 */
function minerva(args: string[], ms = 90_000): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(path.join(app!, 'Contents', 'MacOS', 'Minerva'), ['--minerva-cli', '--', ...args], {
      cwd: work, env: minervaEnv(home), detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
    const killGroup = () => { try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* already gone */ } };
    const timer = setTimeout(killGroup, ms);
    child.on('exit', (status) => {
      clearTimeout(timer);
      killGroup();
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ status, stdout, stderr });
    });
  });
}

const codeItems = (r: PluginCheckReport) => r.items.filter((i) => i.stage === 'code');
const report = (stdout: string, stderr: string): PluginCheckReport => {
  try { return JSON.parse(stdout) as PluginCheckReport; } catch { throw new Error(`not a report:\n${stdout}\n${stderr}`); }
};

test('a plugin whose code stays inside its capabilities passes, its handler run in a worker host (#2833)', async () => {
  test.skip(!app, 'needs the packaged app: pnpm build:e2e');
  const r = await minerva(['plugin', 'check', path.join(projectRoot, 'tests', 'fixtures', 'plugins', 'note-stats')]);
  const rep = report(r.stdout, r.stderr);
  expect(r.status, JSON.stringify(rep.items.filter((i) => i.status === 'fail'))).toBe(0);
  const code = codeItems(rep);
  expect(code.find((i) => i.subject === 'views and live blocks')?.status).toBe('skip');
  const commands = code.filter((i) => i.subject.startsWith('command count-selection × '));
  expect(commands.length).toBeGreaterThanOrEqual(2);
  for (const c of commands) expect(c, JSON.stringify(c)).toMatchObject({ status: 'pass', detail: 'ran' });
});

test('code that calls past what it declares fails the check, naming each refused call (#2833)', async () => {
  test.skip(!app, 'needs the packaged app: pnpm build:e2e');
  const r = await minerva(['plugin', 'check', path.join(projectRoot, 'tests', 'fixtures', 'hostile-plugins', 'overreach')]);
  const rep = report(r.stdout, r.stderr);
  expect(r.status).toBe(1);
  const failed = codeItems(rep).filter((i) => i.status === 'fail');
  expect(failed.length).toBeGreaterThanOrEqual(1);
  for (const f of failed) {
    expect(f.subject).toMatch(/^command grab × /);
    expect(f.detail).toContain('notes.write needs the "notes:write" capability');
    expect(f.detail).toContain('ui.copyText needs the "ui" capability');
  }
});

test('a fresh command scaffold passes, its code run (#2833)', async () => {
  test.skip(!app, 'needs the packaged app: pnpm build:e2e');
  const made = await minerva(['plugin', 'new', 'title-tools', '--kind', 'command']);
  expect(made.status, made.stderr).toBe(0);
  const r = await minerva(['plugin', 'check', path.join(work, 'title-tools')]);
  const rep = report(r.stdout, r.stderr);
  expect(r.status, JSON.stringify(rep.items.filter((i) => i.status !== 'pass'))).toBe(0);
  const commands = codeItems(rep).filter((i) => i.subject.startsWith('command title-case × '));
  expect(commands.length).toBeGreaterThanOrEqual(2);
  for (const c of commands) expect(c).toMatchObject({ status: 'pass', detail: 'replaces the selection' });
});
