/**
 * Find Tensions (#516) — the first stock skill that operates on two notes via
 * a note-picker parameter. Pins that it loads, declares the `note` param, and
 * threads the picked note's resolved content/title into both the system prompt
 * and the first message.
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
  const skill = cat.skills.find((s) => s.id === 'analysis.find-tensions');
  expect(skill).toBeDefined();
  def = compileSkill(skill!);
});

describe('find-tensions skill', () => {
  it('declares a required note-picker parameter', () => {
    const p = def.parameters?.find((x) => x.id === 'otherNote');
    expect(p?.type).toBe('note');
    expect(p?.required).toBe(true);
  });

  it('is an Analysis / Disagreement conversation skill', () => {
    expect(def.category).toBe('analysis');
    expect(def.group).toBe('Disagreement');
    expect(def.outputMode).toBe('openConversation');
  });

  it('threads both notes into the user turn when the pick resolves (#2438)', () => {
    const ctx = {
      fullNoteTitle: 'Active One',
      fullNoteContent: 'active-body-aaa',
      parameterValues: {
        otherNote: 'ideas/Other.md',
        'otherNote.title': 'Other Two',
        'otherNote.content': 'other-body-bbb',
      },
    };
    const sys = def.buildSystemPrompt!(ctx);
    expect(sys).toContain('## Process');
    for (const text of ['active-body-aaa', 'other-body-bbb', 'Active One', 'Other Two']) {
      expect(sys).not.toContain(text);
    }
    const material = def.buildUserContext!(ctx);
    expect(material).toContain('<thoughtbase-content kind="note">\nactive-body-aaa\n</thoughtbase-content>');
    // The picked note's companions are thoughtbase text too.
    expect(material).toContain('<thoughtbase-content kind="note" path="ideas/Other.md">\nother-body-bbb\n</thoughtbase-content>');
    expect(material).toContain('<thoughtbase-content kind="note-title">Active One</thoughtbase-content>');
    expect(material).toContain('<thoughtbase-content kind="note-title">Other Two</thoughtbase-content>');
  });

  it('first message asks generically; the note names ride in the user-turn material', () => {
    const ctx = {
      fullNoteTitle: 'Active One',
      fullNoteContent: 'active-body',
      parameterValues: { otherNote: 'x.md', 'otherNote.title': 'Other Two', 'otherNote.content': 'b' },
    };
    const fm = def.buildFirstMessage!(ctx);
    expect(fm).toBe('Find the tensions between these two notes.');
    expect(def.buildUserContext!(ctx)).toContain('Other Two');
  });

  it('falls back gracefully when the picked note could not be read', () => {
    const sys = def.buildSystemPrompt!({
      fullNoteTitle: 'Active One',
      fullNoteContent: 'active-body',
      parameterValues: { otherNote: 'gone.md' }, // no .content
    });
    expect(sys).toContain('No second note was readable');
    const fm = def.buildFirstMessage!({
      fullNoteTitle: 'Active One',
      fullNoteContent: 'active-body',
      parameterValues: { otherNote: 'gone.md' },
    });
    expect(fm).toContain("couldn't be read");
    expect(fm).not.toContain('gone.md');
    expect(def.buildUserContext!({
      fullNoteTitle: 'Active One',
      fullNoteContent: 'active-body',
      parameterValues: { otherNote: 'gone.md' },
    })).toContain('Picked note path: <thoughtbase-content kind="note-path">gone.md</thoughtbase-content>');
  });
});
