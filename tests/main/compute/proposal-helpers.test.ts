/**
 * Unit + integration coverage for the propose_compute helpers that were
 * embedded in the IPC layer (#676 / QA Q-H2). These were untested: the LLM
 * reads `formatComputeResultAsContext`'s output on its next turn, the audit
 * trail depends on `recordComputeProposalRun`'s triples, and the inserted note
 * provenance comes from `buildComputeProposalNoteBlock`.
 */

import { describe, it, expect } from 'vitest';
import {
  formatComputeResultAsContext,
  buildComputeProposalNoteBlock,
  recordComputeProposalRun,
} from '../../../src/main/compute/proposal-helpers';
import { queryGraph } from '../../../src/main/graph/index';
import { useGraphProject } from '../../helpers/temp-project';
import type { ConversationComputeDraft } from '../../../src/shared/conversation-compute-drafts';
import type { CellResult } from '../../../src/shared/compute/types';

function draft(over: Partial<ConversationComputeDraft> = {}): ConversationComputeDraft {
  return {
    draftId: 'd1',
    conversationId: 'c1',
    language: 'python',
    code: 'print(1)',
    rationale: 'compute the answer',
    safetyFlags: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

describe('formatComputeResultAsContext', () => {
  const d = draft({ draftId: 'abc', language: 'python' });

  it('renders an error result with the error marker', () => {
    const out = formatComputeResultAsContext(d, 'boom()', { ok: false, error: 'NameError: x' });
    expect(out).toContain('[Output of compute proposal abc — python]');
    expect(out).toContain('**Error:** NameError: x');
  });

  it('wraps text output in a fenced block', () => {
    const result: CellResult = { ok: true, output: { type: 'text', value: 'hello' } };
    const out = formatComputeResultAsContext(d, 'print("hello")', result);
    expect(out).toContain('```\nhello\n```');
  });

  it('renders a table as markdown and caps at 30 rows with a trailer', () => {
    const rows = Array.from({ length: 50 }, (_, i) => [i, `r${i}`]);
    const result: CellResult = {
      ok: true,
      output: { type: 'table', columns: ['n', 'label'], rows, truncated: false, totalRows: 50 },
    };
    const out = formatComputeResultAsContext(d, 'df', result);
    expect(out).toContain('| n | label |');
    expect(out).toContain('| --- | --- |');
    expect(out).toContain('(showing 30 of 50 rows)');
    expect(out).not.toContain('| 30 | r30 |'); // 31st row dropped (0-indexed)
  });

  it('escapes pipes/newlines in table cells so the markdown table survives', () => {
    const result: CellResult = {
      ok: true,
      output: { type: 'table', columns: ['c'], rows: [['a|b\nc']], truncated: false, totalRows: 1 },
    };
    const out = formatComputeResultAsContext(d, 'df', result);
    expect(out).toContain('| a\\|b c |'); // pipe escaped, newline → space
  });

  it('references an image by placeholder (the API cannot see it inline)', () => {
    const result: CellResult = {
      ok: true,
      output: { type: 'image', mime: 'image/png', data: 'base64==' },
    };
    expect(formatComputeResultAsContext(d, 'plt.show()', result)).toContain('[image output: image/png');
  });
});

describe('buildComputeProposalNoteBlock', () => {
  it('emits a provenance comment with the draft metadata + a fenced code block', () => {
    const block = buildComputeProposalNoteBlock(
      draft({ draftId: 'x9', conversationId: 'cv2', language: 'sql', rationale: 'count rows' }),
      '  SELECT count(*) FROM t;  ',
    );
    expect(block).toContain('<!-- compute-proposal:');
    expect(block).toContain('draft: x9');
    expect(block).toContain('proposed_in_conversation: cv2');
    expect(block).toContain('rationale: count rows');
    expect(block).toContain('```sql\nSELECT count(*) FROM t;\n```'); // code trimmed
  });

  it('neutralises a "-->" in the rationale so it cannot close the comment early', () => {
    const block = buildComputeProposalNoteBlock(
      draft({ rationale: 'sneaky --> break out' }),
      'x',
    );
    expect(block).toContain('rationale: sneaky --&gt; break out');
    // Only the closing fence comment terminator, never one injected mid-rationale.
    expect(block.match(/-->/g)?.length).toBe(1);
  });
});

describe('recordComputeProposalRun (graph audit trail)', () => {
  const project = useGraphProject('minerva-compute-rec-');

  it('writes an approved+executed ComputeProposal node the integrity query can find', async () => {
    const ctx = project.ctx;
    recordComputeProposalRun(ctx, draft({ draftId: 'run-1', code: 'print(2+2)' }), 'print(2+2)');

    const uri = 'https://minerva.dev/ontology/thought#proposal/run-1';
    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?status ?executed ?code WHERE {
        <${uri}> thought:proposalStatus ?status ;
                 thought:executed ?executed ;
                 thought:executedCode ?code .
      }
    `);
    const row = (r.results as Array<{ status: string; executed: string; code: string }>)[0];
    expect(row).toBeTruthy();
    expect(row.status).toBe('https://minerva.dev/ontology/thought#approved');
    expect(row.executed).toBe('true');
    expect(row.code).toBe('print(2+2)');
  });

  it('escapes quotes/newlines in the recorded code so the turtle stays valid', async () => {
    // A naive (unescaped) build would produce broken turtle and write nothing.
    const ctx = project.ctx;
    recordComputeProposalRun(ctx, draft({ draftId: 'run-2' }), 'print("a\nb")');

    const uri = 'https://minerva.dev/ontology/thought#proposal/run-2';
    const r = await queryGraph(ctx, `
      PREFIX thought: <https://minerva.dev/ontology/thought#>
      SELECT ?code WHERE { <${uri}> thought:executedCode ?code . }
    `);
    expect((r.results as Array<{ code: string }>)[0]?.code).toBe('print("a\nb")');
  });
});
