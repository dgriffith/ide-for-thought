/**
 * @vitest-environment jsdom
 *
 * H1 of the 2026-10-02 review (#2552, #2554), driven through the
 * hostile-thoughtbase fixture rather than hand-written URLs. A shared
 * thoughtbase carries an .html lure and a note linking to it every way a note
 * can. The note goes through the real preview pipeline and sanitizer. Every
 * resulting link click must be cancelled by the renderer guard, and main must
 * refuse the navigation if it's attempted anyway.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeLocalHtmlLureThoughtbase } from '../helpers/hostile-thoughtbase';
import { createPreviewMarkdown } from '../../src/renderer/lib/preview/markdown-config';
import { sanitizeNoteHtml } from '../../src/renderer/lib/preview/sanitize-note-html';
import { installNavigationGuard, isAllowedLinkTarget } from '../../src/renderer/lib/app/navigation-guard';
import { isRendererEntry } from '../../src/main/security-helpers';

const ENTRY = 'file:///Applications/Minerva.app/Contents/Resources/app.asar/.vite/renderer/main_window/index.html';

let root = '';
let uninstall: (() => void) | null = null;
afterEach(() => {
  uninstall?.();
  uninstall = null;
  document.body.innerHTML = '';
  if (root) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-h1-'));
  return writeLocalHtmlLureThoughtbase(root);
}

function renderNote(src: string): string {
  const md = createPreviewMarkdown({
    collapsedFences: new Set<number>(),
    runningFences: new Set<number>(),
    getRenderPathOverride: () => null,
    getNotePath: () => 'reading-list.md',
    getCanRun: () => false,
  });
  return sanitizeNoteHtml(md.render(src));
}

describe('H1: a thoughtbase .html lure never becomes the window\'s page (#2552, #2554)', () => {
  it('the renderer guard cancels every rendered link to it', () => {
    const fx = fixture();
    uninstall = installNavigationGuard();
    document.body.innerHTML = `<div class="preview">${renderNote(fs.readFileSync(path.join(fx.root, fx.noteRel), 'utf-8'))}</div>`;
    const anchors = [...document.querySelectorAll('a')];
    // markdown-it's validateLink refuses `file:` URLs, so those two never
    // become links at all; they stay as text. Every href that does survive
    // must be cancelled.
    const linked = anchors.map((a) => a.getAttribute('href'));
    expect(linked).toEqual(fx.hrefs.filter((h) => !h.startsWith('file:')));
    expect(document.body.textContent).toContain('Saved page 3');
    for (const a of anchors) {
      const e = new MouseEvent('click', { bubbles: true, cancelable: true });
      a.dispatchEvent(e);
      expect(e.defaultPrevented, a.getAttribute('href') ?? '').toBe(true);
    }
  });

  it('none of its hrefs is an allowed link target from the packaged page', () => {
    const fx = fixture();
    for (const href of fx.hrefs) expect(isAllowedLinkTarget(href, ENTRY), href).toBe(false);
  });

  it('main refuses each resolved URL as a navigation target, and still allows its own page', () => {
    const fx = fixture();
    for (const href of [...fx.hrefs, fx.lureFileUrl]) {
      const resolved = new URL(href, ENTRY).href;
      expect(isRendererEntry(resolved, ENTRY), resolved).toBe(false);
    }
    expect(isRendererEntry(ENTRY, ENTRY)).toBe(true);
  });
});
