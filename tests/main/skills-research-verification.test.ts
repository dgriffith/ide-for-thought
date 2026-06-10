/**
 * Research verification cluster + discovery skills (#414–#417, #108), authored
 * as stock skills on the skill infrastructure. Pins that they load, classify
 * under Research, carry their thematic group, default web on, and thread the
 * claim / selection / note context through both the system prompt and the
 * auto-fired first message without throwing on any branch.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { loadSkillCatalog } from '../../src/main/skills/loader';
import { compileSkill } from '../../src/main/skills/compile';
import type { SkillDef } from '../../src/shared/skills/types';
import type { ThinkingToolDef } from '../../src/shared/tools/types';

const VERIFICATION = [
  'research.check-facts',
  'research.find-primary-sources',
  'research.date-scope-check',
  'research.translate-magnitude',
];
const DISCOVERY = ['research.find-sources'];
const ALL = [...VERIFICATION, ...DISCOVERY];

let skills: Map<string, SkillDef>;
let defs: Map<string, ThinkingToolDef>;

beforeAll(async () => {
  const cat = await loadSkillCatalog(path.join(__dirname, '__no_user_skills__'));
  expect(cat.errors).toEqual([]);
  skills = new Map(cat.skills.map((s) => [s.id, s]));
  defs = new Map(cat.skills.map((s) => [s.id, compileSkill(s)]));
});

describe('research verification + discovery skills', () => {
  it('all five are stock Research conversation skills with web on', () => {
    for (const id of ALL) {
      const s = skills.get(id);
      expect(s, id).toBeDefined();
      expect(s!.source).toBe('stock');
      expect(s!.menu).toBe('Research');
      expect(s!.outputMode).toBe('openConversation');
      expect(s!.web, id).toBe(true);
      expect(defs.get(id)!.web?.defaultEnabled, id).toBe(true);
    }
  });

  it('the verification cluster shares the Verification group; find-sources is Discovery', () => {
    for (const id of VERIFICATION) expect(skills.get(id)!.group, id).toBe('Verification');
    expect(skills.get('research.find-sources')!.group).toBe('Discovery');
  });

  it('each declares a slash command', () => {
    for (const id of ALL) expect(defs.get(id)!.slashCommand, id).toMatch(/^\//);
  });

  it.each(VERIFICATION)('%s threads claim context into prompt + first message', (id) => {
    const def = defs.get(id)!;
    const ctx = { claimUri: 'https://ex/claim/1', claimLabel: 'Coffee cures scurvy', claimSourceText: 'Coffee cures scurvy.' };
    const sys = def.buildSystemPrompt!(ctx);
    expect(sys).toContain('https://ex/claim/1');
    expect(sys).toContain('Coffee cures scurvy');
    // claim URI present → the filing turtle block is emitted
    expect(sys).toContain('```turtle');
    expect(def.buildFirstMessage!(ctx)).toContain('Coffee cures scurvy');
  });

  it.each(VERIFICATION)('%s falls back to a selection when no claim is under the cursor', (id) => {
    const def = defs.get(id)!;
    const sys = def.buildSystemPrompt!({ selectedText: 'unique-passage-zzz' });
    expect(sys).toContain('unique-passage-zzz');
    // no claim URI → no turtle block to attach a verdict to
    expect(sys).not.toContain('```turtle');
    expect(def.buildFirstMessage!({ selectedText: 'unique-passage-zzz' })).toContain('unique-passage-zzz');
  });

  it('find-sources adapts to selection / note / neither without throwing', () => {
    const def = defs.get('research.find-sources')!;
    expect(def.buildFirstMessage!({ selectedText: 'quantum error correction' })).toContain('quantum error correction');
    expect(def.buildFirstMessage!({ fullNoteTitle: 'My Survey', fullNoteContent: 'body' })).toContain('My Survey');
    expect(def.buildFirstMessage!({})).toMatch(/topic/i);
  });
});
