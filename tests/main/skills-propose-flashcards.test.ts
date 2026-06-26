/**
 * Propose Flashcards (#854) — note-scoped Learning skill. Pins that it loads as
 * a Learning conversation skill over the full note and instructs the model to
 * file `[!card]` callouts via the existing `propose_notes` approval path.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { loadSkillCatalog } from '../../src/main/skills/loader';
import { compileSkill } from '../../src/main/skills/compile';
import type { ThinkingToolDef } from '../../src/shared/tools/types';

let def: ThinkingToolDef;

beforeAll(async () => {
  const cat = await loadSkillCatalog(path.join(__dirname, '__no_user_skills__'));
  expect(cat.errors).toEqual([]);
  const skill = cat.skills.find((s) => s.id === 'learning.propose-flashcards');
  expect(skill).toBeDefined();
  def = compileSkill(skill!);
});

describe('propose-flashcards skill', () => {
  it('is a note-scoped Learning conversation skill with a slash command', () => {
    expect(def.category).toBe('learning');
    expect(def.outputMode).toBe('openConversation');
    expect(def.context).toContain('fullNote');
    expect(def.slashCommand).toBe('/cards');
  });

  it('threads the note into the prompt and instructs propose_notes + the [!card] shape', () => {
    const sys = def.buildSystemPrompt!({
      fullNoteContent: 'the-note-body-zzz',
      fullNoteTitle: 'Raft',
    });
    expect(sys).toContain('the-note-body-zzz');
    expect(sys).toContain('Raft');
    expect(sys).toContain('propose_notes'); // reuses the existing approval path
    expect(sys).toContain('[!card]');       // the card callout shape (#851)
    expect(sys).toContain('---');           // the front/back divider
    expect(sys).toMatch(/atomic/i);         // card-writing guidance
  });

  it('degrades gracefully when there is no active note', () => {
    const sys = def.buildSystemPrompt!({ fullNoteContent: '' });
    expect(sys).toContain('no active note');
  });
});
