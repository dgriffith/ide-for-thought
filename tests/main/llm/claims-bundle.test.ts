/**
 * #104 — the approval engine's `excerpt` payload (newly wired) and the
 * claim-note + excerpt bundle that "Extract Key Claims" files. Verifies a mixed
 * note+excerpt bundle lands both, the Claim→Excerpt `thought:quotes` edge
 * resolves, confidence indexes as `thought:confidenceValue`, the excerpt carries
 * its char anchor, and a later-payload failure rolls the excerpt file back.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  proposeWrite,
  approveProposal,
  type ProposalPayload,
} from '../../../src/main/llm/approval';
import { buildExcerptTtl } from '../../../src/main/sources/create-excerpt';
import { initGraph, queryGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

let root: string;
let ctx: ProjectContext;

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-claims-bundle-'));
  ctx = projectContext(root);
  await initGraph(ctx);
});
afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

const SOURCE_ID = 'paper-1';
const EXCERPT_ID = `${SOURCE_ID}-abc123def456`;

function claimNote(): string {
  return [
    '---',
    'title: "The sky is blue due to Rayleigh scattering"',
    'claim-kind: factual',
    'source-text: "The sky is blue because of Rayleigh scattering."',
    'confidence: 0.9',
    `extracted-from: "[[sources/${SOURCE_ID}]]"`,
    'extracted-by: llm:extract-key-claims',
    '---',
    '',
    '# The sky is blue due to Rayleigh scattering',
    '',
    '> The sky is blue because of Rayleigh scattering.',
    '',
    `[[quote::${EXCERPT_ID}]]`,
    '',
    '```turtle',
    'this: a thought:Claim .',
    '```',
    '',
  ].join('\n');
}

function bundle(): ProposalPayload[] {
  return [
    {
      kind: 'excerpt',
      excerptId: EXCERPT_ID,
      excerptTtl: buildExcerptTtl({
        sourceId: SOURCE_ID,
        citedText: 'The sky is blue because of Rayleigh scattering.',
        charStart: 8,
        charEnd: 55,
      }),
    },
    { kind: 'note', relativePath: 'notes/claims/paper-1-1-sky.md', content: claimNote() },
  ];
}

describe('claims bundle (#104)', () => {
  it('files the excerpt node + claim note and links them', async () => {
    const proposal = await proposeWrite(ctx, {
      operationType: 'component_creation', payloads: bundle(), note: 'claims', proposedBy: 'unit-test',
    });
    expect((await approveProposal(ctx, proposal.uri)).ok).toBe(true);

    // Excerpt .ttl on disk.
    expect(fs.existsSync(path.join(root, '.minerva', 'excerpts', `${EXCERPT_ID}.ttl`))).toBe(true);
    // Claim note on disk.
    expect(fs.existsSync(path.join(root, 'notes', 'claims', 'paper-1-1-sky.md'))).toBe(true);

    // Claim → Excerpt evidence edge + confidence, queryable.
    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?claim ?excerpt ?conf WHERE {
        ?claim a thought:Claim ;
               thought:quotes ?excerpt ;
               thought:confidenceValue ?conf .
      }
    `);
    const rows = r.results as Array<{ claim: string; excerpt: string; conf: string }>;
    expect(rows.length).toBe(1);
    expect(rows[0].excerpt).toContain(EXCERPT_ID);
    expect(Number(rows[0].conf)).toBeCloseTo(0.9);

    // Excerpt carries its char anchor.
    const ex = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?start WHERE { ?e a thought:Excerpt ; thought:charStart ?start . }
    `);
    expect((ex.results as Array<{ start: string }>).map((x) => Number(x.start))).toContain(8);
  });

  it('rolls the excerpt file back when a later payload throws', async () => {
    const payloads: ProposalPayload[] = [
      bundle()[0], // excerpt (applies first)
      // A graph-triples payload with malformed turtle → apply throws after the excerpt landed.
      { kind: 'graph-triples', turtle: 'this is not valid turtle <<<', affectsNodeUris: [] },
    ];
    const proposal = await proposeWrite(ctx, {
      operationType: 'component_creation', payloads, note: 'rollback', proposedBy: 'unit-test',
    });
    await expect(approveProposal(ctx, proposal.uri)).rejects.toBeTruthy();
    // The excerpt .ttl written by the first payload must be rolled back.
    expect(fs.existsSync(path.join(root, '.minerva', 'excerpts', `${EXCERPT_ID}.ttl`))).toBe(false);
  });
});
