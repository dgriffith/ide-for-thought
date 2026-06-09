/**
 * Coverage for the research skills (migrated from .ts tools to stock skill
 * files in #627). Exercises the compiled stock skills end-to-end.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { loadSkillCatalog } from '../../../src/main/skills/loader';
import { compileSkill } from '../../../src/main/skills/compile';
import { buildConversationPayload } from '../../../src/main/tools/executor';
import type { ThinkingToolDef } from '../../../src/shared/tools/types';

let defs: Map<string, ThinkingToolDef>;

beforeAll(async () => {
  const cat = await loadSkillCatalog(path.join(__dirname, '__no_user_skills__'));
  expect(cat.errors).toEqual([]);
  defs = new Map(cat.skills.map((s) => [s.id, compileSkill(s)]));
});

describe('research.load-bearing-claim (#413, migrated #627)', () => {
  it('is a research skill, conversational + web-on by default', () => {
    const tool = defs.get('research.load-bearing-claim')!;
    expect(tool.category).toBe('research');
    expect(tool.outputMode).toBe('openConversation');
    expect(tool.web?.defaultEnabled).toBe(true);
    expect(tool.preferredModel).toMatch(/^claude-(sonnet|opus|haiku)-/);
    expect(tool.buildSystemPrompt).toBeDefined();
    expect(tool.buildFirstMessage).toBeDefined();
  });

  it('does NOT require selection — running on the whole note is a valid use', () => {
    expect(defs.get('research.load-bearing-claim')!.requiresSelection).toBeFalsy();
  });

  it('threads the source path into the system prompt without the .md suffix', () => {
    const payload = buildConversationPayload(
      defs.get('research.load-bearing-claim')!,
      {},
      {
        context: {
          fullNotePath: 'notes/standup-2026-04-26.md',
          fullNoteTitle: 'standup-2026-04-26',
          fullNoteContent: 'Some passage with a load-bearing claim.',
        },
      },
    );
    expect(payload.systemPrompt).toContain('notes/standup-2026-04-26.md');
    expect(payload.systemPrompt).toMatch(/`notes\/standup-2026-04-26`/);
  });

  it('teaches the typed-wiki-link convention so structure flows through indexing', () => {
    const sys = defs.get('research.load-bearing-claim')!.buildSystemPrompt!({});
    expect(sys).toContain('[[load-bearing-for::');
    expect(sys).toContain('load-bearing-for:');
    expect(sys).toMatch(/anti-flattery/i);
    expect(sys).toContain('propose_notes');
    expect(sys).toMatch(/runners-up/i);
  });

  it('falls back gracefully when the passage was not pulled from a saved note', () => {
    const sys = defs.get('research.load-bearing-claim')!.buildSystemPrompt!({});
    expect(sys).toMatch(/skip the/i);
    expect(sys).toMatch(/load-bearing-for/);
  });

  it('builds a first message that includes the passage and a source label', () => {
    const payload = buildConversationPayload(
      defs.get('research.load-bearing-claim')!,
      {},
      { context: { selectedText: 'A then B then therefore C.', fullNoteContent: 'full note body', fullNoteTitle: 'argument' } },
    );
    expect(payload.firstMessage).toContain('A then B then therefore C.');
    expect(payload.firstMessage).toMatch(/Selection from: argument/);
  });

  it('handles the no-passage edge by operating on the current passage', () => {
    const payload = buildConversationPayload(defs.get('research.load-bearing-claim')!, {}, { context: {} });
    expect(payload.firstMessage).toContain('Find the load-bearing claim');
  });
});

describe('research skills present', () => {
  it('all six load with the expected ids', () => {
    for (const id of [
      'research.crystallize',
      'research.decompose',
      'research.decompose-into-claims',
      'research.find-supporting-arguments',
      'research.find-opposing-arguments',
      'research.load-bearing-claim',
    ]) {
      expect(defs.get(id), id).toBeDefined();
      expect(defs.get(id)!.category).toBe('research');
    }
  });

  it('decompose carries the ask_user opt-in tool', () => {
    expect(defs.get('research.decompose')!.requiresTools).toEqual(['ask_user']);
  });
});
