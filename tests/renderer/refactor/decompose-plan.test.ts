import { describe, it, expect } from 'vitest';
import { planDecompose } from '../../../src/renderer/lib/refactor/decompose-plan';
import type { DecomposeProposal } from '../../../src/shared/refactor/decompose';
import type { RefactorSettings } from '../../../src/renderer/lib/refactor/settings';
import { DEFAULT_REFACTOR_SETTINGS } from '../../../src/renderer/lib/refactor/settings';

function proposal(children: Array<{ title: string; content: string; rationale?: string }>): DecomposeProposal {
  return {
    parent: { content: 'Index narrative for the source.' },
    children: children.map((c) => ({ title: c.title, content: c.content, rationale: c.rationale ?? '' })),
  };
}

const today = '2026-04-20';
const settings: RefactorSettings = { ...DEFAULT_REFACTOR_SETTINGS };

describe('planDecompose (issue #178)', () => {
  it('writes one child per included proposal under <source-basename>/', () => {
    const plan = planDecompose({
      sourceRelativePath: 'notes/big-topic.md',
      sourceContent: '---\ntitle: Big Topic\n---\n\n# Big Topic\n\nOriginal body.\n',
      proposal: proposal([
        { title: 'First Angle', content: 'First child body.' },
        { title: 'Second Angle', content: 'Second child body.' },
      ]),
      include: [true, true],
      today,
      settings,
    });
    expect(plan.newNotes.map((n) => n.relativePath)).toEqual([
      'notes/big-topic/first-angle.md',
      'notes/big-topic/second-angle.md',
    ]);
    expect(plan.newNotes[0].content).toContain('---\ntitle: First Angle');
    expect(plan.newNotes[0].content).toContain('First child body.');
    expect(plan.newNotes[0].content).toContain('source: notes/big-topic.md');
  });

  it('skips children whose include flag is false', () => {
    const plan = planDecompose({
      sourceRelativePath: 'x.md',
      sourceContent: 'body',
      proposal: proposal([
        { title: 'Keep', content: 'a' },
        { title: 'Drop', content: 'b' },
        { title: 'Also Keep', content: 'c' },
      ]),
      include: [true, false, true],
      today,
      settings,
    });
    expect(plan.newNotes).toHaveLength(2);
    expect(plan.newNotes[0].relativePath).toContain('keep');
    expect(plan.newNotes[1].relativePath).toContain('also-keep');
  });

  it('returns no notes + unchanged source when zero children are included', () => {
    const source = '---\ntitle: X\n---\nbody';
    const plan = planDecompose({
      sourceRelativePath: 'x.md',
      sourceContent: source,
      proposal: proposal([{ title: 'A', content: 'a' }]),
      include: [false],
      today,
      settings,
    });
    expect(plan.newNotes).toEqual([]);
    expect(plan.updatedSourceContent).toBe(source);
  });

  it('rewrites the source body as parent narrative + Contents list of wiki-links', () => {
    const plan = planDecompose({
      sourceRelativePath: 'idx.md',
      sourceContent: '---\ntitle: Idx\n---\n\n# Idx\n\nOld body.\n',
      proposal: proposal([
        { title: 'Alpha', content: 'a' },
        { title: 'Beta', content: 'b' },
      ]),
      include: [true, true],
      today,
      settings,
    });
    expect(plan.updatedSourceContent).toContain('---\ntitle: Idx\n---');
    expect(plan.updatedSourceContent).toContain('Index narrative for the source.');
    expect(plan.updatedSourceContent).toContain('## Contents');
    expect(plan.updatedSourceContent).toContain('[[idx/alpha|Alpha]]');
    expect(plan.updatedSourceContent).toContain('[[idx/beta|Beta]]');
  });

  it('suffixes stems when two children share the same title', () => {
    const plan = planDecompose({
      sourceRelativePath: 'x.md',
      sourceContent: 'body',
      proposal: proposal([
        { title: 'Details', content: 'first details' },
        { title: 'Details', content: 'second details' },
      ]),
      include: [true, true],
      today,
      settings,
    });
    const paths = plan.newNotes.map((n) => n.relativePath);
    expect(paths).toEqual(['x/details.md', 'x/details-2.md']);
  });

  it('honors transcludeByDefault for the Contents links', () => {
    const plan = planDecompose({
      sourceRelativePath: 'x.md',
      sourceContent: 'body',
      proposal: proposal([{ title: 'Alpha', content: 'a' }]),
      include: [true],
      today,
      settings: { ...settings, transcludeByDefault: true },
    });
    expect(plan.updatedSourceContent).toContain('- ![[x/alpha]]');
  });

  it('applies heading normalization to child bodies', () => {
    const plan = planDecompose({
      sourceRelativePath: 'x.md',
      sourceContent: 'body',
      proposal: proposal([{ title: 'T', content: '### Deep heading\n\npara\n' }]),
      include: [true],
      today,
      settings: { ...settings, normalizeHeadings: true },
    });
    // `### Deep heading` -> `# Deep heading` after normalization (shallowest -> H1).
    expect(plan.newNotes[0].content).toContain('# Deep heading');
    expect(plan.newNotes[0].content).not.toContain('### Deep heading');
  });
});
