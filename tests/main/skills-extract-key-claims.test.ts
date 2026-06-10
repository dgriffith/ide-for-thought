/**
 * Extract Key Claims (#104) — source-scoped claim-mining skill. Pins that it
 * loads with `scope: source`, gathers source context, and instructs the model
 * to file via `propose_claims`.
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
  const skill = cat.skills.find((s) => s.id === 'research.extract-key-claims');
  expect(skill).toBeDefined();
  def = compileSkill(skill!);
});

describe('extract-key-claims skill', () => {
  it('is a source-scoped Research conversation skill', () => {
    expect(def.scope).toBe('source');
    expect(def.category).toBe('research');
    expect(def.group).toBe('Mining');
    expect(def.outputMode).toBe('openConversation');
  });

  it('requests source metadata + body context', () => {
    expect(def.context).toContain('sourceMetadata');
    expect(def.context).toContain('sourceBody');
  });

  it('threads the body into the system prompt and instructs propose_claims', () => {
    const sys = def.buildSystemPrompt!({
      sourceId: 'src-1',
      sourceTitle: 'A Paper',
      sourceBody: 'body-text-zzz',
    });
    expect(sys).toContain('body-text-zzz');
    expect(sys).toContain('A Paper');
    expect(sys).toContain('src-1'); // sourceId passed to the tool call
    expect(sys).toContain('propose_claims');
    expect(sys).toContain('verbatim');
  });

  it('degrades gracefully when the source has no body', () => {
    const sys = def.buildSystemPrompt!({ sourceId: 's', sourceTitle: 'Empty', sourceBody: '' });
    expect(sys).toContain('no readable body');
  });
});
