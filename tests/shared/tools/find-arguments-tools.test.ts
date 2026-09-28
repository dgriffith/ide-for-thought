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
    // The claim block is material, so it lives in the user-turn context (#2438).
    expect(tool.buildSystemPrompt!({})).not.toContain('**URI:**');
    expect(tool.buildUserContext!({})).toContain('**URI:**');
  });

  it('teaches the polarity-specific frontmatter and hands the claim URI over in the user-turn context (#2438)', () => {
    const claim = {
      claimUri: 'https://minerva.dev/c/claim-abc',
      claimLabel: 'Z is true.',
      claimSourceText: 'Of course Z is the case.',
    };
    const support = defs.get('research.find-supporting-arguments')!;
    const oppose = defs.get('research.find-opposing-arguments')!;
    const supportSys = support.buildSystemPrompt!(claim);
    const opposeSys = oppose.buildSystemPrompt!(claim);

    expect(supportSys).toContain('supports: <the claim URI given in the user message>');
    expect(supportSys).not.toContain('rebuts:');
    expect(opposeSys).toContain('rebuts: <the claim URI given in the user message>');
    expect(opposeSys).not.toContain('supports:');
    for (const sys of [supportSys, opposeSys]) {
      expect(sys).not.toContain('https://minerva.dev/c/claim-abc');
      expect(sys).not.toContain('Z is true.');
    }
    for (const def of [support, oppose]) {
      expect(def.buildUserContext!(claim)).toContain(
        '**URI:** <thoughtbase-content kind="claim-uri">https://minerva.dev/c/claim-abc</thoughtbase-content>',
      );
      expect(def.buildUserContext!(claim)).toContain(
        '**Label:** <thoughtbase-content kind="claim-label">Z is true.</thoughtbase-content>',
      );
    }

    expect(supportSys).toMatch(/do \*\*not\*\* soften|do not soften/i);
    expect(opposeSys).toMatch(/do \*\*not\*\* weaken|do not weaken/i);

    for (const sys of [supportSys, opposeSys]) {
      expect(sys).toContain('propose_notes');
      expect(sys.toLowerCase()).toMatch(/anti-flattery/);
    }
  });

  it('threads the claim source-text into the user-turn context as a delimited blockquote', () => {
    const def = defs.get('research.find-supporting-arguments')!;
    const ctx = {
      claimUri: 'https://minerva.dev/c/claim-x',
      claimLabel: 'X.',
      claimSourceText: 'Quoted source line one.\nQuoted source line two.',
    };
    expect(def.buildSystemPrompt!(ctx)).not.toContain('Quoted source line');
    expect(def.buildUserContext!(ctx)).toContain(
      '<thoughtbase-content kind="claim-source-text">\n> Quoted source line one.\n> Quoted source line two.\n</thoughtbase-content>',
    );
  });

  it('builds a first message that names the polarity verb; the claim label rides in the context (#2438)', () => {
    const ctx = {
      claimUri: 'https://minerva.dev/c/claim-x',
      claimLabel: 'X is the case.',
      claimSourceText: 'Source line.',
    };
    const supportPayload = buildConversationPayload(defs.get('research.find-supporting-arguments')!, {}, { context: ctx });
    const opposePayload = buildConversationPayload(defs.get('research.find-opposing-arguments')!, {}, { context: ctx });

    expect(supportPayload.firstMessage).toMatch(/^Find the strongest arguments that support this claim\./);
    expect(opposePayload.firstMessage).toMatch(/^Find the strongest arguments that rebut this claim\./);
    for (const p of [supportPayload, opposePayload]) {
      expect(p.firstMessage).not.toContain('X is the case.');
      expect(p.skillContext).toContain('<thoughtbase-content kind="claim-label">X is the case.</thoughtbase-content>');
    }
  });
});
