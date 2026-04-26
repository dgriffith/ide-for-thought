/**
 * Bundle-shape behavioural tests for the generalised approval engine
 * (#418). Pin the contract `proposeWrite` / `approveProposal` now
 * carry: payload-typed apply dispatch, triples-last ordering, all-or-
 * nothing rollback, multi-payload end-to-end, note collision
 * dedup. The legacy single-payload `crystallize-integration.test.ts`
 * continues to cover the back-compat path; this file is the new
 * surface.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  proposeWrite,
  approveProposal,
  getProposal,
  resetPolicy,
  setPolicy,
} from '../../../src/main/llm/approval';
import { initGraph, queryGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

const NOTE_PREDICATE = 'https://minerva.dev/ontology#mentionsNote';

describe('ProposalBundle apply + rollback (#418)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-bundle-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    resetPolicy();
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('a graph-triples-only bundle applies through approve and lands in the store', async () => {
    setPolicy('component_creation', 'requires_approval');
    const claimUri = 'https://minerva.dev/c/single-payload';
    const proposal = await proposeWrite(ctx, {
      operationType: 'component_creation',
      payloads: [{
        kind: 'graph-triples',
        turtle: `<${claimUri}> a thought:Claim ; thought:label "single-payload test" .`,
        affectsNodeUris: [claimUri],
      }],
      note: 'one triples payload',
      proposedBy: 'unit-test',
    });
    expect(proposal).not.toBeNull();
    expect(await approveProposal(ctx, proposal!.uri)).toBe(true);

    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?label WHERE { <${claimUri}> thought:label ?label . }
    `);
    expect((r.results as Array<{ label: string }>).map(x => x.label))
      .toContain('single-payload test');
  });

  it('a note-only bundle applies through approve and lands the file on disk', async () => {
    setPolicy('component_creation', 'requires_approval');
    const proposal = await proposeWrite(ctx, {
      operationType: 'component_creation',
      payloads: [{
        kind: 'note',
        relativePath: 'notes/from-bundle.md',
        content: '# From bundle\n\nThis note was proposed and approved.\n',
      }],
      note: 'one note payload',
      proposedBy: 'unit-test',
    });
    expect(proposal).not.toBeNull();
    expect(await approveProposal(ctx, proposal!.uri)).toBe(true);

    const onDisk = await fsp.readFile(path.join(root, 'notes/from-bundle.md'), 'utf-8');
    expect(onDisk).toContain('From bundle');
  });

  it('a multi-payload bundle (note + triples) lands both, with triples runnable AFTER the note', async () => {
    // The bundle creates a Claim node in the graph AND a notes file
    // documenting that claim. Order matters: the triples reference
    // the note's URI, so the note must already exist (and be
    // indexed) when the triples are applied. Triples-last.
    setPolicy('component_creation', 'requires_approval');
    const claimUri = 'https://minerva.dev/c/note-and-triples';
    const noteIri = 'https://example/project/note/notes/explanation';

    const proposal = await proposeWrite(ctx, {
      operationType: 'component_creation',
      payloads: [
        {
          kind: 'note',
          relativePath: 'notes/explanation.md',
          content: '# Explanation\n\nA note that the triples reference.\n',
        },
        {
          kind: 'graph-triples',
          // The triple references the note IRI we plant above.
          turtle: `<${claimUri}> a thought:Claim ; <${NOTE_PREDICATE}> <${noteIri}> .`,
          affectsNodeUris: [claimUri],
        },
      ],
      note: 'note + triples',
      proposedBy: 'unit-test',
    });
    expect(await approveProposal(ctx, proposal!.uri)).toBe(true);

    expect(fs.existsSync(path.join(root, 'notes/explanation.md'))).toBe(true);
    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?type WHERE { <${claimUri}> a ?type . }
    `);
    expect((r.results as Array<{ type: string }>).map(x => x.type))
      .toContain('https://minerva.dev/ontology/thought#Claim');
  });

  it('rolls the note back if a later triples payload throws (parse error)', async () => {
    // File-system payload runs first and lands the note. Then the
    // triples payload throws because the turtle is malformed. The
    // engine must undo the note write so the bundle's all-or-nothing
    // contract holds.
    setPolicy('component_creation', 'requires_approval');
    const proposal = await proposeWrite(ctx, {
      operationType: 'component_creation',
      payloads: [
        {
          kind: 'note',
          relativePath: 'notes/should-be-rolled-back.md',
          content: 'this file should not survive the failed apply\n',
        },
        {
          kind: 'graph-triples',
          // Deliberately broken turtle — `;;` and missing predicate
          // make the rdflib parser bail.
          turtle: '<https://ex/x> ;;;; .',
          affectsNodeUris: ['https://ex/x'],
        },
      ],
      note: 'should fail and roll back',
      proposedBy: 'unit-test',
    });
    await expect(approveProposal(ctx, proposal!.uri)).rejects.toThrow();
    expect(fs.existsSync(path.join(root, 'notes/should-be-rolled-back.md'))).toBe(false);
  });

  it('apply-time path collision suffixes -2/-3 instead of overwriting', async () => {
    // Plant a file that occupies the proposed path.
    await fsp.mkdir(path.join(root, 'notes'), { recursive: true });
    await fsp.writeFile(path.join(root, 'notes/colliding.md'), 'pre-existing\n', 'utf-8');

    setPolicy('component_creation', 'requires_approval');
    const proposal = await proposeWrite(ctx, {
      operationType: 'component_creation',
      payloads: [{
        kind: 'note',
        relativePath: 'notes/colliding.md',
        content: 'proposed content\n',
      }],
      note: 'collision test',
      proposedBy: 'unit-test',
    });
    expect(await approveProposal(ctx, proposal!.uri)).toBe(true);

    // Original file untouched.
    expect(await fsp.readFile(path.join(root, 'notes/colliding.md'), 'utf-8'))
      .toBe('pre-existing\n');
    // Suffixed copy landed.
    expect(await fsp.readFile(path.join(root, 'notes/colliding-2.md'), 'utf-8'))
      .toBe('proposed content\n');
  });

  it('autonomous-tier bundles apply immediately and skip proposal persistence', async () => {
    setPolicy('tag_addition', 'autonomous');
    const result = await proposeWrite(ctx, {
      operationType: 'tag_addition',
      payloads: [{
        kind: 'graph-triples',
        turtle: '<https://ex/auto> a thought:Tag .',
        affectsNodeUris: ['https://ex/auto'],
      }],
      note: 'auto-applied',
      proposedBy: 'unit-test',
    });
    expect(result).toBeNull(); // autonomous → no proposal record returned

    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?type WHERE { <https://ex/auto> a ?type . }
    `);
    expect((r.results as Array<{ type: string }>).map(x => x.type))
      .toContain('https://minerva.dev/ontology/thought#Tag');
  });

  it('round-trips payloads through getProposal — list → fetch reconstitutes the bundle shape', async () => {
    setPolicy('component_creation', 'requires_approval');
    const claimUri = 'https://minerva.dev/c/roundtrip';
    const original = await proposeWrite(ctx, {
      operationType: 'component_creation',
      payloads: [
        {
          kind: 'note',
          relativePath: 'notes/roundtrip.md',
          content: 'body\n',
        },
        {
          kind: 'graph-triples',
          turtle: `<${claimUri}> a thought:Claim .`,
          affectsNodeUris: [claimUri],
        },
      ],
      note: 'round-trip',
      proposedBy: 'unit-test',
    });

    const fetched = await getProposal(ctx, original!.uri);
    expect(fetched).not.toBeNull();
    expect(fetched!.payloads).toHaveLength(2);
    expect(fetched!.payloads[0].kind).toBe('note');
    expect(fetched!.payloads[1].kind).toBe('graph-triples');
    if (fetched!.payloads[0].kind === 'note') {
      expect(fetched!.payloads[0].content).toBe('body\n');
    }
  });

  it('un-wired payload kinds (source / excerpt / saved-query) throw NotImplementedError on apply', async () => {
    // The type accepts these kinds (the Research-tools tickets that
    // need them are filed under #414/#415/follow-ups). The runtime
    // behaviour is "fail loudly" until each is wired in its own PR.
    setPolicy('component_creation', 'requires_approval');
    const proposal = await proposeWrite(ctx, {
      operationType: 'component_creation',
      payloads: [{
        kind: 'saved-query',
        scope: 'project',
        name: 'Future query',
        description: 'will be wired by a later PR',
        query: 'SELECT * WHERE { ?s ?p ?o }',
        language: 'sparql',
      }],
      note: 'unwired kind',
      proposedBy: 'unit-test',
    });
    await expect(approveProposal(ctx, proposal!.uri))
      .rejects.toThrow(/not yet wired/);
  });
});
