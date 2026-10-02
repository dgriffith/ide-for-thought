/**
 * `wikiLinkTargets` (#2518): everything a wiki-link resolves against, for
 * exports — every indexed note (any note extension) and the alias map.
 */
import { describe, it, expect } from 'vitest';
import { indexNote, wikiLinkTargets } from '../../../src/main/graph/index';
import { projectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

describe('wikiLinkTargets', () => {
  const project = useGraphProject('minerva-wiki-link-targets-');

  it('lists every indexed note, any note extension, with the lowercased alias map', async () => {
    await indexNote(project.ctx, 'trip/places/Kampa Museum.md', '---\naliases: [Kampa]\n---\n# Kampa Museum\n');
    await indexNote(project.ctx, 'data/budget.csv', 'a,b\n1,2\n');
    const t = wikiLinkTargets(project.ctx)!;
    expect(t.paths).toEqual(expect.arrayContaining(['trip/places/Kampa Museum.md', 'data/budget.csv']));
    expect(t.aliases.kampa).toBe('trip/places/Kampa Museum.md');
  });

  it('is null for a project with nothing indexed, without allocating a slot for it (#2240)', () => {
    const never = projectContext('/nowhere/never-opened');
    expect(wikiLinkTargets(never)).toBeNull();
    expect(wikiLinkTargets(never)).toBeNull();
  });
});
