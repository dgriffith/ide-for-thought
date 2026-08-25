/**
 * `checkUnsupportedClaims`, `checkEvidenceGaps`, and `checkContradictions`
 * (#1927).
 *
 * The file at this path used to be 41 lines with zero imports, asserting on
 * array/object literals it declared itself two lines above each assertion —
 * it could not fail, and it carried this module's exact filename, so it read
 * as `health-checks.ts`'s test in every listing. `health-checks.ts` is at
 * 93.25% line coverage via six other test files, which is exactly why nobody
 * noticed: no coverage is lost by a test that runs nothing.
 *
 * What those six files leave genuinely untested is the *content* of these
 * three checks specifically — `inspection-settings-skip.test.ts` counts how
 * many SPARQL queries they fire (the "hidden argument-map checks" that always
 * run), never what they return. This file closes that gap: real graph state
 * via `applyTurtle`, `runAllChecks` over it, assertions on the inspection
 * shape (type/severity/message/notePath) each check actually promises.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexNote } from '../../../src/main/graph/index';
import { runAllChecks } from '../../../src/main/graph/health-checks';
import { applyTurtle } from '../../../src/main/llm/proposal-persistence';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-health-checks-test-'));
}

describe('checkUnsupportedClaims', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('flags a claim no grounds support', async () => {
    await applyTurtle(ctx, `
      <urn:claim:orphan> a thought:Claim ; thought:label "Orphan claim" .
    `);

    const inspections = await runAllChecks(ctx);
    const unsupported = inspections.filter((i) => i.type === 'unsupported_claim');

    expect(unsupported).toHaveLength(1);
    expect(unsupported[0]).toMatchObject({
      type: 'unsupported_claim',
      severity: 'warning',
      nodeUri: 'urn:claim:orphan',
      nodeLabel: 'Orphan claim',
    });
    expect(unsupported[0]!.message).toContain('Orphan claim');
    expect(unsupported[0]!.message).toContain('no supporting evidence');
  });

  it('does not flag a claim that grounds already support', async () => {
    await applyTurtle(ctx, `
      <urn:claim:grounded> a thought:Claim ; thought:label "Grounded claim" .
      <urn:grounds:g1> a thought:Grounds ; thought:supports <urn:claim:grounded> .
    `);

    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'unsupported_claim')).toBe(false);
  });

  it('carries the note path when the claim is anchored to one', async () => {
    await indexNote(ctx, 'claims/orphan.md', '# Orphan claim\n');
    await applyTurtle(ctx, `
      <urn:claim:anchored> a thought:Claim ;
        thought:label "Anchored claim" ;
        minerva:relativePath "claims/orphan.md" .
    `);

    const inspections = await runAllChecks(ctx);
    const found = inspections.find((i) => i.nodeUri === 'urn:claim:anchored');
    expect(found?.notePath).toBe('claims/orphan.md');
  });
});

describe('checkEvidenceGaps — missing_warrant / missing_backing', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('flags a claim with grounds but no warrant connecting them', async () => {
    await applyTurtle(ctx, `
      <urn:claim:c1> a thought:Claim ; thought:label "Needs a warrant" .
      <urn:grounds:g1> a thought:Grounds ; thought:supports <urn:claim:c1> .
    `);

    const inspections = await runAllChecks(ctx);
    const gaps = inspections.filter((i) => i.type === 'missing_warrant');

    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      severity: 'warning',
      nodeUri: 'urn:claim:c1',
      nodeLabel: 'Needs a warrant',
    });
    expect(gaps[0]!.message).toContain('grounds but no warrant');
  });

  it('does not flag a claim whose grounds are already connected by a warrant', async () => {
    await applyTurtle(ctx, `
      <urn:claim:c2> a thought:Claim ; thought:label "Fully warranted" .
      <urn:grounds:g2> a thought:Grounds ; thought:supports <urn:claim:c2> .
      <urn:warrant:w2> a thought:Warrant ; thought:supports <urn:claim:c2> .
    `);

    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'missing_warrant' && i.nodeUri === 'urn:claim:c2')).toBe(false);
  });

  it('does not flag a claim with no grounds at all — that is unsupported_claim\'s job, not this one\'s', async () => {
    await applyTurtle(ctx, `
      <urn:claim:c3> a thought:Claim ; thought:label "No grounds yet" .
    `);

    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'missing_warrant' && i.nodeUri === 'urn:claim:c3')).toBe(false);
  });

  it('flags a warrant with no backing', async () => {
    await applyTurtle(ctx, `
      <urn:warrant:w3> a thought:Warrant ; thought:label "Bare warrant" .
    `);

    const inspections = await runAllChecks(ctx);
    const gaps = inspections.filter((i) => i.type === 'missing_backing');

    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({
      severity: 'info',
      nodeUri: 'urn:warrant:w3',
      nodeLabel: 'Bare warrant',
    });
    expect(gaps[0]!.message).toContain('no backing');
  });

  it('does not flag a warrant that already has backing', async () => {
    await applyTurtle(ctx, `
      <urn:warrant:w4> a thought:Warrant ; thought:label "Backed warrant" .
      <urn:backing:b4> a thought:Backing ; thought:supports <urn:warrant:w4> .
    `);

    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'missing_backing' && i.nodeUri === 'urn:warrant:w4')).toBe(false);
  });

  it('reports both gaps independently on the same claim/warrant chain', async () => {
    // A claim with grounds-but-no-warrant AND, separately, an unrelated
    // warrant-with-no-backing — the two halves of checkEvidenceGaps run as
    // independent queries, so this pins that neither shadows the other.
    await applyTurtle(ctx, `
      <urn:claim:c5> a thought:Claim ; thought:label "Half warranted" .
      <urn:grounds:g5> a thought:Grounds ; thought:supports <urn:claim:c5> .
      <urn:warrant:w5> a thought:Warrant ; thought:label "Separately bare" .
    `);

    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'missing_warrant' && i.nodeUri === 'urn:claim:c5')).toBe(true);
    expect(inspections.some((i) => i.type === 'missing_backing' && i.nodeUri === 'urn:warrant:w5')).toBe(true);
  });
});

describe('checkContradictions', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('flags two established claims that contradict each other', async () => {
    await applyTurtle(ctx, `
      <urn:claim:x> a thought:Claim ;
        thought:label "The sky is blue" ;
        thought:hasStatus thought:established ;
        thought:contradicts <urn:claim:y> .
      <urn:claim:y> a thought:Claim ;
        thought:label "The sky is green" ;
        thought:hasStatus thought:established .
    `);

    const inspections = await runAllChecks(ctx);
    const contradictions = inspections.filter((i) => i.type === 'contradiction');

    expect(contradictions).toHaveLength(1);
    expect(contradictions[0]).toMatchObject({
      severity: 'concern',
      nodeUri: 'urn:claim:x',
      nodeLabel: 'The sky is blue',
    });
    expect(contradictions[0]!.message).toContain('The sky is blue');
    expect(contradictions[0]!.message).toContain('The sky is green');
  });

  it('does not flag a contradiction where one side is not established', async () => {
    // thought:contradicts exists, but only one claim has been promoted to
    // established — a still-pending claim contradicting an established one
    // isn't a live inconsistency in the thoughtbase yet, just a marked tension.
    await applyTurtle(ctx, `
      <urn:claim:p> a thought:Claim ;
        thought:label "Pending claim" ;
        thought:contradicts <urn:claim:q> .
      <urn:claim:q> a thought:Claim ;
        thought:label "Established claim" ;
        thought:hasStatus thought:established .
    `);

    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'contradiction')).toBe(false);
  });

  it('does not flag two established claims with no contradicts edge between them', async () => {
    await applyTurtle(ctx, `
      <urn:claim:m> a thought:Claim ; thought:label "M" ; thought:hasStatus thought:established .
      <urn:claim:n> a thought:Claim ; thought:label "N" ; thought:hasStatus thought:established .
    `);

    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'contradiction')).toBe(false);
  });

  it('carries the note path when the contradicting claim is anchored to one', async () => {
    await indexNote(ctx, 'claims/x.md', '# X\n');
    await applyTurtle(ctx, `
      <urn:claim:xa> a thought:Claim ;
        thought:label "Anchored X" ;
        thought:hasStatus thought:established ;
        thought:contradicts <urn:claim:ya> ;
        minerva:relativePath "claims/x.md" .
      <urn:claim:ya> a thought:Claim ;
        thought:label "Anchored Y" ;
        thought:hasStatus thought:established .
    `);

    const inspections = await runAllChecks(ctx);
    const found = inspections.find((i) => i.type === 'contradiction');
    expect(found?.notePath).toBe('claims/x.md');
  });
});
