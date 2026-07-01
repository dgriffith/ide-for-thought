import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { loadSkillCatalog } from '../../src/main/skills/loader';

describe('Fill Out Note skill (#939)', () => {
  it('ships in the Analysis menu, note-scoped, driving propose_note_body — propose-only', async () => {
    // Point at a non-existent user dir so only stock skills load.
    const cat = await loadSkillCatalog(path.join(os.tmpdir(), 'minerva-no-user-skills-939'));
    expect(cat.errors).toEqual([]);

    const s = cat.skills.find((sk) => sk.name === 'Fill Out Note');
    expect(s, 'Fill Out Note should ship as a stock skill').toBeDefined();
    expect(s!.source).toBe('stock');
    expect(s!.menu).toBe('Analysis');
    expect(s!.group).toBe('Generation');
    expect(s!.outputMode).toBe('openConversation');
    // Acts on the active note, so it surfaces in the editor right-click.
    expect(s!.context).toContain('fullNote');
    // Drives the in-place rewrite tool (#937) — and the body carries the note.
    expect(s!.body).toContain('propose_note_body');
    expect(s!.body).toContain('{{note.content');
    // Trust principle: proposes a diff, never writes the note itself.
    expect(s!.body.toLowerCase()).toContain('propose, never apply');
    // Auto-fires only when a note is open (guarded firstMessage).
    expect(s!.firstMessage).toContain('{{#if note}}');
  });
});
