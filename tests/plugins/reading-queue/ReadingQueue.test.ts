/**
 * @vitest-environment happy-dom
 *
 * The Reading Queue plugin (#2640), the worked example of a global view: its
 * model over the query's rows, and the panel — reading first, then up next;
 * a row opens its note and previews it; ✓ marks it read with the property
 * its kind uses; and the empty, failed and loading states. The plugin API is
 * the kanban kit's recording fake.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import App from '../../../plugins/reading-queue/src/App.svelte';
import { blockOptions, exportHtml, markReadPatch, queueItems } from '../../../plugins/reading-queue/src/queue';
import type { PluginQueryResults } from '../../../plugin-api/index';
import { fakeMinerva } from '../kanban/fixtures';

const N = (p: string) => `https://tb/note/${p}`;
const RESULTS: PluginQueryResults = {
  columns: ['note', 'title', 'kind', 'status', 'author'],
  rows: [
    { note: N('now'), title: 'Now', kind: 'book', status: 'reading' },
    { note: N('next'), title: 'Next', kind: 'book', status: 'to-read', author: 'Ann' },
    { note: N('next'), title: 'Next', kind: 'book', status: 'to-read', author: 'Bo' },
    { note: N('art'), title: 'Art', kind: 'article', status: 'unread' },
    { note: N('gone'), title: 'Not given', kind: 'book', status: 'to-read' },
  ],
  notes: { [N('now')]: 'books/now.md', [N('next')]: 'books/next.md', [N('art')]: 'articles/art.md' },
  truncated: false,
  error: null,
};

afterEach(() => cleanup());

describe('queueItems', () => {
  it('one item per note it was given, in the query order, the first row winning', () => {
    expect(queueItems(RESULTS)).toEqual([
      { path: 'books/now.md', title: 'Now', kind: 'book', reading: true, author: null },
      { path: 'books/next.md', title: 'Next', kind: 'book', reading: false, author: 'Ann' },
      { path: 'articles/art.md', title: 'Art', kind: 'article', reading: false, author: null },
    ]);
  });

  it('marks a book read by its status and an article by its read property', () => {
    expect(markReadPatch('book')).toEqual({ status: 'read' });
    expect(markReadPatch('article')).toEqual({ read: 'read' });
  });
});

describe('the Reading Queue panel', () => {
  async function shown(results: PluginQueryResults) {
    const fake = fakeMinerva();
    render(App, { props: { minerva: fake.minerva } });
    await tick();
    fake.emit('query', results);
    await tick();
    return fake;
  }

  it('waits for its query', () => {
    render(App, { props: { minerva: fakeMinerva().minerva } });
    expect(screen.getByText('Loading…')).toBeTruthy();
  });

  it('lists what is being read, then what is up next', async () => {
    await shown(RESULTS);
    expect(screen.getAllByRole('heading').map((h) => h.textContent)).toEqual(['Reading', 'Up next']);
    expect(screen.getAllByRole('listitem').map((li) => li.querySelector('.title')?.textContent)).toEqual(['Now', 'Next', 'Art']);
    expect(screen.queryByText('Not given')).toBeNull();
  });

  it('opens a note on click and asks for its preview on hover', async () => {
    const fake = await shown(RESULTS);
    const row = screen.getByText('Next').closest('button')!;
    await fireEvent.pointerEnter(row);
    await fireEvent.click(row);
    expect(fake.of('ui.openNote')).toEqual([{ path: 'books/next.md' }]);
    expect(fake.of('ui.previewNote')).toEqual([expect.objectContaining({ path: 'books/next.md', via: 'pointer' })]);
    await fireEvent.pointerLeave(row);
    expect(fake.of('ui.hidePreview')).toEqual([{ path: 'books/next.md', via: 'pointer' }]);
  });

  it('marks one read with its kind’s property, and says so', async () => {
    const fake = await shown(RESULTS);
    await fireEvent.click(screen.getByRole('button', { name: 'Mark Art read' }));
    await waitFor(() => expect(fake.of('ui.announce')).toEqual([{ text: 'Marked Art read.' }]));
    expect(fake.of('notes.setProperties')).toEqual([{ path: 'articles/art.md', properties: { read: 'read' } }]);
  });

  it('says when there is nothing to read, and when its query failed', async () => {
    await shown({ ...RESULTS, rows: [], notes: {} });
    expect(screen.getByText(/Nothing to read/)).toBeTruthy();
    cleanup();
    await shown({ columns: [], rows: [], notes: {}, truncated: false, error: 'Parse error' });
    expect(screen.getByText("The queue's query failed: Parse error")).toBeTruthy();
  });
});

describe('the Reading Queue as a block in a note (#2641)', () => {
  const block = (source: string, exportMode = false) => ({ block: 'queue', source, notePath: 'n.md', query: RESULTS, exportMode });

  it('takes limit: N from its text, and ignores anything else', () => {
    expect(blockOptions('limit: 2\n')).toEqual({ limit: 2 });
    expect(blockOptions('  limit:5  ')).toEqual({ limit: 5 });
    expect(blockOptions('limit: 0\n')).toEqual({ limit: null });
    expect(blockOptions('other: 1\nwords')).toEqual({ limit: null });
  });

  it('draws the queue from the block, to its limit, and asks for a frame as tall as the list', async () => {
    const fake = fakeMinerva();
    render(App, { props: { minerva: fake.minerva } });
    await tick();
    fake.emit('block', block('limit: 2'));
    await tick();
    expect(screen.getAllByRole('listitem').map((li) => li.querySelector('.title')?.textContent)).toEqual(['Now', 'Next']);
    await waitFor(() => expect(fake.of('view.setHeight').length).toBeGreaterThan(0));
    expect(fake.of('view.setHeight')[0]).toEqual({ height: expect.any(Number) });
  });

  it('answers an export with the list as static HTML, each title a link to its note', async () => {
    const fake = fakeMinerva();
    render(App, { props: { minerva: fake.minerva } });
    await tick();
    fake.emit('block', block('', true));
    fake.emit('export', { requestId: 'r1' });
    await waitFor(() => expect(fake.of('view.provideExport')).toHaveLength(1));
    const { requestId, html } = fake.of('view.provideExport')[0] as { requestId: string; html: string };
    expect(requestId).toBe('r1');
    const el = document.createElement('div');
    el.innerHTML = html;
    expect([...el.querySelectorAll('[data-note-path]')].map((n) => [n.getAttribute('data-note-path'), n.textContent])).toEqual([
      ['books/now.md', 'Now'], ['books/next.md', 'Next'], ['articles/art.md', 'Art'],
    ]);
    expect(html).not.toMatch(/<(script|style|button|img)/);
  });

  it('escapes what the notes say in its export', () => {
    const html = exportHtml([{ path: 'a"b.md', title: '<b>x</b>', kind: 'book', reading: true, author: 'A & B' }]);
    expect(html).toContain('data-note-path="a&quot;b.md"');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(html).toContain('A &amp; B');
  });
});
