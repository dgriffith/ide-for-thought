/**
 * @vitest-environment jsdom
 *
 * Snapshotting a mounted live block into self-contained static HTML (#2510):
 * its own CSS (and only its own), scoped; its theme tokens resolved; its
 * rows turned into links main can resolve.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { snapshotLiveBlock } from '../../../src/renderer/lib/export/live-block-snapshot';

afterEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; });

function setup(): HTMLElement {
  const style = document.createElement('style');
  style.textContent = [
    '.tv-list-row { color: var(--text); padding: 4px; }',
    '.tv-list-row:hover { background: var(--accent); }',
    '.tv-table td { border-bottom: 1px solid var(--border); }',
    '.unrelated-panel { color: red; }',
    ':root { --text: #ccc; }',
    'body .tv-list-row { margin: 0; }',
    '@media (max-width: 600px) { .tv-list-row { padding: 2px; } .nope { color: blue; } }',
  ].join('\n');
  document.head.appendChild(style);
  const themed = document.createElement('div');
  themed.setAttribute('data-theme', 'light');
  themed.style.setProperty('--text', '#111');
  themed.style.setProperty('--accent', '#3b6fd4');
  themed.style.setProperty('--border', '#ddd');
  themed.innerHTML = `
    <div class="object-view-block">
      <button class="tv-list-row" type="button" title="places/Kampa.md" data-note-path="places/Kampa.md"><span>Kampa</span></button>
      <table class="tv-table"><tbody><tr data-note-path="places/Petřín.md"><td><span>Petřín</span></td><td>park</td></tr></tbody></table>
    </div>`;
  document.body.appendChild(themed);
  return themed;
}

describe('snapshotLiveBlock', () => {
  it('keeps exactly the rules that apply, scoped under the block wrapper', () => {
    const html = snapshotLiveBlock(setup());
    expect(html.startsWith('<div class="minerva-live-block"><style>')).toBe(true);
    expect(html).toContain('.minerva-live-block .tv-list-row{');
    expect(html).toContain('.minerva-live-block .tv-list-row:hover{'); // tested without the pseudo-class
    expect(html).toContain('.minerva-live-block .tv-table td{');
    expect(html).toMatch(/@media \(max-width: 600px\)\{\.minerva-live-block \.tv-list-row\{/);
    expect(html).not.toContain('unrelated-panel');
    expect(html).not.toContain('.nope');
    expect(html).not.toContain(':root');
    expect(html).not.toContain('body .tv-list-row'); // document-level selectors never belong to a block
  });

  it('resolves the theme tokens its rules use, inline on the themed element', () => {
    const html = snapshotLiveBlock(setup());
    expect(html).toMatch(/<div data-theme="light" style="[^"]*--text:\s*#111/);
    expect(html).toMatch(/--accent:\s*#3b6fd4/);
    expect(html).toMatch(/--border:\s*#ddd/);
  });

  it('turns rows into links main can resolve: the element itself, or a table row\'s first cell', () => {
    const html = snapshotLiveBlock(setup());
    expect(html).toContain('<a class="tv-list-row" title="places/Kampa.md" data-note-link="places/Kampa.md"><span>Kampa</span></a>');
    expect(html).toContain('<tr><td><a data-note-link="places/Petřín.md"><span>Petřín</span></a></td><td>park</td></tr>');
    expect(html).not.toContain('data-note-path');
    expect(html).not.toContain('<button');
  });

  it('leaves the live DOM untouched (it snapshots a clone)', () => {
    const themed = setup();
    snapshotLiveBlock(themed);
    expect(themed.querySelector('button.tv-list-row')).not.toBeNull();
  });
});
