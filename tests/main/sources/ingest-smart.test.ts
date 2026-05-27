/**
 * Smart-route ingest (#473) — exercise the dispatch logic with
 * stubbed adapters / network so we can assert which path was taken
 * without making real HTTP calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initGraph } from '../../../src/main/graph/index';
import { projectContext } from '../../../src/main/project-context-types';

// Stub the two heavy ingest paths so we just observe which one was
// called and pass through a synthetic result.
vi.mock('../../../src/main/sources/ingest-identifier', async () => {
  const actual = await vi.importActual<typeof import('../../../src/main/sources/ingest-identifier')>(
    '../../../src/main/sources/ingest-identifier',
  );
  return {
    ...actual,
    ingestIdentifier: vi.fn(async (_root: string, raw: string) => ({
      sourceId: `id::${raw}`,
      relativePath: 'meta.ttl',
      duplicate: false,
      title: 'identifier-route',
      kind: 'doi',
      pdfSaved: false,
      pdfError: null,
    })),
  };
});

vi.mock('../../../src/main/sources/ingest', async () => {
  const actual = await vi.importActual<typeof import('../../../src/main/sources/ingest')>(
    '../../../src/main/sources/ingest',
  );
  return {
    ...actual,
    ingestUrl: vi.fn(async (_root: string, url: string) => ({
      sourceId: `url::${url}`,
      relativePath: 'meta.ttl',
      duplicate: false,
      title: 'url-route',
    })),
  };
});

import { ingestSmart } from '../../../src/main/sources/ingest-smart';
import { ingestIdentifier } from '../../../src/main/sources/ingest-identifier';
import { ingestUrl } from '../../../src/main/sources/ingest';

describe('ingestSmart (#473)', () => {
  let root: string;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-ingest-smart-'));
    await initGraph(projectContext(root));
    vi.clearAllMocks();
  });
  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('routes a bare DOI to identifier ingest', async () => {
    const result = await ingestSmart(root, '10.1145/3677999.3678002');
    expect(result.route).toBe('identifier');
    expect(ingestIdentifier).toHaveBeenCalledWith(root, '10.1145/3677999.3678002', expect.anything());
    expect(ingestUrl).not.toHaveBeenCalled();
  });

  it('routes a DOI URL to identifier ingest (detectIdentifier handles it)', async () => {
    await ingestSmart(root, 'https://doi.org/10.1145/3677999.3678002');
    expect(ingestIdentifier).toHaveBeenCalled();
    expect(ingestUrl).not.toHaveBeenCalled();
  });

  it('routes an arXiv id to identifier ingest', async () => {
    await ingestSmart(root, '2301.12345');
    expect(ingestIdentifier).toHaveBeenCalled();
    expect(ingestUrl).not.toHaveBeenCalled();
  });

  it('routes a bare URL to URL ingest', async () => {
    const result = await ingestSmart(root, 'https://example.com/article');
    expect(result.route).toBe('url');
    expect(ingestUrl).toHaveBeenCalledWith(root, 'https://example.com/article', expect.anything());
    expect(ingestIdentifier).not.toHaveBeenCalled();
  });

  it('extracts a DOI from surrounding text and routes to identifier', async () => {
    await ingestSmart(root, 'See 10.1145/3677999.3678002 for details.');
    expect(ingestIdentifier).toHaveBeenCalledWith(root, '10.1145/3677999.3678002', expect.anything());
    expect(ingestUrl).not.toHaveBeenCalled();
  });

  it('strips trailing period when extracting a DOI from prose', async () => {
    await ingestSmart(root, 'cite 10.1145/3677999.3678002.');
    expect(ingestIdentifier).toHaveBeenCalledWith(root, '10.1145/3677999.3678002', expect.anything());
  });

  it('throws on unrecognised input', async () => {
    await expect(ingestSmart(root, 'banana')).rejects.toThrow(/Not a recognised/);
    await expect(ingestSmart(root, '')).rejects.toThrow(/Empty/);
  });
});
