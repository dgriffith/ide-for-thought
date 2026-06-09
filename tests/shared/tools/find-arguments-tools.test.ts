/**
 * Coverage for Find Supporting / Opposing Arguments (#409 / #410), migrated
 * from .ts tools to stock skill files in #627. Both are conversational skills
 * whose system prompt teaches the model the note shape (frontmatter
 * `supports:` / `rebuts:` carries the structural fact). These tests pin the
 * prompt threading + the polarity-specific contract; the indexer round-trip
 * is covered separately in `tests/main/graph/`.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { loadSkillCatalog } from '../../../src/main/skills/loader';
import { compileSkill } from '../../../src/main/skills/compile';
import { buildConversationPayload } from '../../../src/main/tools/executor';
import type { ThinkingToolDef } from '../../../src/shared/tools/types';

const FIND_TOOLS = ['research.find-supporting-arguments', 'research.find-opposing-arguments'];

let defs: Map<string, ThinkingToolDef>;

beforeAll(async () => {
  const cat = await loadSkillCatalog(path.join(__dirname, '__no_user_skills__'));
  expect(cat.errors).toEqual([]);
  defs = new Map(cat.skills.map((s) => [s.id, compileSkill(s)]));
});

describe('Find Supporting / Opposing Arguments (#409 / #410, migrated #627)', () => {
  it.each(FIND_TOOLS)('%s is conversational + web-on + claimUnderCursor', (id) => {
    const tool = defs.get(id)!;
    expect(tool.category).toBe('research');
    expect(tool.outputMode).toBe('openConversation');
    expect(tool.web?.defaultEnabled).toBe(true);
    expect(tool.context).toEqual(['claimUnderCursor']);
    expect(tool.preferredModel).toMatch(/^claude-(sonnet|opus|haiku)-/);
    expect(tool.buildSystemPrompt).toBeDefined();
    expect(tool.buildFirstMessage).toBeDefined();
  });

  it('renders without throwing when no claim URI is present (renderer guards via claimUnderCursor)', () => {
    // The old builder threw; the compiled skill renders an empty claim block.
    // The renderer's pre-invoke check still prevents this path in practice.
    const tool = defs.get('research.find-supporting-arguments')!;
    expect(() => tool.buildSystemPrompt!({})).not.toThrow();
    expect(tool.buildSystemPrompt!({})).toContain('**URI:**');
  });

  it('threads the claim URI into the system prompt as the literal IRI value of the polarity-specific frontmatter', () => {
    const claim = {
      claimUri: 'https://minerva.dev/c/claim-abc',
      claimLabel: 'Z is true.',
      claimSourceText: 'Of course Z is the case.',
    };
    const supportSys = defs.get('research.find-supporting-arguments')!.buildSystemPrompt!(claim);
    const opposeSys = defs.get('research.find-opposing-arguments')!.buildSystemPrompt!(claim);

    expect(supportSys).toContain('supports: https://minerva.dev/c/claim-abc');
    expect(supportSys).not.toContain('rebuts:');
    expect(opposeSys).toContain('rebuts: https://minerva.dev/c/claim-abc');
    expect(opposeSys).not.toContain('supports:');

    expect(supportSys).toMatch(/do \*\*not\*\* soften|do not soften/i);
    expect(opposeSys).toMatch(/do \*\*not\*\* weaken|do not weaken/i);

    for (const sys of [supportSys, opposeSys]) {
      expect(sys).toContain('propose_notes');
      expect(sys.toLowerCase()).toMatch(/anti-flattery/);
    }
  });

  it('threads the claim source-text into the prompt as a blockquote', () => {
    const sys = defs.get('research.find-supporting-arguments')!.buildSystemPrompt!({
      claimUri: 'https://minerva.dev/c/claim-x',
      claimLabel: 'X.',
      claimSourceText: 'Quoted source line one.\nQuoted source line two.',
    });
    expect(sys).toContain('> Quoted source line one.');
    expect(sys).toContain('> Quoted source line two.');
  });

  it('builds a first message that names the polarity verb and carries the claim label', () => {
    const ctx = {
      claimUri: 'https://minerva.dev/c/claim-x',
      claimLabel: 'X is the case.',
      claimSourceText: 'Source line.',
    };
    const supportPayload = buildConversationPayload(defs.get('research.find-supporting-arguments')!, {}, { context: ctx });
    const opposePayload = buildConversationPayload(defs.get('research.find-opposing-arguments')!, {}, { context: ctx });

    expect(supportPayload.firstMessage).toMatch(/support/);
    expect(supportPayload.firstMessage).toContain('X is the case.');
    expect(opposePayload.firstMessage).toMatch(/rebut/);
    expect(opposePayload.firstMessage).toContain('X is the case.');
  });
});
