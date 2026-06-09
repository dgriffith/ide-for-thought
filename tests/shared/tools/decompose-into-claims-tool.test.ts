/**
 * Coverage for Decompose into Claims (#408), migrated from a .ts tool to a
 * stock skill file in #627. Conversational skill whose system prompt teaches
 * the model the parent + N-children bundle shape, with per-claim structure
 * encoded via frontmatter + a small turtle block. These tests pin the prompt
 * threading + the bundle-shape contract; the indexer round-trip is covered
 * separately in `tests/main/graph/`.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { loadSkillCatalog } from '../../../src/main/skills/loader';
import { compileSkill } from '../../../src/main/skills/compile';
import { buildConversationPayload } from '../../../src/main/tools/executor';
import type { ThinkingToolDef } from '../../../src/shared/tools/types';

const TOOL_ID = 'research.decompose-into-claims';

let tool: ThinkingToolDef;

beforeAll(async () => {
  const cat = await loadSkillCatalog(path.join(__dirname, '__no_user_skills__'));
  expect(cat.errors).toEqual([]);
  tool = compileSkill(cat.skills.find((s) => s.id === TOOL_ID)!);
});

describe('research.decompose-into-claims (#408, migrated #627)', () => {
  it('is a research skill, conversational + no web by default', () => {
    expect(tool.category).toBe('research');
    expect(tool.outputMode).toBe('openConversation');
    expect(tool.web?.defaultEnabled).toBe(false);
    expect(tool.context).toEqual(['selectedText', 'fullNote']);
    expect(tool.preferredModel).toMatch(/^claude-(sonnet|opus|haiku)-/);
    expect(tool.buildSystemPrompt).toBeDefined();
    expect(tool.buildFirstMessage).toBeDefined();
  });

  it('does not require selection — running on the whole note is a valid use', () => {
    expect(tool.requiresSelection).toBeFalsy();
  });

  it('threads the source path into the system prompt and pins the wiki-link convention', () => {
    const sys = tool.buildSystemPrompt!({
      fullNotePath: 'notes/standup-2026-04-26.md',
      fullNoteTitle: 'standup-2026-04-26',
      fullNoteContent: 'Some passage with a few claims.',
    });
    expect(sys).toContain('notes/standup-2026-04-26.md');
    expect(sys).toMatch(/`notes\/standup-2026-04-26`/);
  });

  it('teaches the parent (decomposes:) and per-claim frontmatter contract', () => {
    const sys = tool.buildSystemPrompt!({});
    expect(sys).toMatch(/decomposes:/);
    expect(sys).toMatch(/claim-kind:/);
    expect(sys).toMatch(/source-text:/);
    expect(sys).toMatch(/extracted-from:/);
    expect(sys).toMatch(/extracted-by:/);
    expect(sys).toMatch(/factual/);
    expect(sys).toMatch(/evaluative/);
    expect(sys).toMatch(/definitional/);
    expect(sys).toMatch(/predictive/);
    expect(sys).toContain('this: a thought:Claim');
    expect(sys).toMatch(/single propose_notes/i);
    expect(sys.toLowerCase()).toMatch(/anti-flattery/);
  });

  it('falls back gracefully when the passage was not pulled from a saved note', () => {
    const sys = tool.buildSystemPrompt!({});
    expect(sys).toMatch(/skip the/i);
    expect(sys).toMatch(/decomposes:|extracted-from:/);
  });

  it('builds a first message that includes the passage', () => {
    const payload = buildConversationPayload(
      tool,
      {},
      { context: { selectedText: 'A then B then therefore C.', fullNoteContent: 'full note body', fullNoteTitle: 'argument' } },
    );
    expect(payload.firstMessage).toContain('A then B then therefore C.');
    expect(payload.firstMessage).toMatch(/Selection from: argument/);
  });

  it('handles the no-passage edge by asking the model to operate on the current passage', () => {
    const payload = buildConversationPayload(tool, {}, { context: {} });
    expect(payload.firstMessage).toMatch(/decompose/i);
  });
});
