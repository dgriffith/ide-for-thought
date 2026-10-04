/**
 * Every `{@html …}` sink in the renderer is a reviewed one (#2563).
 *
 * `{@html}` injects a string as markup. Fed anything a note, a source, a
 * model or a third-party library wrote, it is renderer XSS — and in Electron
 * the renderer holds `window.api`. Each sink below was read and its input
 * shown safe: sanitized (DOMPurify), rendered by markdown-it with
 * `html: false`, or static. `ComputeDraftCard`'s safety-flag sink was the one
 * that wasn't (#2563) — static strings today, but an unsanitized sink a later
 * flag interpolating cell text would have turned into a hole.
 *
 * The list is keyed by file and EXPRESSION, so a new sink, or an existing one
 * switched to a different input, fails here until someone reviews it and adds
 * the entry with its reason. Shrink-only: a sink that goes away must leave the
 * list too. Comments are skipped (several files explain why they *aren't*
 * using `{@html}`).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const RENDERER = path.join(__dirname, '..', '..', 'src', 'renderer');

/** `file → { expression → why it is safe }`. */
const REVIEWED_SINKS: Record<string, Record<string, string>> = {
  'lib/components/Icon.svelte': {
    path: 'static SVG path data from the bundled icon table',
  },
  'lib/components/Preview.svelte': {
    rendered: 'note markdown, through sanitizeNoteHtml (DOMPurify) in renderContent',
    'sanitizeNoteHtml(entry)': 'CSL bibliography entry, DOMPurify',
    'sanitizeNoteHtml(tooltipHtml)': 'hover tooltip, DOMPurify',
  },
  'lib/components/ComputeDraftCard.svelte': {
    'sanitizeComputeOutputHtml(output.data)': 'compute SVG output, DOMPurify',
    'sanitizeComputeOutputHtml(output.html)': 'compute _repr_html_ output, DOMPurify',
  },
  'lib/components/SourceDetail.svelte': {
    'renderInlineWithMath(displaySourceTitle(detail.metadata))': 'source title, markdown-it html:false',
    'renderInlineWithMath(detail.metadata.abstract)': 'source abstract, markdown-it html:false',
  },
  'lib/components/conversations/MessageList.svelte': {
    'renderMarkdownCached(msg.content)': 'chat message, markdown-it html:false',
    'renderMarkdownCached(failure.partial)': 'partial chat message, markdown-it html:false',
  },
};

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return walk(full);
    return e.name.endsWith('.svelte') ? [full] : [];
  });
}

/** Blank out HTML, block and line comments (length-preserving). */
function stripComments(src: string): string {
  return src
    .replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead: string) => lead + ' '.repeat(m.length - lead.length));
}

function sinksIn(src: string): string[] {
  return [...stripComments(src).matchAll(/\{@html\s+([^}]+?)\s*\}/g)].map((m) => m[1]!.trim());
}

describe('renderer {@html} sinks are reviewed (#2563)', () => {
  const found: Record<string, string[]> = {};
  for (const abs of walk(RENDERER)) {
    const sinks = sinksIn(fs.readFileSync(abs, 'utf-8'));
    if (sinks.length) found[path.relative(RENDERER, abs).split(path.sep).join('/')] = sinks;
  }

  it('every sink is on the reviewed list', () => {
    const unreviewed = Object.entries(found).flatMap(([file, sinks]) =>
      sinks.filter((s) => !(s in (REVIEWED_SINKS[file] ?? {}))).map((s) => `${file}: {@html ${s}}`),
    );
    expect(
      unreviewed,
      'Unreviewed {@html} sink(s). Render text instead, or pass the input through a sanitizer, then add the ' +
        'sink to REVIEWED_SINKS with why its input is safe. See docs/architecture-ratchets.md.',
    ).toEqual([]);
  });

  it('the list holds no sink that no longer exists', () => {
    const stale = Object.entries(REVIEWED_SINKS).flatMap(([file, sinks]) =>
      Object.keys(sinks).filter((s) => !(found[file] ?? []).includes(s)).map((s) => `${file}: {@html ${s}}`),
    );
    expect(stale).toEqual([]);
  });
});
