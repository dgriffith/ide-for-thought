/**
 * Coverage for the conversational rework of #409 / #410.
 *
 * The original PR #423 used a one-shot orchestrator with a JSON
 * parser. The rework drops all of that — both tools are now
 * `outputMode: 'openConversation'` defs whose system prompt teaches
 * the model the desired note shape (frontmatter `supports:` /
 * `rebuts:` carries the structural fact). These tests pin the prompt
 * threading + the polarity-specific contract; the indexer round-trip
 * is covered separately in `tests/main/graph/`.
 */

import { describe, it, expect } from 'vitest';
import '../../../src/shared/tools/definitions/index';
import { getTool, getToolInfosByCategory } from '../../../src/shared/tools/registry';
import { buildConversationPayload } from '../../../src/main/tools/executor';

const FIND_TOOLS = ['research.find-supporting-arguments', 'research.find-opposing-arguments'];

describe('Find Supporting / Opposing Arguments rework (#409 / #410)', () => {
  it('both tools register under the research category', () => {
    const ids = getToolInfosByCategory('research').map((t) => t.id);
    for (const id of FIND_TOOLS) expect(ids).toContain(id);
  });

  it.each(FIND_TOOLS)('%s is conversational + web-on + claimUnderCursor', (id) => {
    const tool = getTool(id)!;
    expect(tool.outputMode).toBe('openConversation');
    expect(tool.web?.defaultEnabled).toBe(true);
    expect(tool.context).toEqual(['claimUnderCursor']);
    expect(tool.preferredModel).toMatch(/^claude-(sonnet|opus|haiku)-/);
    expect(tool.buildSystemPrompt).toBeDefined();
    expect(tool.buildFirstMessage).toBeDefined();
  });

  it('throws a user-facing error when no claim URI is in the context', () => {
    const tool = getTool('research.find-supporting-arguments')!;
    // The renderer's `handleOpenConversationFromTool` catches this and
    // surfaces the message in a confirm dialog (see App.svelte). The
    // exact message asks the user to right-click on a claim line.
    expect(() => tool.buildSystemPrompt!({})).toThrow(/claim/i);
  });

  it('threads the claim URI into the system prompt as the literal IRI value of the polarity-specific frontmatter', () => {
    const supporting = getTool('research.find-supporting-arguments')!;
    const opposing = getTool('research.find-opposing-arguments')!;
    const claim = {
      claimUri: 'https://minerva.dev/c/claim-abc',
      claimLabel: 'Z is true.',
      claimSourceText: 'Of course Z is the case.',
    };
    const supportSys = supporting.buildSystemPrompt!(claim);
    const opposeSys = opposing.buildSystemPrompt!(claim);

    // The frontmatter line is THE structural fact. If the model writes
    // it, the indexer materialises a thought:supports / thought:rebuts
    // edge from the analysis note's IRI to the claim node. Pin both
    // forms here so a regression to e.g. `[[wiki-link]]` syntax (which
    // wouldn't resolve as an IRI) is caught.
    expect(supportSys).toContain('supports: https://minerva.dev/c/claim-abc');
    expect(supportSys).not.toContain('rebuts:');
    expect(opposeSys).toContain('rebuts: https://minerva.dev/c/claim-abc');
    expect(opposeSys).not.toContain('supports:');

    // Each polarity carries its own anti-flattery rule.
    expect(supportSys).toMatch(/do \*\*not\*\* soften|do not soften/i);
    expect(opposeSys).toMatch(/do \*\*not\*\* weaken|do not weaken/i);

    // Both should mention propose_notes (single-note delivery) and the
    // anti-flattery skip-filing rule.
    for (const sys of [supportSys, opposeSys]) {
      expect(sys).toContain('propose_notes');
      expect(sys.toLowerCase()).toMatch(/anti-flattery/);
    }
  });

  it('threads the claim source-text into the prompt as a blockquote so the model has the verbatim passage', () => {
    const tool = getTool('research.find-supporting-arguments')!;
    const sys = tool.buildSystemPrompt!({
      claimUri: 'https://minerva.dev/c/claim-x',
      claimLabel: 'X.',
      claimSourceText: 'Quoted source line one.\nQuoted source line two.',
    });
    expect(sys).toContain('> Quoted source line one.');
    expect(sys).toContain('> Quoted source line two.');
  });

  it('builds a first message that names the polarity verb and carries the claim label', () => {
    const supporting = getTool('research.find-supporting-arguments')!;
    const opposing = getTool('research.find-opposing-arguments')!;
    const ctx = {
      claimUri: 'https://minerva.dev/c/claim-x',
      claimLabel: 'X is the case.',
      claimSourceText: 'Source line.',
    };
    const supportPayload = buildConversationPayload(supporting, {}, { context: ctx });
    const opposePayload = buildConversationPayload(opposing, {}, { context: ctx });

    expect(supportPayload.firstMessage).toMatch(/support/);
    expect(supportPayload.firstMessage).toContain('X is the case.');
    expect(opposePayload.firstMessage).toMatch(/rebut/);
    expect(opposePayload.firstMessage).toContain('X is the case.');
  });
});
