/**
 * Exports render the preview's own markdown extensions (#2515): callouts
 * (flashcards with their answer shown), ==highlight==, DOI auto-links and
 * heading ids — and a [[note#Heading]] link lands on the heading's id.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { resolvePlan } from '../../../src/main/publish/pipeline';
import { renderNoteBody } from '../../../src/main/publish/exporters/note-html/render';
import { NOTE_HTML_STYLE } from '../../../src/main/publish/exporters/note-html/style';
import { STATIC_SITE_STYLE } from '../../../src/main/publish/exporters/static-site/style';

let root: string;
beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-md-parity-'));
  await fsp.writeFile(path.join(root, 'a.md'), [
    '# A', '',
    '> [!warning] Mind the gap', '> Trams run late.', '',
    '> [!card] ^c1', '> Capital of Hungary?', '>', '> ---', '>', '> Budapest', '',
    'This is ==important== and cites 10.1000/xyz123.', '',
    '## Opening Hours', '', 'See [[b#Getting There]].',
  ].join('\n'), 'utf-8');
  await fsp.writeFile(path.join(root, 'b.md'), '# B\n\n## Getting There\n\nTram 22.\n', 'utf-8');
});
afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

async function body(file: string): Promise<string> {
  const plan = await resolvePlan(root, { kind: 'project' }, { linkPolicy: 'follow-to-file' });
  return renderNoteBody(plan.inputs.find((f) => f.relativePath === file)!, plan);
}

describe('export markdown parity (#2515)', () => {
  it('callouts render as the preview\'s callout markup, not raw [!markers]', async () => {
    const html = await body('a.md');
    expect(html).toContain('callout-warning');
    expect(html).toContain('Mind the gap');
    expect(html).not.toContain('[!warning]');
  });

  it('a flashcard shows its front and its answer', async () => {
    const html = await body('a.md');
    expect(html).toContain('callout-card');
    expect(html).toContain('Capital of Hungary?');
    expect(html).toContain('Budapest');
    expect(html).not.toContain('[!card]');
  });

  it('==highlight== and DOIs render as in the preview', async () => {
    const html = await body('a.md');
    expect(html).toContain('<mark class="hl">important</mark>');
    expect(html).toMatch(/<a [^>]*href="https:\/\/doi\.org\/10\.1000\/xyz123"/);
  });

  it('headings carry ids, and a [[note#Heading]] link lands on one', async () => {
    expect(await body('a.md')).toContain('<h2 id="opening-hours">Opening Hours</h2>');
    expect(await body('a.md')).toContain('href="b.html#getting-there"');
    expect(await body('b.md')).toContain('id="getting-there"');
  });

  it('both export stylesheets style callouts', () => {
    expect(NOTE_HTML_STYLE).toContain('.callout-warning');
    expect(STATIC_SITE_STYLE).toContain('.callout-warning');
    expect(NOTE_HTML_STYLE).toContain('mark.hl-green');
  });
});
