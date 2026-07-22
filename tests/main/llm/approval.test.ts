import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  proposeWrite,
  approveProposal,
  rejectProposal,
  type OperationType,
} from '../../../src/main/llm/approval';
import { initGraph, queryGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

// Every write is filed as a pending proposal and applied only on approval —
// there are no lower-trust tiers (they were removed as unused). These tests
// exercise that single lifecycle across payload kinds.

describe('updateProposalStatus replaces, does not append (#332)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-approval-status-'));
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  async function statusesFor(uri: string): Promise<string[]> {
    const r = await queryGraph(ctx, `
      SELECT ?s WHERE { <${uri}> thought:proposalStatus ?s . }
    `);
    return (r.results as Array<{ s: string }>).map((row) => row.s);
  }

  it('approving a pending proposal leaves only the approved status', async () => {
    const proposal = await proposeWrite(ctx, {
      operationType: 'new_claim',
      payloads: [{
        kind: 'graph-triples',
        turtle: '<https://ex.example/x> a <https://ex.example/Claim> .',
        affectsNodeUris: ['https://ex.example/x'],
      }],
      note: 'test',
      proposedBy: 'unit-test',
    });
    expect(await statusesFor(proposal.uri)).toEqual([
      'https://minerva.dev/ontology/thought#pending',
    ]);

    expect((await approveProposal(ctx, proposal.uri)).ok).toBe(true);
    expect(await statusesFor(proposal.uri)).toEqual([
      'https://minerva.dev/ontology/thought#approved',
    ]);
  });

  it('rejecting a pending proposal leaves only the rejected status', async () => {
    const proposal = await proposeWrite(ctx, {
      operationType: 'new_claim',
      payloads: [{
        kind: 'graph-triples',
        turtle: '<https://ex.example/y> a <https://ex.example/Claim> .',
        affectsNodeUris: ['https://ex.example/y'],
      }],
      note: 'test',
      proposedBy: 'unit-test',
    });
    expect(await rejectProposal(ctx, proposal.uri)).toBe(true);
    expect(await statusesFor(proposal.uri)).toEqual([
      'https://minerva.dev/ontology/thought#rejected',
    ]);
  });
});

describe('payload-kind validation at proposeWrite time (#665)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-approval-payload-'));
    ctx = projectContext(root);
    await initGraph(ctx);
  });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  it('rejects a saved-query payload at creation (would throw at apply otherwise)', async () => {
    await expect(proposeWrite(ctx, {
      operationType: 'new_claim',
      payloads: [{
        kind: 'saved-query',
        scope: 'project',
        name: 'watch',
        description: 'd',
        query: 'SELECT * WHERE { ?s ?p ?o }',
        language: 'sparql',
      }],
      note: 'test',
      proposedBy: 'unit-test',
    })).rejects.toThrow(/saved-query.*no apply dispatcher/);
  });

  it('rejects a source payload at creation', async () => {
    await expect(proposeWrite(ctx, {
      operationType: 'new_claim',
      payloads: [{ kind: 'source', sourceId: 's1', metaTtl: '' }],
      note: 'test',
      proposedBy: 'unit-test',
    })).rejects.toThrow(/source.*no apply dispatcher/);
  });

  it('rejects when an un-wired kind is mixed into an otherwise-valid bundle', async () => {
    await expect(proposeWrite(ctx, {
      operationType: 'new_claim',
      payloads: [
        { kind: 'graph-triples', turtle: '<https://ex.example/z> a <https://ex.example/Claim> .', affectsNodeUris: ['https://ex.example/z'] },
        { kind: 'saved-query', scope: 'global', name: 'w', description: 'd', query: 'x', language: 'sql' },
      ],
      note: 'test',
      proposedBy: 'unit-test',
    })).rejects.toThrow(/no apply dispatcher/);
  });

  it('accepts the wired kinds (graph-triples)', async () => {
    const p = await proposeWrite(ctx, {
      operationType: 'new_claim',
      payloads: [{ kind: 'graph-triples', turtle: '<https://ex.example/ok> a <https://ex.example/Claim> .', affectsNodeUris: ['https://ex.example/ok'] }],
      note: 'test',
      proposedBy: 'unit-test',
    });
    expect(p.status).toBe('pending');
  });
});

describe('note-rewrite payload (#936)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-approval-rewrite-'));
    ctx = projectContext(root);
    await initGraph(ctx);
  });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  const REL = 'notes/stub.md';

  async function seedNote(content: string): Promise<void> {
    await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
    await fsp.writeFile(path.join(root, REL), content, 'utf-8');
  }

  function rewriteWrite(pathRel: string, content: string) {
    return {
      operationType: 'note_rewrite' as OperationType,
      payloads: [{ kind: 'note-rewrite' as const, path: pathRel, content }],
      note: 'fill out the note',
      proposedBy: 'unit-test',
    };
  }

  it('is gated: the file is unchanged until approved, then holds the new content', async () => {
    await seedNote('# Stub\n\nrough idea.\n');
    const proposal = await proposeWrite(ctx, rewriteWrite(REL, '# Stub\n\nA fully fleshed-out idea.\n'));
    // Not applied yet.
    expect(await fsp.readFile(path.join(root, REL), 'utf-8')).toBe('# Stub\n\nrough idea.\n');

    const result = await approveProposal(ctx, proposal.uri);
    expect(result.ok).toBe(true);
    expect(result.rewrittenPaths).toEqual([REL]);
    expect(result.filedPaths).toEqual([]);
    expect(await fsp.readFile(path.join(root, REL), 'utf-8')).toBe('# Stub\n\nA fully fleshed-out idea.\n');
  });

  it('rejecting a rewrite leaves the original content untouched', async () => {
    await seedNote('original\n');
    const proposal = await proposeWrite(ctx, rewriteWrite(REL, 'replaced\n'));
    expect(await rejectProposal(ctx, proposal.uri)).toBe(true);
    expect(await fsp.readFile(path.join(root, REL), 'utf-8')).toBe('original\n');
  });

  it('rolls back to the pre-image when a later payload in the bundle fails', async () => {
    await seedNote('keep me\n');
    // A rewrite followed by a deliberately-malformed graph-triples payload:
    // the triples parse blows up at apply time, and the reverse-order rollback
    // must restore the note's original bytes.
    const proposal = await proposeWrite(ctx, {
      operationType: 'note_rewrite',
      payloads: [
        { kind: 'note-rewrite', path: REL, content: 'clobbered\n' },
        { kind: 'graph-triples', turtle: 'this is not valid turtle @@@', affectsNodeUris: [] },
      ],
      note: 'rewrite + bad triples',
      proposedBy: 'unit-test',
    });
    await expect(approveProposal(ctx, proposal.uri)).rejects.toThrow();
    // The rewrite landed then rolled back — original content restored.
    expect(await fsp.readFile(path.join(root, REL), 'utf-8')).toBe('keep me\n');
  });

  it('rejects a rewrite of a non-markdown path', async () => {
    // Guardrail check runs at apply time; the proposal files fine, approval fails.
    await fsp.writeFile(path.join(root, 'data.txt'), 'x', 'utf-8');
    const proposal = await proposeWrite(ctx, rewriteWrite('data.txt', 'y'));
    await expect(approveProposal(ctx, proposal.uri)).rejects.toThrow(/non-markdown/);
  });

  it('fails (and rolls back) when the target note does not exist', async () => {
    const proposal = await proposeWrite(ctx, rewriteWrite('notes/ghost.md', 'content'));
    await expect(approveProposal(ctx, proposal.uri)).rejects.toThrow();
  });
});

describe('source-meta payload (#943)', () => {
  let root: string;
  let ctx: ProjectContext;
  const sourceId = 'smith-2023';
  const META = `this: a thought:Article ;
    dc:title "Test paper" ;
    thought:accessedAt "2026-05-01T00:00:00Z"^^xsd:dateTime .
`;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-approval-sourcemeta-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    const dir = path.join(root, '.minerva', 'sources', sourceId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'meta.ttl'), META);
  });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  function metaOnDisk(): string {
    return fs.readFileSync(path.join(root, '.minerva', 'sources', sourceId, 'meta.ttl'), 'utf-8');
  }

  it('applies the predicate upsert on approval', async () => {
    const proposal = await proposeWrite(ctx, {
      operationType: 'source_properties',
      payloads: [{ kind: 'source-meta', sourceId, updates: [{ predicate: 'dc:abstract', value: '"An abstract."' }] }],
      note: 'summary',
      proposedBy: 'unit-test',
    });
    expect(metaOnDisk()).not.toContain('dc:abstract'); // gated
    expect((await approveProposal(ctx, proposal.uri)).ok).toBe(true);
    expect(metaOnDisk()).toContain('dc:abstract "An abstract." ;');
  });

  it('rolls back the meta.ttl to its pre-image when a later payload fails', async () => {
    const proposal = await proposeWrite(ctx, {
      operationType: 'source_properties',
      payloads: [
        { kind: 'source-meta', sourceId, updates: [{ predicate: 'dc:abstract', value: '"clobber"' }] },
        { kind: 'graph-triples', turtle: 'not valid turtle @@@', affectsNodeUris: [] },
      ],
      note: 'source-meta + bad triples',
      proposedBy: 'unit-test',
    });
    await expect(approveProposal(ctx, proposal.uri)).rejects.toThrow();
    // The upsert landed then rolled back — meta.ttl restored verbatim.
    expect(metaOnDisk()).toBe(META);
  });
});

describe('proposal store effects (#666)', () => {
  let root: string;
  let ctx: ProjectContext;
  const TAG = 'https://minerva.dev/ontology#tag';

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-approval-store-'));
    ctx = projectContext(root);
    await initGraph(ctx);
  });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  /** Number of `<node> <TAG> ?o` triples currently in the store. */
  async function tagCount(node: string): Promise<number> {
    const r = await queryGraph(ctx, `SELECT ?o WHERE { <${node}> <${TAG}> ?o . }`);
    return r.results.length;
  }

  function write(op: OperationType, node: string) {
    return {
      operationType: op,
      payloads: [{ kind: 'graph-triples' as const, turtle: `<${node}> <${TAG}> "x" .`, affectsNodeUris: [node] }],
      note: 'test',
      proposedBy: 'unit-test',
    };
  }

  it('the write is ABSENT until approved, then present', async () => {
    const node = 'https://ex.example/gated';
    const proposal = await proposeWrite(ctx, write('new_claim', node));
    expect(await tagCount(node)).toBe(0); // not applied yet
    expect((await approveProposal(ctx, proposal.uri)).ok).toBe(true);
    expect(await tagCount(node)).toBe(1); // applied on approval
  });

  it('a rejected proposal never lands', async () => {
    const node = 'https://ex.example/rejected';
    const proposal = await proposeWrite(ctx, write('new_claim', node));
    expect(await tagCount(node)).toBe(0);
    expect(await rejectProposal(ctx, proposal.uri)).toBe(true);
    expect(await tagCount(node)).toBe(0); // still absent
  });
});
