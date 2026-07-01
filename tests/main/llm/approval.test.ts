import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  getApprovalTier,
  setPolicy,
  resetPolicy,
  proposeWrite,
  approveProposal,
  rejectProposal,
  type OperationType,
  type ApprovalTier,
} from '../../../src/main/llm/approval';
import { initGraph, queryGraph, parseIntoStore } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

describe('approval policy', () => {
  beforeEach(() => {
    resetPolicy();
  });

  it('returns requires_approval for new_claim by default', () => {
    expect(getApprovalTier('new_claim')).toBe('requires_approval');
  });

  it('returns requires_approval for evidence_link by default', () => {
    expect(getApprovalTier('evidence_link')).toBe('requires_approval');
  });

  it('returns requires_approval for component_creation by default', () => {
    expect(getApprovalTier('component_creation')).toBe('requires_approval');
  });

  it('returns notify_only for confidence_update by default', () => {
    expect(getApprovalTier('confidence_update')).toBe('notify_only');
  });

  it('returns notify_only for status_change by default', () => {
    expect(getApprovalTier('status_change')).toBe('notify_only');
  });

  it('returns autonomous for tag_addition by default', () => {
    expect(getApprovalTier('tag_addition')).toBe('autonomous');
  });

  it('returns autonomous for staleness_flag by default', () => {
    expect(getApprovalTier('staleness_flag')).toBe('autonomous');
  });

  it('allows overriding policy for an operation type', () => {
    setPolicy('tag_addition', 'requires_approval');
    expect(getApprovalTier('tag_addition')).toBe('requires_approval');
  });

  it('resetPolicy restores defaults', () => {
    setPolicy('tag_addition', 'requires_approval');
    resetPolicy();
    expect(getApprovalTier('tag_addition')).toBe('autonomous');
  });

  it('falls back to requires_approval for unknown operation types', () => {
    expect(getApprovalTier('unknown_op' as OperationType)).toBe('requires_approval');
  });
});

describe('updateProposalStatus replaces, does not append (#332)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-approval-status-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    resetPolicy();
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
    expect(proposal).not.toBeNull();
    expect(await statusesFor(proposal!.uri)).toEqual([
      'https://minerva.dev/ontology/thought#pending',
    ]);

    expect((await approveProposal(ctx, proposal!.uri)).ok).toBe(true);
    expect(await statusesFor(proposal!.uri)).toEqual([
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
    expect(proposal).not.toBeNull();
    expect(await rejectProposal(ctx, proposal!.uri)).toBe(true);
    expect(await statusesFor(proposal!.uri)).toEqual([
      'https://minerva.dev/ontology/thought#rejected',
    ]);
  });
});

describe('approval tiers cover all default operations', () => {
  const expectedTiers: [OperationType, ApprovalTier][] = [
    ['new_claim', 'requires_approval'],
    ['evidence_link', 'requires_approval'],
    ['component_creation', 'requires_approval'],
    ['confidence_update', 'notify_only'],
    ['status_change', 'notify_only'],
    ['tag_addition', 'autonomous'],
    ['staleness_flag', 'autonomous'],
  ];

  for (const [op, tier] of expectedTiers) {
    it(`${op} → ${tier}`, () => {
      expect(getApprovalTier(op)).toBe(tier);
    });
  }
});

describe('established-node escalation (#656)', () => {
  let root: string;
  let ctx: ProjectContext;

  const THOUGHT = 'https://minerva.dev/ontology/thought#';
  const ESTABLISHED = 'https://ex.example/established-claim';
  const TENTATIVE = 'https://ex.example/tentative-claim';

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-approval-escalation-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    resetPolicy();
    // Seed one human-vetted (established) node and one ordinary node.
    parseIntoStore(ctx, `<${ESTABLISHED}> <${THOUGHT}hasStatus> <${THOUGHT}established> .`);
    parseIntoStore(ctx, `<${TENTATIVE}> <${THOUGHT}hasStatus> <${THOUGHT}proposed> .`);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  async function statusOf(uri: string): Promise<string[]> {
    const r = await queryGraph(ctx, `SELECT ?s WHERE { <${uri}> thought:proposalStatus ?s . }`);
    return (r.results as Array<{ s: string }>).map((row) => row.s.replace(THOUGHT, ''));
  }

  function tagWrite(nodeUri: string) {
    return {
      operationType: 'tag_addition' as OperationType,
      payloads: [{
        kind: 'graph-triples' as const,
        turtle: `<${nodeUri}> <https://minerva.dev/ontology#tag> "auto" .`,
        affectsNodeUris: [nodeUri],
      }],
      note: 'test',
      proposedBy: 'unit-test',
    };
  }

  it('an autonomous op on a NON-established node still applies silently (no proposal)', async () => {
    const proposal = await proposeWrite(ctx, tagWrite(TENTATIVE));
    expect(proposal).toBeNull();
  });

  it('escalates an autonomous op on an established node to a pending proposal', async () => {
    const proposal = await proposeWrite(ctx, tagWrite(ESTABLISHED));
    expect(proposal).not.toBeNull();
    expect(await statusOf(proposal!.uri)).toEqual(['pending']);
    // The write must NOT have been applied — escalation means it awaits approval.
    const applied = await queryGraph(ctx,
      `SELECT ?o WHERE { <${ESTABLISHED}> <https://minerva.dev/ontology#tag> ?o . }`);
    expect(applied.results.length).toBe(0);
  });

  it('escalates a notify_only op on an established node to pending (not auto-applied)', async () => {
    const proposal = await proposeWrite(ctx, {
      operationType: 'confidence_update',
      payloads: [{
        kind: 'graph-triples',
        turtle: `<${ESTABLISHED}> <${THOUGHT}confidenceValue> "0.9" .`,
        affectsNodeUris: [ESTABLISHED],
      }],
      note: 'test',
      proposedBy: 'unit-test',
    });
    expect(proposal).not.toBeNull();
    expect(await statusOf(proposal!.uri)).toEqual(['pending']);
  });

  it('a notify_only op on a non-established node stays notify_only (approved + applied)', async () => {
    const proposal = await proposeWrite(ctx, {
      operationType: 'confidence_update',
      payloads: [{
        kind: 'graph-triples',
        turtle: `<${TENTATIVE}> <${THOUGHT}confidenceValue> "0.5" .`,
        affectsNodeUris: [TENTATIVE],
      }],
      note: 'test',
      proposedBy: 'unit-test',
    });
    expect(proposal).not.toBeNull();
    expect(await statusOf(proposal!.uri)).toEqual(['approved']);
  });

  it('does not escalate a requires_approval op differently (still pending, unaffected)', async () => {
    const proposal = await proposeWrite(ctx, {
      operationType: 'new_claim',
      payloads: [{
        kind: 'graph-triples',
        turtle: `<${ESTABLISHED}> a <https://ex.example/Claim> .`,
        affectsNodeUris: [ESTABLISHED],
      }],
      note: 'test',
      proposedBy: 'unit-test',
    });
    expect(proposal).not.toBeNull();
    expect(await statusOf(proposal!.uri)).toEqual(['pending']);
  });
});

describe('payload-kind validation at proposeWrite time (#665)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-approval-payload-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    resetPolicy();
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
    expect(p).not.toBeNull();
  });
});

describe('note-rewrite payload (#936)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-approval-rewrite-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    resetPolicy();
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

  it('note_rewrite defaults to requires_approval', () => {
    expect(getApprovalTier('note_rewrite')).toBe('requires_approval');
  });

  it('is gated: the file is unchanged until approved, then holds the new content', async () => {
    await seedNote('# Stub\n\nrough idea.\n');
    const proposal = await proposeWrite(ctx, rewriteWrite(REL, '# Stub\n\nA fully fleshed-out idea.\n'));
    expect(proposal).not.toBeNull();
    // Not applied yet.
    expect(await fsp.readFile(path.join(root, REL), 'utf-8')).toBe('# Stub\n\nrough idea.\n');

    const result = await approveProposal(ctx, proposal!.uri);
    expect(result.ok).toBe(true);
    expect(result.rewrittenPaths).toEqual([REL]);
    expect(result.filedPaths).toEqual([]);
    expect(await fsp.readFile(path.join(root, REL), 'utf-8')).toBe('# Stub\n\nA fully fleshed-out idea.\n');
  });

  it('rejecting a rewrite leaves the original content untouched', async () => {
    await seedNote('original\n');
    const proposal = await proposeWrite(ctx, rewriteWrite(REL, 'replaced\n'));
    expect(await rejectProposal(ctx, proposal!.uri)).toBe(true);
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
    await expect(approveProposal(ctx, proposal!.uri)).rejects.toThrow();
    // The rewrite landed then rolled back — original content restored.
    expect(await fsp.readFile(path.join(root, REL), 'utf-8')).toBe('keep me\n');
  });

  it('rejects a rewrite of a non-markdown path', async () => {
    // Guardrail check runs at apply time; the proposal files fine, approval fails.
    await fsp.writeFile(path.join(root, 'data.txt'), 'x', 'utf-8');
    const proposal = await proposeWrite(ctx, rewriteWrite('data.txt', 'y'));
    await expect(approveProposal(ctx, proposal!.uri)).rejects.toThrow(/non-markdown/);
  });

  it('fails (and rolls back) when the target note does not exist', async () => {
    const proposal = await proposeWrite(ctx, rewriteWrite('notes/ghost.md', 'content'));
    await expect(approveProposal(ctx, proposal!.uri)).rejects.toThrow();
  });
});

describe('tier store effects (#666)', () => {
  let root: string;
  let ctx: ProjectContext;
  const TAG = 'https://minerva.dev/ontology#tag';

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-approval-tier-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    resetPolicy();
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

  it('autonomous: the write lands in the store immediately, with no proposal record', async () => {
    const node = 'https://ex.example/auto';
    const proposal = await proposeWrite(ctx, write('tag_addition', node));
    expect(proposal).toBeNull();
    expect(await tagCount(node)).toBe(1);
  });

  it('notify_only: the write lands immediately AND an approved proposal is recorded', async () => {
    const node = 'https://ex.example/notify';
    const proposal = await proposeWrite(ctx, write('confidence_update', node));
    expect(proposal).not.toBeNull();
    expect(await tagCount(node)).toBe(1); // applied immediately
    const r = await queryGraph(ctx, `SELECT ?s WHERE { <${proposal!.uri}> thought:proposalStatus ?s . }`);
    expect((r.results as Array<{ s: string }>)[0].s).toBe('https://minerva.dev/ontology/thought#approved');
  });

  it('requires_approval: the write is ABSENT until approved, then present', async () => {
    const node = 'https://ex.example/gated';
    const proposal = await proposeWrite(ctx, write('new_claim', node));
    expect(proposal).not.toBeNull();
    expect(await tagCount(node)).toBe(0); // not applied yet
    expect((await approveProposal(ctx, proposal!.uri)).ok).toBe(true);
    expect(await tagCount(node)).toBe(1); // applied on approval
  });

  it('requires_approval rejected: the write never lands', async () => {
    const node = 'https://ex.example/rejected';
    const proposal = await proposeWrite(ctx, write('new_claim', node));
    expect(await tagCount(node)).toBe(0);
    expect(await rejectProposal(ctx, proposal!.uri)).toBe(true);
    expect(await tagCount(node)).toBe(0); // still absent
  });
});
