/**
 * End-to-end coverage for #1535 (rendered preview of a loose `.html` file) —
 * the security-critical half unit tests can't reach: does a real Chromium
 * iframe actually enforce what `HtmlPreview.svelte` and `html-preview-csp.ts`
 * claim it does. Two things checked here that a jsdom/happy-dom component
 * test cannot: (1) static markup genuinely renders, AND (2) an inline
 * `<script>` genuinely does NOT execute — proving the "static only" decision
 * (#1535's original scripted design turned out to be unimplementable: a
 * `srcdoc` document's CSP intersects with its parent's, so Minerva's own
 * strict top-level `script-src` blocks inline scripts no matter what CSP the
 * iframe declares — see `html-preview-csp.ts`) actually holds in the real
 * app, not just in this comment.
 *
 * Boots the in-tree `.vite/build` app, same as the other e2e specs — needs
 * `pnpm build:e2e` first (`pnpm test:e2e` does that).
 */
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { launchMinerva, projectRoot } from './helpers/launch';

const ARTIFACT_HTML = `<!DOCTYPE html>
<html>
<head><title>Artifact</title></head>
<body>
<p id="static">Static Content</p>
<script>
document.body.insertAdjacentHTML('beforeend', '<p id="dynamic">Dynamic ' + (1 + 1) + '</p>');
</script>
</body>
</html>
`;

async function launchWithHtmlFile() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-html-preview-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-html-preview-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'artifact.html'), ARTIFACT_HTML);
  fs.writeFileSync(
    path.join(userDataDir, 'session.json'),
    JSON.stringify([{ x: 80, y: 80, width: 1200, height: 800, rootPath: projectDir }]),
  );
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  return { app, userDataDir, projectDir };
}

async function waitForWorkspace(win: Page): Promise<void> {
  await win.waitForLoadState('domcontentloaded');
  await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
}

test('HTML preview: static-only sandboxed iframe renders markup but never runs scripts (#1535)', async () => {
  const { app, userDataDir, projectDir } = await launchWithHtmlFile();
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await waitForWorkspace(win);

    await expect(win.locator('[data-relative-path="artifact.html"]').first()).toBeVisible({ timeout: 10_000 });
    await win.locator('[data-relative-path="artifact.html"]').first().click();

    // Opens to Source by default (same default as markdown) — the raw text
    // shows up in CodeMirror, not a preview.
    await expect(win.locator('.cm-content')).toBeVisible({ timeout: 10_000 });
    await expect(win.locator('.cm-content')).toContainText('<title>Artifact</title>');

    await win.getByRole('button', { name: 'Preview', exact: true }).click();

    const iframe = win.locator('iframe.html-preview-frame');
    await expect(iframe).toBeVisible({ timeout: 10_000 });

    // The real DOM element carries the exact security shape: an EMPTY
    // sandbox token list (no scripting, no same-origin, no forms/popups/
    // navigation), no navigable src, and the embedded-enforcement csp
    // attribute with scripts locked to 'none'.
    expect(((await iframe.getAttribute('sandbox')) ?? '').trim()).toBe('');
    expect(await iframe.getAttribute('src')).toBeNull();
    const csp = await iframe.getAttribute('csp');
    expect(csp).toMatch(/script-src 'none'/);
    expect(csp).toMatch(/connect-src 'none'/);

    // Static markup renders...
    const frame = win.frameLocator('iframe.html-preview-frame');
    await expect(frame.locator('#static')).toHaveText('Static Content');
    // ...but the inline <script> never ran to add this element. Give it a
    // real beat to prove absence isn't just "hasn't happened yet."
    await win.waitForTimeout(1000);
    await expect(frame.locator('#dynamic')).toHaveCount(0);
  } finally {
    await app.close().catch(() => { /* already exited */ });
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
