/**
 * fileSourceProperties (#943): the propose_source_properties apply path now
 * routes the meta.ttl upsert through the approval engine's source-meta payload
 * instead of writing directly. Verifies the predicates land in meta.ttl AND an
 * approved thought:Proposal backs the write (the Trust Principle audit record) —
 * the last of the approval-bypass sites the audit flagged.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileSourceProperties } from '../../../src/main/llm/source-properties';
import { ttlString } from '../../../src/main/sources/source-meta-write';
import { indexSource, queryGraph } from '../../../src/main/graph/index';
import { useGraphProject } from '../../helpers/temp-project';

const META = `this: a thought:Article ;
    dc:title "Test paper" ;
    dc:creator "Alice" ;
    thought:accessedAt "2026-05-01T00:00:00Z"^^xsd:dateTime .
`;

const project = useGraphProject('minerva-source-props-');
const sourceId = 'smith-2023';

beforeEach(() => {
  const dir = path.join(project.root, '.minerva', 'sources', sourceId);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'meta.ttl'), META);
  indexSource(project.ctx, sourceId, META);
});

function metaOnDisk(): string {
  return fs.readFileSync(path.join(project.root, '.minerva', 'sources', sourceId, 'meta.ttl'), 'utf-8');
}

async function approvedSourcePropsCount(): Promise<number> {
  const r = await queryGraph(project.ctx, `
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
    const { changedPredicates } = await fileSourceProperties(project.root, sourceId, [
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
    await fileSourceProperties(project.root, sourceId, [
      { predicate: 'dc:title', value: ttlString('Test paper') }, // unchanged
    ]);
    expect(await approvedSourcePropsCount()).toBe(0);
    // meta.ttl still has exactly one dc:title line.
    expect((metaOnDisk().match(/dc:title/g) ?? []).length).toBe(1);
  });
});
