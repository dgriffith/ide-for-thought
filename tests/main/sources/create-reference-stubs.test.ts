/**
 * Materialising approved reference candidates as stub Source nodes
 * (#106). Writes meta.ttl per accepted reference + adds
 * `minerva:references` edges from the parent.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  initGraph,
  indexSource,
  getSourceDetail,
} from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import {
  createReferenceStubs,
  appendReferencesEdges,
} from '../../../src/main/sources/create-reference-stubs';
import type { ParsedReference } from '../../../src/shared/mine-references';

const PARENT_TTL = `this: a thought:Article ;
    dc:title "Parent paper" ;
    bibo:doi "10.1/parent" ;
    thought:accessedAt "2026-05-01T00:00:00Z"^^xsd:dateTime .
`;

function makeRef(overrides: Partial<ParsedReference>): ParsedReference {
  return {
    raw: 'Smith, J. (2024). Foo bar. Journal X, 12(3), 45-67.',
    title: 'Foo bar',
    authors: ['Smith, J.'],
    year: '2024',
    containerTitle: 'Journal X',
    doi: null,
    arxiv: null,
    pubmed: null,
    isbn: null,
    url: null,
    subtype: 'Article',
    ...overrides,
  };
}

describe('appendReferencesEdges', () => {
  it('inserts one minerva:references line per id before the final dot', () => {
    const out = appendReferencesEdges(PARENT_TTL, ['stub-a', 'stub-b']);
    expect(out).toContain('minerva:references sources:stub-a ;');
    expect(out).toContain('minerva:references sources:stub-b ;');
    // Order preserves the parent's final accessedAt as the .-terminated line.
    expect(out.indexOf('minerva:references')).toBeLessThan(out.indexOf('thought:accessedAt'));
  });

  it('dedupes against existing references already on the parent', () => {
    const withOne = appendReferencesEdges(PARENT_TTL, ['stub-a']);
    const again = appendReferencesEdges(withOne, ['stub-a', 'stub-b']);
    // Single occurrence of stub-a, fresh occurrence of stub-b.
    expect((again.match(/sources:stub-a/g) ?? []).length).toBe(1);
    expect(again).toContain('sources:stub-b');
  });

  it('is a no-op when every input is already present', () => {
    const withBoth = appendReferencesEdges(PARENT_TTL, ['a', 'b']);
    expect(appendReferencesEdges(withBoth, ['a', 'b'])).toBe(withBoth);
  });
});

describe('createReferenceStubs', () => {
  let root: string;
  let ctx: ProjectContext;
  const parentId = 'doi-10.1_parent';

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-stubs-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    const parentDir = path.join(root, '.minerva', 'sources', parentId);
    fs.mkdirSync(parentDir, { recursive: true });
    fs.writeFileSync(path.join(parentDir, 'meta.ttl'), PARENT_TTL);
    indexSource(ctx, parentId, PARENT_TTL);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('creates a stub source folder per accepted reference and links from parent', async () => {
    const refs: ParsedReference[] = [
      makeRef({ title: 'Ref one' }),
      makeRef({ title: 'Ref two', authors: ['Jones, K.'], year: '2023' }),
    ];
    const result = await createReferenceStubs(root, parentId, refs);

    expect(result.created).toHaveLength(2);
    expect(result.matchedExisting).toEqual([]);
    expect(result.skipped).toEqual([]);

    // Stub meta.ttl files exist on disk.
    for (const c of result.created) {
      const ttl = fs.readFileSync(path.join(root, '.minerva', 'sources', c.sourceId, 'meta.ttl'), 'utf-8');
      expect(ttl).toContain('thought:stubStatus "unresolved"');
      expect(ttl).toContain('thought:rawReference');
    }

    // Parent's references edges land in the graph.
    const detail = getSourceDetail(ctx, parentId);
    const refTitles = detail!.references.map((r) => r.title).sort();
    expect(refTitles).toEqual(['Ref one', 'Ref two']);
    expect(detail!.references.every((r) => r.stubStatus === 'unresolved')).toBe(true);
  });

  it('matchedExisting when a stub already lives at the canonical id', async () => {
    const ref = makeRef({ title: 'Already here', doi: '10.1/already' });
    // Pre-create at the canonical id.
    const { canonicalSourceId } = await import('../../../src/main/sources/source-id');
    const { id } = canonicalSourceId({ doi: ref.doi! });
    const dir = path.join(root, '.minerva', 'sources', id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'meta.ttl'), `this: a thought:Article ; dc:title "Existing" .\n`);
    indexSource(ctx, id, `this: a thought:Article ; dc:title "Existing" .\n`);

    const result = await createReferenceStubs(root, parentId, [ref]);
    expect(result.created).toEqual([]);
    expect(result.matchedExisting).toHaveLength(1);

    // Parent still gets the edge.
    const detail = getSourceDetail(ctx, parentId);
    expect(detail!.references).toHaveLength(1);
    // Existing source's title is preserved (not the stub's would-be title).
    expect(detail!.references[0].title).toBe('Existing');
  });

  it('uses DOI for canonical id when present', async () => {
    const ref = makeRef({ doi: '10.1/foo' });
    const result = await createReferenceStubs(root, parentId, [ref]);
    expect(result.created[0].sourceId).toBe('doi-10.1_foo');
  });

  it('falls back to a content-hash id when no identifier was extracted', async () => {
    const ref = makeRef({ doi: null, arxiv: null, pubmed: null, isbn: null, url: null });
    const result = await createReferenceStubs(root, parentId, [ref]);
    expect(result.created[0].sourceId).toMatch(/^sha-[a-f0-9]+$/);
  });

  it('dedupes within a single batch when two refs hash to the same id', async () => {
    const ref = makeRef({ title: 'Same title', authors: ['Same'], year: '2024' });
    const result = await createReferenceStubs(root, parentId, [ref, ref]);
    // Second occurrence matches the just-created stub.
    expect(result.created).toHaveLength(1);
    expect(result.matchedExisting).toHaveLength(1);
    // Only one references edge on the parent (dedupe in append).
    const detail = getSourceDetail(ctx, parentId);
    expect(detail!.references).toHaveLength(1);
  });
});
