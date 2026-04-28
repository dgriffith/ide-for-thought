/**
 * Stress test: a Learning-Journey-shaped bundle (1 parent + N children),
 * each note containing realistic LLM output (markdown with code fences,
 * wiki-links, special chars, blockquotes). The user reported that a
 * 27-note bundle approved silently with no notes created — this test
 * exists to reproduce that and pin the round-trip contract.
 *
 * The hypothesis: payloadJson is stored as a JSON string inside a
 * Turtle literal, then re-read on approve. If escaping or rdflib
 * truncation breaks for large content with quotes/backslashes, the
 * parsed payload silently becomes [] and applyBundle has no work — so
 * status flips to approved but nothing lands.
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
import { initGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import type { ProposalPayload } from '../../../src/main/llm/approval';

function realisticChildBody(stop: number): string {
  return `# Stop ${stop}: A topic name with "quotes" and \\backslashes\\

> A blockquote that spans
> multiple lines, because LLMs love these.

The "key insight" here is that \`x = 1\\n\` when \`y > 0\`.
And another \`backtick\` chunk.

\`\`\`ts
// LLMs love embedded code fences
function foo(x: string): string {
  return \`hello, \${x}!\`;
}
\`\`\`

See [[stop-${stop - 1}]] for prerequisites and [[stop-${stop + 1}]] next.

Notes on tricky characters: tabs (\\t), CRLF (\\r\\n), Unicode (😀✨†‡°¥),
and the obligatory ${'A'.repeat(200)} long-line stress.
`;
}

function buildJourneyBundle(childCount: number): ProposalPayload[] {
  const parent: ProposalPayload = {
    kind: 'note',
    relativePath: 'notes/journey-parent.md',
    content: `# Distributed Consensus — Learning Journey

A ${childCount}-stop journey. Each child is one stop.

` + Array.from({ length: childCount }, (_, i) => `- [[stop-${i + 1}]]`).join('\n') + '\n',
  };
  const children: ProposalPayload[] = Array.from({ length: childCount }, (_, i) => ({
    kind: 'note',
    relativePath: `notes/journey/stop-${i + 1}.md`,
    content: realisticChildBody(i + 1),
  }));
  return [parent, ...children];
}

describe('large-bundle approval (the 27-note silent-failure regression)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-large-bundle-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    resetPolicy();
    setPolicy('component_creation', 'requires_approval');
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('round-trips a 27-note bundle through proposeWrite → getProposal with payloads intact', async () => {
    const payloads = buildJourneyBundle(26); // 1 parent + 26 = 27
    const proposal = await proposeWrite(ctx, {
      operationType: 'component_creation',
      payloads,
      note: 'Distributed Consensus journey',
      proposedBy: 'unit-test',
    });
    expect(proposal).not.toBeNull();

    const fetched = await getProposal(ctx, proposal!.uri);
    expect(fetched).not.toBeNull();
    // Critical: payloads survived the JSON-in-Turtle-literal round trip.
    // If escaping is broken, parsePayloads() returns [] silently.
    expect(fetched!.payloads).toHaveLength(27);
    expect(fetched!.payloads[0].kind).toBe('note');
    expect(fetched!.payloads[26].kind).toBe('note');
    if (fetched!.payloads[0].kind === 'note') {
      expect(fetched!.payloads[0].relativePath).toBe('notes/journey-parent.md');
    }
    if (fetched!.payloads[26].kind === 'note') {
      expect(fetched!.payloads[26].relativePath).toBe('notes/journey/stop-26.md');
      expect(fetched!.payloads[26].content).toContain('Stop 26');
    }
  });

  it('approving a 27-note bundle lands ALL 27 notes on disk', async () => {
    const payloads = buildJourneyBundle(26);
    const proposal = await proposeWrite(ctx, {
      operationType: 'component_creation',
      payloads,
      note: 'Distributed Consensus journey',
      proposedBy: 'unit-test',
    });
    expect(await approveProposal(ctx, proposal!.uri)).toBe(true);

    expect(fs.existsSync(path.join(root, 'notes/journey-parent.md'))).toBe(true);
    for (let i = 1; i <= 26; i++) {
      const onDisk = path.join(root, `notes/journey/stop-${i}.md`);
      expect(fs.existsSync(onDisk)).toBe(true);
      const content = await fsp.readFile(onDisk, 'utf-8');
      expect(content).toContain(`# Stop ${i}:`);
    }
  });
});
