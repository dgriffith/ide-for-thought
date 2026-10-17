/**
 * @vitest-environment jsdom
 *
 * A plugin's note template that emits <script>, <style> and an event handler
 * (#2655, the `script-template` case in tests/helpers/hostile-plugins.ts).
 * A template is only ever note text: a new note starts from it, and the
 * preview renders it through the same sanitizer as any note (#2557). So it
 * loads, and none of it runs or restyles the app. jsdom, as the sanitizer's
 * own test explains.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sanitizeNoteHtml } from '../../../src/renderer/lib/preview/sanitize-note-html';
import { createPreviewMarkdown } from '../../../src/renderer/lib/preview/markdown-config';
import { PLUGIN_CANARY, buildScriptTemplatePlugin } from '../../helpers/hostile-plugins';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-template-'));

describe('a plugin template carrying script and style (#2655)', () => {
  it('renders as a note does: no script, no style, no handler', () => {
    const root = buildScriptTemplatePlugin(tmp);
    const template = fs.readFileSync(path.join(root, 'templates', 'Trap.md'), 'utf-8');
    const md = createPreviewMarkdown({
      collapsedFences: new Set<number>(),
      runningFences: new Set<number>(),
      getRenderPathOverride: () => null,
      getNotePath: () => null,
      getCanRun: () => false,
    });
    const html = sanitizeNoteHtml(md.render(template, {}));
    expect(html).not.toMatch(/<script|<style|onerror/i);
    expect(html).not.toContain(PLUGIN_CANARY);
    expect(html).toContain('Trap');
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
