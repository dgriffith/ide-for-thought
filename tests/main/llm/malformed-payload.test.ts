/**
 * Malformed-bundle error branches on the trust path (#1000). A proposal whose
 * stored payload JSON is corrupt / empty / not-an-array must NOT silently
 * approve as a no-op — the user clicked Approve expecting something to land.
 * These pin `parsePayloads`' guards (reached via getProposal / listProposals /
 * approveProposal). Proposals are seeded directly into the store so we can
 * inject payload JSON that proposeWrite would never produce.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  approveProposal,
  listProposals,
  getProposal,
} from '../../../src/main/llm/approval';
import { initGraph, parseIntoStore } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

const THOUGHT = 'https://minerva.dev/ontology/thought#';

describe('malformed-payload error branches (#1000)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-malformed-payload-'));
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  /** Seed a pending proposal with an arbitrary raw payloadJson literal. */
  function seedProposal(uri: string, payloadJson: string): void {
    parseIntoStore(ctx, `
      <${uri}> a <${THOUGHT}Proposal> ;
        <${THOUGHT}proposalStatus> <${THOUGHT}pending> ;
        <${THOUGHT}operationType> "new_claim" ;
        <${THOUGHT}proposalNote> "seeded" ;
        <${THOUGHT}proposedBy> "unit-test" ;
        <${THOUGHT}proposedAt> "2026-01-01T00:00:00Z" ;
        <${THOUGHT}autoExpires> "2030-01-01T00:00:00Z" ;
        <${THOUGHT}payloadJson> ${JSON.stringify(payloadJson)} .
    `);
  }

  it('getProposal throws on corrupt payload JSON (not a silent no-op)', async () => {
    seedProposal('urn:test:bad-json', 'this is { not valid json');
    await expect(getProposal(ctx, 'urn:test:bad-json')).rejects.toThrow(/failed to parse/i);
  });

  it('getProposal throws when the payload JSON parses but is not an array', async () => {
    seedProposal('urn:test:not-array', '{"kind":"note"}');
    await expect(getProposal(ctx, 'urn:test:not-array')).rejects.toThrow(/not an array/i);
  });

  it('approveProposal surfaces the parse error rather than approving a broken proposal', async () => {
    seedProposal('urn:test:bad-approve', 'nope {');
    await expect(approveProposal(ctx, 'urn:test:bad-approve')).rejects.toThrow(/failed to parse/i);
    // Status must remain pending — a failed parse cannot advance it to approved.
    // (getProposal itself throws, so re-read via a raw list-by-status.)
    expect((await listProposals(ctx, 'approved')).length).toBe(0);
  });

  it('approveProposal refuses an empty-bundle proposal instead of a no-op approve', async () => {
    // Empty payloadJson literal ⇒ parsePayloads returns [] ⇒ approve refuses.
    seedProposal('urn:test:empty-bundle', '[]');
    await expect(approveProposal(ctx, 'urn:test:empty-bundle')).rejects.toThrow(/no payloads to apply|no-op/i);
    expect((await listProposals(ctx, 'approved')).length).toBe(0);
  });

  it('listProposals throws if any proposal in the set has corrupt payload JSON', async () => {
    seedProposal('urn:test:bad-in-list', 'still } not json');
    await expect(listProposals(ctx)).rejects.toThrow(/failed to parse/i);
  });
});
