/**
 * Analysis skills (migrated from .ts tools to stock skill files in #628).
 * Parity with the old hardcoded builders was verified at migration time; this
 * durable test pins that all 20 load, classify correctly, and render their
 * source/param threading.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { loadSkillCatalog } from '../../src/main/skills/loader';
import { compileSkill } from '../../src/main/skills/compile';
import type { ThinkingToolDef } from '../../src/shared/tools/types';
import type { SkillDef } from '../../src/shared/skills/types';

const CONVERSATION = [
  'analysis.antithesize', 'analysis.aversionfactor', 'analysis.dimensionalize',
  'analysis.doublecrux', 'analysis.goalfactor', 'analysis.hamming',
  'analysis.handlize', 'analysis.inductify', 'analysis.innerloop',
  'analysis.metaphorize', 'analysis.negspace', 'analysis.noticing',
  'analysis.referenceclass', 'analysis.rhetoricize', 'analysis.rhyme',
  'analysis.synthesize',
];
const ONESHOT = ['analysis.excavate', 'planning.murphyjitsu', 'planning.steelman', 'planning.taboo'];

let skills: Map<string, SkillDef>;
let defs: Map<string, ThinkingToolDef>;

beforeAll(async () => {
  const cat = await loadSkillCatalog(path.join(__dirname, '__no_user_skills__'));
  expect(cat.errors).toEqual([]);
  skills = new Map(cat.skills.map((s) => [s.id, s]));
  defs = new Map(cat.skills.map((s) => [s.id, compileSkill(s)]));
});

describe('Analysis skills load + classify', () => {
  it('all 20 are stock Analysis skills', () => {
    for (const id of [...CONVERSATION, ...ONESHOT]) {
      const s = skills.get(id);
      expect(s, id).toBeDefined();
      expect(s!.source).toBe('stock');
      expect(s!.menu).toBe('Analysis');
    }
  });

  it('every Analysis skill declares a thematic group (#525) that survives compile', () => {
    const GROUPS = new Set(['Disagreement', 'Planning', 'Motivation', 'Semantic', 'Generation', 'Pattern', 'Diagnostic']);
    for (const id of [...CONVERSATION, ...ONESHOT]) {
      const s = skills.get(id)!;
      expect(s.group, id).toBeDefined();
      expect(GROUPS.has(s.group!), `${id} → ${s.group}`).toBe(true);
      expect(compileSkill(s).group).toBe(s.group);
    }
  });

  it.each(CONVERSATION)('%s is a conversation skill with source threading + first message', (id) => {
    const def = defs.get(id)!;
    expect(def.outputMode).toBe('openConversation');
    expect(def.buildSystemPrompt).toBeDefined();
    // Selection threads in under a Selection heading.
    const sys = def.buildSystemPrompt!({ selectedText: 'distinct-token-xyz' });
    expect(sys).toContain('## Selection');
    expect(sys).toContain('distinct-token-xyz');
    // First message names the subject.
    expect(def.buildFirstMessage!({ selectedText: 'x' })).toMatch(/^For this selection, /);
    expect(def.buildFirstMessage!({ fullNoteContent: 'x' })).toMatch(/^For this note, /);
  });

  it.each(ONESHOT)('%s is a one-shot newNote skill with a prompt + slash command', (id) => {
    const def = defs.get(id)!;
    expect(def.outputMode).toBe('newNote');
    expect(def.outputNotePrefix).toBeTruthy();
    expect(def.slashCommand).toMatch(/^\//);
    const prompt = def.buildPrompt({ fullNoteContent: 'note-token-abc' });
    expect(prompt).toContain('note-token-abc');
  });
});

describe('Analysis parameter threading', () => {
  it('antithesize folds the intensity directive into the system prompt', () => {
    const intense = skills.get('analysis.antithesize')!.parameters[0].options!
      .find((o) => o.label.includes('Adversarial'))!.value;
    const sys = defs.get('analysis.antithesize')!.buildSystemPrompt!({ selectedText: 's', parameterValues: { intensity: intense } });
    expect(sys).toContain('Contract: adversarial.');
    expect(sys).toContain('far edge of plausibility');
  });

  it('dimensionalize threads the target count', () => {
    const sys = defs.get('analysis.dimensionalize')!.buildSystemPrompt!({ selectedText: 's', parameterValues: { target_count: '7' } });
    expect(sys).toContain('aim for ~7');
  });

  it('synthesize threads depth + audience', () => {
    const sys = defs.get('analysis.synthesize')!.buildSystemPrompt!({ selectedText: 's', parameterValues: { depth: 'deep', audience: 'expert' } });
    expect(sys).toContain('Output tier: deep.');
    expect(sys).toContain('Audience: expert.');
  });

  it('excavate inlines the depth instructions into the one-shot prompt', () => {
    const deep = skills.get('analysis.excavate')!.parameters[0].options!
      .find((o) => o.label.includes('Deep'))!.value;
    const prompt = defs.get('analysis.excavate')!.buildPrompt({ fullNoteContent: 'n', parameterValues: { depth: deep } });
    expect(prompt).toContain('Perform a **deep** excavation');
    expect(prompt).toContain('genealogy');
  });

  it('murphyjitsu prefers the plan param over note content', () => {
    const def = defs.get('planning.murphyjitsu')!;
    const withPlan = def.buildPrompt({ fullNoteContent: 'NOTE', parameterValues: { plan: 'MY PLAN' } });
    expect(withPlan).toContain('Plan Description');
    expect(withPlan).toContain('MY PLAN');
    expect(withPlan).not.toContain('NOTE');
    const noPlan = def.buildPrompt({ fullNoteContent: 'NOTE', parameterValues: {} });
    expect(noPlan).toContain('NOTE');
  });

  it('taboo substitutes the banned term throughout the prompt', () => {
    const prompt = defs.get('planning.taboo')!.buildPrompt({ fullNoteContent: 'n', parameterValues: { term: 'consciousness' } });
    expect(prompt).toContain('consciousness');
    expect(prompt).not.toContain('{{param.term}}');
  });
});
