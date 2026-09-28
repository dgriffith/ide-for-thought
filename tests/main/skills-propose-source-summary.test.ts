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

  it('threads the source into the user turn (#2438) and instructs the file tool', () => {
    const ctx = { sourceId: 'src-xyz', sourceTitle: 'On Widgets', sourceBody: 'widget-body-zzz' };
    const sys = def.buildSystemPrompt!(ctx);
    for (const text of ['widget-body-zzz', 'On Widgets', 'src-xyz']) expect(sys).not.toContain(text);
    const material = def.buildUserContext!(ctx);
    expect(material).toContain('<thoughtbase-content kind="source" id="src-xyz">\nwidget-body-zzz\n</thoughtbase-content>');
    expect(material).toContain('<thoughtbase-content kind="source-title">On Widgets</thoughtbase-content>');
    // sourceId, passed through to the tool call, arrives as delimited material.
    expect(material).toContain('Source id: <thoughtbase-content kind="source-id">src-xyz</thoughtbase-content>');
    expect(sys).toContain('propose_source_properties');
    expect(sys).toContain('## Process');
  });

  it('first message asks for the summary without quoting the (attacker-chosen) title', () => {
    const fm = def.buildFirstMessage!({
      sourceId: 'src-1',
      sourceTitle: 'On Widgets',
      sourceBody: 'body',
    });
    expect(fm).toMatch(/^Summarize this source/);
    expect(fm).not.toContain('On Widgets');
  });

  it('degrades gracefully when the source has no body', () => {
    const sys = def.buildSystemPrompt!({ sourceId: 'src-1', sourceTitle: 'Empty', sourceBody: '' });
    expect(sys).toContain('no readable body');
    const fm = def.buildFirstMessage!({ sourceId: 'src-1', sourceTitle: 'Empty', sourceBody: '' });
    expect(fm).toContain('no extracted body');
  });
});
