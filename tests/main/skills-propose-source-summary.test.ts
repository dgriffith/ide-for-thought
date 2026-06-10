/**
 * Propose Summary (#103) — the first source-scoped stock skill. Pins that it
 * loads with `scope: source`, gathers source context, and threads the source's
 * id/title/body into the system prompt with an instruction to file via
 * `propose_source_properties`.
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
  const skill = cat.skills.find((s) => s.id === 'research.propose-source-summary');
  expect(skill).toBeDefined();
  def = compileSkill(skill!);
});

describe('propose-source-summary skill', () => {
  it('is a source-scoped Research conversation skill', () => {
    expect(def.scope).toBe('source');
    expect(def.category).toBe('research');
    expect(def.group).toBe('Summarize');
    expect(def.outputMode).toBe('openConversation');
  });

  it('requests source metadata + body context', () => {
    expect(def.context).toContain('sourceMetadata');
    expect(def.context).toContain('sourceBody');
  });

  it('threads the source into the system prompt and instructs the file tool', () => {
    const sys = def.buildSystemPrompt!({
      sourceId: 'src-xyz',
      sourceTitle: 'On Widgets',
      sourceBody: 'widget-body-zzz',
    });
    expect(sys).toContain('widget-body-zzz');
    expect(sys).toContain('On Widgets');
    expect(sys).toContain('src-xyz'); // sourceId passed through to the tool call
    expect(sys).toContain('propose_source_properties');
    expect(sys).toContain('## Process');
  });

  it('first message names the source when a body is present', () => {
    const fm = def.buildFirstMessage!({
      sourceId: 'src-1',
      sourceTitle: 'On Widgets',
      sourceBody: 'body',
    });
    expect(fm).toContain('On Widgets');
  });

  it('degrades gracefully when the source has no body', () => {
    const sys = def.buildSystemPrompt!({ sourceId: 'src-1', sourceTitle: 'Empty', sourceBody: '' });
    expect(sys).toContain('no readable body');
    const fm = def.buildFirstMessage!({ sourceId: 'src-1', sourceTitle: 'Empty', sourceBody: '' });
    expect(fm).toContain('no extracted body');
  });
});
