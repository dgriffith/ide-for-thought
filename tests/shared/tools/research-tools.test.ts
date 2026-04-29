/**
 * Coverage for the research-category tool definitions (#413 onwards).
 *
 * Mirrors the learning-tools.test.ts pattern: the registry shape +
 * the buildSystemPrompt / buildFirstMessage threading, since those are
 * the only functions consumers touch directly.
 */

import { describe, it, expect } from 'vitest';
import '../../../src/shared/tools/definitions/index';
import { getTool, getToolInfosByCategory } from '../../../src/shared/tools/registry';
import { buildConversationPayload } from '../../../src/main/tools/executor';

describe('research.load-bearing-claim (#413)', () => {
  it('is registered under the research category', () => {
    const ids = getToolInfosByCategory('research').map((t) => t.id);
    expect(ids).toContain('research.load-bearing-claim');
  });

  it('is conversational + web-on by default', () => {
    const tool = getTool('research.load-bearing-claim')!;
    expect(tool.outputMode).toBe('openConversation');
    expect(tool.web?.defaultEnabled).toBe(true);
    expect(tool.preferredModel).toMatch(/^claude-(sonnet|opus|haiku)-/);
    expect(tool.buildSystemPrompt).toBeDefined();
    expect(tool.buildFirstMessage).toBeDefined();
  });

  it('does NOT require selection — running on the whole note is a valid use', () => {
    // Selecting the whole paragraph and "do the analysis on the whole
    // note" should both work; gating on selection would force the user
    // to ⌘A every time.
    const tool = getTool('research.load-bearing-claim')!;
    expect(tool.requiresSelection).toBeFalsy();
  });

  it('threads the source path into the system prompt without the .md suffix', () => {
    const tool = getTool('research.load-bearing-claim')!;
    const payload = buildConversationPayload(
      tool,
      {},
      {
        context: {
          fullNotePath: 'notes/standup-2026-04-26.md',
          fullNoteTitle: 'standup-2026-04-26',
          fullNoteContent: 'Some passage with a load-bearing claim.',
        },
      },
    );
    // Pin both forms in the prompt: the full file path (so the model
    // knows where the passage came from) and the stem in
    // backtick-fences (the literal target the model should use in the
    // wiki-link). The regex catches the stem as a balanced
    // `code-fenced` token without the .md suffix.
    expect(payload.systemPrompt).toContain('notes/standup-2026-04-26.md');
    expect(payload.systemPrompt).toMatch(/`notes\/standup-2026-04-26`/);
  });

  it('teaches the model the typed-wiki-link convention so structure flows through indexing', () => {
    const tool = getTool('research.load-bearing-claim')!;
    const sys = tool.buildSystemPrompt!({});
    // The triple `thought:loadBearingFor` is materialised from this
    // exact link form via the LINK_TYPES registry. If the prompt
    // drifts to a different shape (e.g. plain `[[…]]`), the structural
    // fact disappears from the graph silently — pin it here.
    expect(sys).toContain('[[load-bearing-for::');
    expect(sys).toContain('load-bearing-for:'); // frontmatter key
    expect(sys).toMatch(/anti-flattery/i);
    expect(sys).toContain('propose_notes');
    expect(sys).toMatch(/runners-up/i);
  });

  it('falls back gracefully when the passage was not pulled from a saved note', () => {
    const tool = getTool('research.load-bearing-claim')!;
    const sys = tool.buildSystemPrompt!({});
    // Without a source path, telling the model to write a wiki-link
    // pointing nowhere would produce an unresolvable link. The prompt
    // explicitly drops the frontmatter + inline link in that case.
    expect(sys).toMatch(/skip the/i);
    expect(sys).toMatch(/load-bearing-for/);
  });

  it('builds a first message that includes the passage and a source label', () => {
    const tool = getTool('research.load-bearing-claim')!;
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
    const tool = getTool('research.load-bearing-claim')!;
    const payload = buildConversationPayload(
      tool,
      {},
      { context: {} },
    );
    // Empty context shouldn't error — the user could have invoked the
    // tool without a note open. The first message stays generic.
    expect(payload.firstMessage).toContain('Find the load-bearing claim');
  });
});
