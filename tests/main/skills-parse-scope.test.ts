/**
 * `scope:` frontmatter parsing (#103) and source-context recognition.
 */
import { describe, it, expect } from 'vitest';
import { parseSkill } from '../../src/main/skills/parse';

function mk(extra: string): string {
  return `---
name: Test Source Skill
description: A source skill
menu: Research
outputMode: openConversation
${extra}
---
Body referencing {{#if source}}{{source.title}}{{/if}}.`;
}

describe('parseSkill — scope', () => {
  it('defaults scope to note when omitted', () => {
    const { skill, errors } = parseSkill(mk('context: [fullNote]'), 'stock', 'stock/x.md');
    expect(errors).toEqual([]);
    expect(skill!.scope).toBe('note');
  });

  it('parses scope: source', () => {
    const { skill, errors } = parseSkill(
      mk('scope: source\ncontext: [sourceMetadata, sourceBody]'),
      'stock',
      'stock/x.md',
    );
    expect(errors).toEqual([]);
    expect(skill!.scope).toBe('source');
    expect(skill!.context).toEqual(['sourceMetadata', 'sourceBody']);
  });

  it('rejects an invalid scope', () => {
    const { errors } = parseSkill(mk('scope: planet\ncontext: [fullNote]'), 'stock', 'stock/x.md');
    expect(errors.some((e) => e.includes('scope'))).toBe(true);
  });

  it('accepts source context requirements and {{source.*}} template vars', () => {
    const { skill, errors } = parseSkill(
      `---
name: S
description: d
menu: Research
scope: source
outputMode: openConversation
context: [sourceBody]
---
{{source.id}} / {{source.title}} / {{source.body}}`,
      'stock',
      'stock/s.md',
    );
    expect(errors).toEqual([]); // no "unknown variable" from the template validator
    expect(skill).toBeDefined();
  });
});
