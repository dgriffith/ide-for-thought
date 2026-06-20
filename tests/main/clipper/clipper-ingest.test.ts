/**
 * Clipper extraction wiring (#790). Mocks the underlying Source pipeline so the
 * test isolates the mapping logic: HTML → ingestHtmlString, selection →
 * createExcerpt, and the upstream-tags setting passed through.
 */

import { it, expect, beforeEach, vi } from 'vitest';

const { ingestHtmlString, createExcerpt, getIngestSettings, addSourceTag, createAboutNote } = vi.hoisted(() => ({
  ingestHtmlString: vi.fn(),
  createExcerpt: vi.fn(),
  getIngestSettings: vi.fn(),
  addSourceTag: vi.fn(),
  createAboutNote: vi.fn(),
}));

vi.mock('../../../src/main/sources/ingest', () => ({ ingestHtmlString }));
vi.mock('../../../src/main/sources/create-excerpt', () => ({ createExcerpt }));
vi.mock('../../../src/main/sources/about-note', () => ({ createAboutNote }));
vi.mock('../../../src/main/sources/source-meta-write', () => ({ addSourceTag }));
vi.mock('../../../src/main/sources/ingest-settings', () => ({ getIngestSettings }));

import { clipperIngest } from '../../../src/main/clipper/clipper-ingest';

beforeEach(() => {
  vi.clearAllMocks();
  getIngestSettings.mockResolvedValue({ importUpstreamTags: true });
  ingestHtmlString.mockResolvedValue({
    sourceId: 'url-abc123',
    relativePath: '.minerva/sources/url-abc123/meta.ttl',
    duplicate: false,
    title: 'A Page',
    kind: 'web',
  });
  createExcerpt.mockResolvedValue({ excerptId: 'url-abc123-deadbeef0000', relativePath: '...', duplicate: false });
  addSourceTag.mockResolvedValue(true);
  createAboutNote.mockResolvedValue({ relativePath: 'note-on-a-page.md' });
});

it('runs HTML through ingestHtmlString with url + title fallback + the tags setting', async () => {
  getIngestSettings.mockResolvedValue({ importUpstreamTags: false });
  const out = await clipperIngest(
    { url: 'https://example.com/a', html: '<h1>Hi</h1>', pageTitle: 'A' },
    '/tmp/project',
  );
  expect(ingestHtmlString).toHaveBeenCalledWith('/tmp/project', '<h1>Hi</h1>', {
    url: 'https://example.com/a',
    titleFallback: 'A',
    importUpstreamTags: false,
  });
  expect(out).toMatchObject({ sourceId: 'url-abc123', duplicate: false, title: 'A Page' });
});

it('files a thought:Excerpt when a selection is present', async () => {
  const out = await clipperIngest(
    { url: 'https://example.com/a', html: '<h1>Hi</h1>', selection: '  a quoted passage  ' },
    '/tmp/project',
  );
  expect(createExcerpt).toHaveBeenCalledWith('/tmp/project', {
    sourceId: 'url-abc123',
    citedText: 'a quoted passage', // trimmed
  });
  expect(out.excerptId).toBe('url-abc123-deadbeef0000');
  expect(out.excerptDuplicate).toBe(false);
});

it('skips the excerpt when the selection is absent or whitespace', async () => {
  await clipperIngest({ html: '<h1>Hi</h1>' }, '/tmp/project');
  await clipperIngest({ html: '<h1>Hi</h1>', selection: '   ' }, '/tmp/project');
  expect(createExcerpt).not.toHaveBeenCalled();
});

it('applies popup tags and reports the ones newly added (#793)', async () => {
  addSourceTag.mockResolvedValueOnce(true).mockResolvedValueOnce(false); // 2nd already present
  const out = await clipperIngest(
    { html: '<h1>Hi</h1>', tags: ['ai', 'dup', '  ', ''] },
    '/tmp/project',
  );
  expect(addSourceTag).toHaveBeenCalledTimes(2); // blank tags skipped
  expect(addSourceTag).toHaveBeenNthCalledWith(1, '/tmp/project', 'url-abc123', 'ai');
  expect(out.tags).toEqual(['ai']); // only the newly-added one
});

it('files an about-note from the popup note (#793)', async () => {
  const out = await clipperIngest(
    { html: '<h1>Hi</h1>', note: '  worth revisiting  ' },
    '/tmp/project',
  );
  expect(createAboutNote).toHaveBeenCalledWith('/tmp/project', {
    sourceId: 'url-abc123',
    title: 'Note on A Page',
    body: 'worth revisiting', // trimmed
  });
  expect(out.notePath).toBe('note-on-a-page.md');
});

it('skips tags/note application when none are supplied', async () => {
  const out = await clipperIngest({ html: '<h1>Hi</h1>' }, '/tmp/project');
  expect(addSourceTag).not.toHaveBeenCalled();
  expect(createAboutNote).not.toHaveBeenCalled();
  expect(out.tags).toBeUndefined();
  expect(out.notePath).toBeUndefined();
});
