/**
 * Coverage for the conversational rework of #408.
 *
 * The original PR #420 used a one-shot orchestrator with a JSON
 * parser. The rework drops all of that — the tool is now an
 * `outputMode: 'openConversation'` def whose system prompt teaches
 * the model the parent + N-children bundle shape, with the per-claim
 * structure encoded via frontmatter + a small turtle block. These
 * tests pin the prompt threading + the bundle-shape contract; the
 * indexer round-trip is covered separately in `tests/main/graph/`.
 */

import { describe, it, expect } from 'vitest';
import '../../../src/shared/tools/definitions/index';
import { getTool, getToolInfosByCategory } from '../../../src/shared/tools/registry';
import { buildConversationPayload } from '../../../src/main/tools/executor';

const TOOL_ID = 'research.decompose-into-claims';

describe('research.decompose-into-claims (#408 rework)', () => {
  it('is registered under the research category', () => {
    const ids = getToolInfosByCategory('research').map((t) => t.id);
    expect(ids).toContain(TOOL_ID);
  });

  it('is conversational + does not require web by default', () => {
    // The decomposition is purely an analysis of the passage in front
    // of the model — web grounding is irrelevant. Distinct from
    // find-arguments, which requires web tools by default.
    const tool = getTool(TOOL_ID)!;
    expect(tool.outputMode).toBe('openConversation');
    expect(tool.web?.defaultEnabled).toBe(false);
    expect(tool.context).toEqual(['selectedText', 'fullNote']);
    expect(tool.preferredModel).toMatch(/^claude-(sonnet|opus|haiku)-/);
    expect(tool.buildSystemPrompt).toBeDefined();
    expect(tool.buildFirstMessage).toBeDefined();
  });

  it('does not require selection — running on the whole note is a valid use', () => {
    expect(getTool(TOOL_ID)!.requiresSelection).toBeFalsy();
  });

  it('threads the source path into the system prompt and pins the wiki-link convention', () => {
    const tool = getTool(TOOL_ID)!;
    const sys = tool.buildSystemPrompt!({
      fullNotePath: 'notes/standup-2026-04-26.md',
      fullNoteTitle: 'standup-2026-04-26',
      fullNoteContent: 'Some passage with a few claims.',
    });
    // Source path mentioned with .md extension; wiki-link target uses
    // the .md-stripped stem.
    expect(sys).toContain('notes/standup-2026-04-26.md');
    expect(sys).toMatch(/`notes\/standup-2026-04-26`/);
  });

  it('teaches the model both the parent-note frontmatter (decomposes:) and the per-claim frontmatter contract', () => {
    const tool = getTool(TOOL_ID)!;
    const sys = tool.buildSystemPrompt!({});
    // Parent encoding.
    expect(sys).toMatch(/decomposes:/);
    // Per-claim encoding — kind, source-text, extracted-from, extracted-by.
    // These are the indexer-mapped frontmatter keys; if any drifts,
    // the structural fact disappears from the graph silently.
    expect(sys).toMatch(/claim-kind:/);
    expect(sys).toMatch(/source-text:/);
    expect(sys).toMatch(/extracted-from:/);
    expect(sys).toMatch(/extracted-by:/);
    // Closed set of claim kinds.
    expect(sys).toMatch(/factual/);
    expect(sys).toMatch(/evaluative/);
    expect(sys).toMatch(/definitional/);
    expect(sys).toMatch(/predictive/);
    // The turtle block declares rdf:type — without it, a `?c a thought:Claim`
    // query wouldn't see these notes. Keep the model's instructions explicit.
    expect(sys).toContain('this: a thought:Claim');
    // Bundle-as-one-call rule (avoids stuttering propose_notes calls).
    expect(sys).toMatch(/single propose_notes/i);
    // Anti-flattery: empty is a real answer; do not call propose_notes.
    expect(sys.toLowerCase()).toMatch(/anti-flattery/);
  });

  it('falls back gracefully when the passage was not pulled from a saved note', () => {
    const tool = getTool(TOOL_ID)!;
    const sys = tool.buildSystemPrompt!({});
    expect(sys).toMatch(/skip the/i);
    expect(sys).toMatch(/decomposes:|extracted-from:/);
  });

  it('builds a first message that includes the passage', () => {
    const tool = getTool(TOOL_ID)!;
    const payload = buildConversationPayload(
      tool,
      {},
      {
        context: {
          selectedText: 'A then B then therefore C.',
          fullNoteTitle: 'argument',
        },
      },
    );
    expect(payload.firstMessage).toContain('A then B then therefore C.');
    expect(payload.firstMessage).toMatch(/Selection from: argument/);
  });

  it('handles the no-passage edge by asking the model to operate on the current passage', () => {
    const tool = getTool(TOOL_ID)!;
    const payload = buildConversationPayload(tool, {}, { context: {} });
    expect(payload.firstMessage).toMatch(/decompose/i);
  });
});
