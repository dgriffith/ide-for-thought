/**
 * Rewrite-on-rebase for proposals (#1443 Part B). Proposals aren't re-derivable
 * from files, so on a base-IRI rebase their base-prefixed IRIs (subject,
 * affectsNode) AND their `payloadJson` turtle are rewritten old→new during the
 * rebuild — so a pending proposal doesn't dangle on apply, and an approved one's
 * `affectsNode` still joins to its (rebased) component for the trust gate.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexAllNotes, setBaseUri } from '../../../src/main/graph/index';
import { writeProposalToGraph, listProposals } from '../../../src/main/llm/proposal-persistence';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import type { Proposal } from '../../../src/main/llm/proposal-types';

const OLD = 'https://project.minerva.dev/old-u/old-p/';
const NEW = 'https://project.minerva.dev/new-u/new-p/';

function makeProposal(id: string, status: Proposal['status']): Proposal {
  const component = `${OLD}component/${id}`;
  return {
    uri: `${OLD}proposal/${id}`,
    status,
    operationType: 'new_claim',
    payloads: [{
      kind: 'graph-triples',
      turtle: `<${component}> a thought:Claim ; thought:label "c-${id}" ; thought:extractedBy "llm:test" .`,
      affectsNodeUris: [component],
    }],
    note: `proposal ${id}`,
    affectsNodeUris: [component],
    proposedBy: 'test',
    proposedAt: '2026-01-01T00:00:00.000Z',
    autoExpires: '2026-12-31T00:00:00.000Z',
  };
}

let root: string;
let ctx: ProjectContext;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-rebase-'));
  ctx = projectContext(root);
  await initGraph(ctx);
});
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

describe('indexAllNotes rebaseFrom — proposal migration', () => {
  it('rewrites pending + approved proposals from the old base to the new base', async () => {
    setBaseUri(ctx, OLD); // pretend the graph currently lives at OLD
    await writeProposalToGraph(ctx, makeProposal('a', 'pending'));
    await writeProposalToGraph(ctx, makeProposal('b', 'approved'));

    setBaseUri(ctx, NEW); // the rebase handler sets the new base, then rebuilds
    await indexAllNotes(ctx, { rebaseFrom: OLD });

    const props = await listProposals(ctx);
    expect(props).toHaveLength(2);
    for (const p of props) {
      expect(p.uri.startsWith(NEW)).toBe(true);                 // subject rebased
      expect(p.affectsNodeUris.every((u) => u.startsWith(NEW))).toBe(true);
      const turtle = (p.payloads[0] as { turtle: string }).turtle;
      expect(turtle).toContain(NEW);                            // payload turtle rebased
      expect(turtle).not.toContain(OLD);
    }
    // Both statuses survived the migration.
    expect(props.map((p) => p.status).sort()).toEqual(['approved', 'pending']);
  });

  it('a plain rebuild (no rebaseFrom) leaves the proposal at the old base', async () => {
    setBaseUri(ctx, OLD);
    await writeProposalToGraph(ctx, makeProposal('a', 'pending'));

    setBaseUri(ctx, NEW);
    await indexAllNotes(ctx); // no rebaseFrom → verbatim carry-over

    const [p] = await listProposals(ctx);
    expect(p!.uri.startsWith(OLD)).toBe(true);
    expect((p!.payloads[0] as { turtle: string }).turtle).toContain(OLD);
  });
});
