// Semgrep rule tests for .semgrep/minerva.yml (#2570). `uvx semgrep --test .semgrep`
// checks every `ruleid:` line fires and every `ok:` line doesn't.
import { ipcMain, BrowserWindow } from 'electron';
import { spawn, execFile } from 'node:child_process';
import MarkdownIt from 'markdown-it';

// ruleid: minerva-ipc-handler-without-sender-check
ipcMain.handle('x:y', async () => 1);

// ruleid: minerva-ipc-handler-without-sender-check
ipcMain.on('x:z', (e, arg) => { doThing(arg); });

// ok: minerva-ipc-handler-without-sender-check
ipcMain.on('x:w', (e, arg) => {
  if (!isTrustedIpcSender(e)) return;
  doThing(arg);
});

function renderUnsafe(md: string) {
  // ruleid: minerva-markdown-it-html-unsanitized
  const it = new MarkdownIt({ html: true, linkify: true });
  return it.render(md);
}

function renderSafe(md: string) {
  // ok: minerva-markdown-it-html-unsanitized
  const it = new MarkdownIt({ html: true });
  const out = sanitizeExportHtml(it.render(md));
  return out;
}

function renderNoHtml(md: string) {
  // ok: minerva-markdown-it-html-unsanitized
  return new MarkdownIt({ html: false }).render(md);
}

// ruleid: minerva-spawn-inherits-process-env
spawn('python3', ['-c', 'x'], { env: { ...process.env, FOO: '1' } });

// ruleid: minerva-spawn-inherits-process-env
execFile('git', ['status'], { env: process.env });

// ok: minerva-spawn-inherits-process-env
spawn('python3', ['-c', 'x'], { env: buildKernelEnv(process.env) });

declare function doThing(a: unknown): void;
declare function isTrustedIpcSender(e: unknown): boolean;
declare function sanitizeExportHtml(s: string): string;
declare function buildKernelEnv(e: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
export { BrowserWindow };
