/**
 * Ingesting a URL can't make main request the local network (#2566). The URL
 * may come from a shared note or an LLM `propose_sources` card.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { useTempDir } from '../../helpers/temp-project';
import { ingestUrl } from '../../../src/main/sources/ingest';
import { setSafeFetchLookup } from '../../../src/main/safe-fetch';

const tmp = useTempDir('minerva-ingest-ssrf-');
afterEach(() => setSafeFetchLookup(async () => ['93.184.216.34']));

describe('ingestUrl (#2566)', () => {
  it('refuses a URL whose host resolves to a private address, without fetching it', async () => {
    setSafeFetchLookup(async () => ['10.0.0.7']);
    const fetchImpl = vi.fn();
    await expect(ingestUrl(tmp.root, 'http://intranet.example/wiki', { fetchImpl: fetchImpl as unknown as typeof fetch }))
      .rejects.toThrow(/private or local address/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refuses a public page that redirects to the cloud metadata address', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } }));
    await expect(ingestUrl(tmp.root, 'https://example.com/article', { fetchImpl: fetchImpl as unknown as typeof fetch }))
      .rejects.toThrow(/169\.254\.169\.254/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('still ingests a public page', async () => {
    const html = '<html><head><title>Public page</title></head><body><article><p>' + 'Readable text. '.repeat(40) + '</p></article></body></html>';
    const fetchImpl = vi.fn(async () => new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    const result = await ingestUrl(tmp.root, 'https://example.com/ok', { fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.title).toBe('Public page');
  });
});
