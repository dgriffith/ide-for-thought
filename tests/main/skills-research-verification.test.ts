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

  it.each(VERIFICATION)('%s threads claim context into the user turn (#2438)', (id) => {
    const def = defs.get(id)!;
    const ctx = { claimUri: 'https://ex/claim/1', claimLabel: 'Coffee cures scurvy', claimSourceText: 'Coffee cures scurvy.' };
    const sys = def.buildSystemPrompt!(ctx);
    expect(sys).not.toContain('https://ex/claim/1');
    expect(sys).not.toContain('Coffee cures scurvy');
    // claim URI present → the filing turtle block is emitted, hidden since it
    // annotates the ORIGINAL claim rather than this note (#907-era hidden-fence pass)
    expect(sys).toContain('```turtle-hidden');
    const material = def.buildUserContext!(ctx);
    expect(material).toContain('<thoughtbase-content kind="claim-uri">https://ex/claim/1</thoughtbase-content>');
    expect(material).toContain('<thoughtbase-content kind="claim-label">Coffee cures scurvy</thoughtbase-content>');
    expect(material).toContain('<thoughtbase-content kind="claim-source-text">');
    // The visible first message says "this claim" rather than quoting it.
    const fm = def.buildFirstMessage!(ctx);
    expect(fm).toMatch(/this claim/);
    expect(fm).not.toContain('Coffee cures scurvy');
  });

  it.each(VERIFICATION)('%s falls back to a selection when no claim is under the cursor', (id) => {
    const def = defs.get(id)!;
    const sys = def.buildSystemPrompt!({ selectedText: 'unique-passage-zzz' });
    expect(sys).not.toContain('unique-passage-zzz');
    expect(def.buildUserContext!({ selectedText: 'unique-passage-zzz' })).toContain('unique-passage-zzz');
    // no claim URI → no turtle block to attach a verdict to
    expect(sys).not.toContain('```turtle-hidden');
    const fm = def.buildFirstMessage!({ selectedText: 'unique-passage-zzz' });
    expect(fm).toMatch(/this passage/);
    expect(fm).not.toContain('unique-passage-zzz');
  });

  it('find-sources adapts to selection / note / neither without throwing', () => {
    const def = defs.get('research.find-sources')!;
    const sel = { selectedText: 'quantum error correction' };
    expect(def.buildFirstMessage!(sel)).toMatch(/this selection/);
    expect(def.buildFirstMessage!(sel)).not.toContain('quantum error correction');
    expect(def.buildUserContext!(sel)).toContain('quantum error correction');
    const note = { fullNoteTitle: 'My Survey', fullNoteContent: 'body' };
    expect(def.buildFirstMessage!(note)).toMatch(/this note/);
    expect(def.buildUserContext!(note)).toContain('My Survey');
    expect(def.buildFirstMessage!({})).toMatch(/topic/i);
  });
});
