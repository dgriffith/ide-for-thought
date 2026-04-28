/**
 * Regression: LLM-emitted Turtle wrapped in a markdown code fence.
 *
 * The user reported:
 *   Approve failed: SyntaxError: Bad syntax: expected directive or
 *   statement at: "```turtle @prefix thought: <ht"
 *
 * The model frequently emits ```turtle\n…\n``` even when the prompt
 * forbids fences. Pre-#418 this didn't surface because applyTurtle
 * tolerated parse failures silently; the post-#418 pre-flight parse
 * (added so malformed bundles roll back) makes the fence a hard fail.
 *
 * Fix: stripTurtleCodeFence is called before parsing in applyTurtle,
 * AND eagerly in crystallize so the stored payload is clean.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  proposeWrite,
  approveProposal,
  resetPolicy,
  setPolicy,
  stripTurtleCodeFence,
} from '../../../src/main/llm/approval';
import { initGraph, queryGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

describe('stripTurtleCodeFence (pure)', () => {
  it('strips a ```turtle fence with the language tag', () => {
    expect(stripTurtleCodeFence('```turtle\n<x> a <Y> .\n```'))
      .toBe('<x> a <Y> .');
  });

  it('strips a bare ``` fence', () => {
    expect(stripTurtleCodeFence('```\n<x> a <Y> .\n```'))
      .toBe('<x> a <Y> .');
  });

  it('tolerates leading and trailing whitespace around the fence', () => {
    expect(stripTurtleCodeFence('  \n```turtle\n<x> a <Y> .\n```  \n'))
      .toBe('<x> a <Y> .');
  });

  it('tolerates CRLF line endings', () => {
    expect(stripTurtleCodeFence('```turtle\r\n<x> a <Y> .\r\n```'))
      .toBe('<x> a <Y> .');
  });

  it('returns input unchanged when there is no fence', () => {
    expect(stripTurtleCodeFence('<x> a <Y> .'))
      .toBe('<x> a <Y> .');
  });

  it('does not strip backticks that appear inside the body (no opening/closing match)', () => {
    const body = '<x> rdfs:label "a `backticked` value" .';
    expect(stripTurtleCodeFence(body)).toBe(body);
  });
});

describe('approval engine: tolerates fenced graph-triples payloads (#420 follow-up)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-turtle-fence-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    resetPolicy();
    setPolicy('component_creation', 'requires_approval');
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('approving a proposal whose graph-triples payload is wrapped in ```turtle … ``` succeeds and the triples land', async () => {
    const claimUri = 'https://minerva.dev/c/fenced-claim';
    const fenced = '```turtle\n@prefix thought: <https://minerva.dev/ontology/thought#> .\n'
      + `<${claimUri}> a thought:Claim ; thought:label "fenced and survived" .\n`
      + '```';

    const proposal = await proposeWrite(ctx, {
      operationType: 'component_creation',
      payloads: [{
        kind: 'graph-triples',
        turtle: fenced,
        affectsNodeUris: [claimUri],
      }],
      note: 'fenced turtle from LLM',
      proposedBy: 'unit-test',
    });
    expect(proposal).not.toBeNull();
    // This is the call that was throwing before the fix.
    expect(await approveProposal(ctx, proposal!.uri)).toBe(true);

    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?label WHERE { <${claimUri}> thought:label ?label . }
    `);
    expect((r.results as Array<{ label: string }>).map((row) => row.label))
      .toContain('fenced and survived');
  });

  it('a multi-payload bundle still rolls back atomically when ONE turtle payload is genuinely broken (not just fenced)', async () => {
    // Locking down that the fence-tolerance fix didn't accidentally swallow
    // real parse errors. A note payload runs first, then a triples payload
    // with malformed Turtle (after fence-strip). Result: rollback, note
    // does not survive on disk.
    const proposal = await proposeWrite(ctx, {
      operationType: 'component_creation',
      payloads: [
        { kind: 'note', relativePath: 'notes/should-roll-back.md', content: 'gone\n' },
        {
          kind: 'graph-triples',
          // Even after fence-stripping, this is broken Turtle.
          turtle: '```turtle\n<https://ex/x> ;;;; .\n```',
          affectsNodeUris: ['https://ex/x'],
        },
      ],
      note: 'should fail and roll back',
      proposedBy: 'unit-test',
    });
    await expect(approveProposal(ctx, proposal!.uri)).rejects.toThrow();
    expect(fs.existsSync(path.join(root, 'notes/should-roll-back.md'))).toBe(false);
  });
});
