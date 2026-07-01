/**
 * fileSourceProperties (#943): the propose_source_properties apply path now
 * routes the meta.ttl upsert through the approval engine's source-meta payload
 * instead of writing directly. Verifies the predicates land in meta.ttl AND an
 * approved thought:Proposal backs the write (the Trust Principle audit record) —
 * the last of the approval-bypass sites the audit flagged.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileSourceProperties } from '../../../src/main/llm/source-properties';
import { ttlString } from '../../../src/main/sources/source-meta-write';
import { initGraph, indexSource, queryGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

const META = `this: a thought:Article ;
    dc:title "Test paper" ;
    dc:creator "Alice" ;
    thought:accessedAt "2026-05-01T00:00:00Z"^^xsd:dateTime .
`;

let root: string;
let ctx: ProjectContext;
const sourceId = 'smith-2023';

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-source-props-'));
  ctx = projectContext(root);
  await initGraph(ctx);
  const dir = path.join(root, '.minerva', 'sources', sourceId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.ttl'), META);
  indexSource(ctx, sourceId, META);
});
afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

function metaOnDisk(): string {
  return fs.readFileSync(path.join(root, '.minerva', 'sources', sourceId, 'meta.ttl'), 'utf-8');
}

async function approvedSourcePropsCount(): Promise<number> {
  const r = await queryGraph(ctx, `
    PREFIX thought: <https://minerva.dev/ontology/thought#>
    SELECT ?p WHERE {
      ?p a thought:Proposal ;
         thought:operationType "source_properties" ;
         thought:proposalStatus thought:approved .
    }`);
  return r.results.length;
}

describe('fileSourceProperties (#943)', () => {
  it('upserts the predicates into meta.ttl AND files an approved proposal', async () => {
    const { changedPredicates } = await fileSourceProperties(root, sourceId, [
      { predicate: 'dc:abstract', value: ttlString('An abstract.') },
      { predicate: 'thought:tldr', value: ttlString('The gist.') },
    ]);

    expect(changedPredicates.sort()).toEqual(['dc:abstract', 'thought:tldr']);
    const meta = metaOnDisk();
    expect(meta).toContain('dc:abstract "An abstract." ;');
    expect(meta).toContain('thought:tldr "The gist." ;');
    // Trust principle: an approved source_properties proposal backs the write.
    expect(await approvedSourcePropsCount()).toBe(1);
  });

  it('files no proposal for a no-op (predicate already at that value)', async () => {
    await fileSourceProperties(root, sourceId, [
      { predicate: 'dc:title', value: ttlString('Test paper') }, // unchanged
    ]);
    expect(await approvedSourcePropsCount()).toBe(0);
    // meta.ttl still has exactly one dc:title line.
    expect((metaOnDisk().match(/dc:title/g) ?? []).length).toBe(1);
  });
});
