/**
 * Clipper extraction wiring (#790). Mocks the underlying Source pipeline so the
 * test isolates the mapping logic: HTML → ingestHtmlString, selection →
 * createExcerpt, and the upstream-tags setting passed through.
 */

import { it, expect, beforeEach, vi } from 'vitest';

const { ingestHtmlString, createExcerpt, getIngestSettings } = vi.hoisted(() => ({
  ingestHtmlString: vi.fn(),
  createExcerpt: vi.fn(),
  getIngestSettings: vi.fn(),
}));

vi.mock('../../../src/main/sources/ingest', () => ({ ingestHtmlString }));
vi.mock('../../../src/main/sources/create-excerpt', () => ({ createExcerpt }));
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
