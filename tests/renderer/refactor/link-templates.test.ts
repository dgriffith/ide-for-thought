import { describe, it, expect } from 'vitest';
import { planExtract, planSplitHere } from '../../../src/renderer/lib/refactor/extract';
import { planSplitByHeading } from '../../../src/renderer/lib/refactor/split-by-heading';
import type { RefactorSettings } from '../../../src/renderer/lib/refactor/settings';
import { DEFAULT_REFACTOR_SETTINGS } from '../../../src/renderer/lib/refactor/settings';

const today = '2026-04-19';
const now = new Date('2026-04-19T12:00:00');

function s(patch: Partial<RefactorSettings>): RefactorSettings {
  return { ...DEFAULT_REFACTOR_SETTINGS, ...patch };
}

describe('transcludeByDefault', () => {
  it('uses ![[…]] for extract when enabled', () => {
    const src = 'before [pulled] after.';
    const from = src.indexOf('[pulled]');
    const to = from + '[pulled]'.length;
    const plan = planExtract({
      sourceRelativePath: 'a.md',
      sourceContent: src,
      selection: { from, to },
      title: 'Pulled',
      today,
      now,
      settings: s({ transcludeByDefault: true }),
    });
    expect(plan.updatedSourceContent).toContain('![[pulled]]');
    // No un-prefixed `[[pulled]]` — the preceding char must be `!`.
    expect(plan.updatedSourceContent).not.toMatch(/(^|[^!])\[\[pulled\]\]/);
  });

  it('uses ![[…]] for split-here when enabled', () => {
    const src = '# Note\n\nIntro.\n\n## Tail\n\nTail body.\n';
    const plan = planSplitHere({
      sourceRelativePath: 'notes/big.md',
      sourceContent: src,
      cursor: src.indexOf('## Tail'),
      title: 'Tail',
      today,
      now,
      settings: s({ transcludeByDefault: true }),
    });
    expect(plan.updatedSourceContent).toContain('![[notes/tail]]');
  });

  it('uses `- ![[…]]` for split-by-heading Contents entries when enabled', () => {
    const src = '## A\nfoo\n\n## B\nbar\n';
    const plan = planSplitByHeading({
      sourceRelativePath: 'a.md',
      sourceContent: src,
      level: 2,
      today,
      now,
      settings: s({ transcludeByDefault: true }),
    });
    expect(plan.updatedSourceContent).toContain('- ![[a/a]]');
    expect(plan.updatedSourceContent).toContain('- ![[a/b]]');
  });
});

describe('linkTemplate', () => {
  it('overrides the default link-back for extract', () => {
    const src = 'before [pulled] after.';
    const from = src.indexOf('[pulled]');
    const to = from + '[pulled]'.length;
    const plan = planExtract({
      sourceRelativePath: 'notes/a.md',
      sourceContent: src,
      selection: { from, to },
      title: 'Pulled Out',
      today,
      now,
      settings: s({ linkTemplate: '[[{{new_note_title}}]] — see also {{source}}' }),
    });
    expect(plan.updatedSourceContent).toContain('[[Pulled Out]] — see also notes/a.md');
    // The explicit template overrides the transclude setting entirely:
    expect(plan.updatedSourceContent).not.toContain('![[');
  });

  it('wins over transcludeByDefault when both are set', () => {
    const src = 'x [pulled] y';
    const from = src.indexOf('[pulled]');
    const to = from + '[pulled]'.length;
    const plan = planExtract({
      sourceRelativePath: 'a.md',
      sourceContent: src,
      selection: { from, to },
      title: 'Pulled',
      today,
      now,
      settings: s({ transcludeByDefault: true, linkTemplate: 'LINK:{{new_note_title}}' }),
    });
    expect(plan.updatedSourceContent).toBe('x LINK:Pulled y');
  });

  it('overrides every Contents entry for split-by-heading', () => {
    const src = '## A\nfoo\n\n## B\nbar\n';
    const plan = planSplitByHeading({
      sourceRelativePath: 'a.md',
      sourceContent: src,
      level: 2,
      today,
      now,
      settings: s({ linkTemplate: '* {{new_note_title}}' }),
    });
    expect(plan.updatedSourceContent).toContain('* A');
    expect(plan.updatedSourceContent).toContain('* B');
    // No default bulleted link form remains:
    expect(plan.updatedSourceContent).not.toContain('- [[a/a|A]]');
  });
});

describe('refactoredNoteTemplate', () => {
  it('wraps the extracted body with {{new_note_content}} token', () => {
    const src = 'before [core content] after.';
    const from = src.indexOf('[core content]');
    const to = from + '[core content]'.length;
    const plan = planExtract({
      sourceRelativePath: 'a.md',
      sourceContent: src,
      selection: { from, to },
      title: 'Core',
      today,
      now,
      settings: s({
        refactoredNoteTemplate: '> Extracted from [[{{source}}]] on {{date}}\n\n{{new_note_content}}',
      }),
    });
    expect(plan.newNoteContent).toContain('> Extracted from [[a.md]] on 2026-04-19');
    expect(plan.newNoteContent).toContain('[core content]');
  });

  it('applies to split-by-heading fragments', () => {
    const src = '## A\n\nalpha body\n\n## B\n\nbravo body\n';
    const plan = planSplitByHeading({
      sourceRelativePath: 'notes/deck.md',
      sourceContent: src,
      level: 2,
      today,
      now,
      settings: s({
        refactoredNoteTemplate: 'FROM {{title}}: {{new_note_content}}',
      }),
    });
    // With no H1 in source, {{title}} falls back to the filename stem.
    expect(plan.newNotes[0].content).toContain('FROM deck: ');
    expect(plan.newNotes[0].content).toContain('alpha body');
    expect(plan.newNotes[1].content).toContain('FROM deck: ');
    expect(plan.newNotes[1].content).toContain('bravo body');
  });

  it('uses H1 as {{title}} when present', () => {
    const src = '# My Source Note\n\nprelude\n\n## A\n\na body\n';
    const plan = planSplitByHeading({
      sourceRelativePath: 'deep/note.md',
      sourceContent: src,
      level: 2,
      today,
      now,
      settings: s({
        refactoredNoteTemplate: 'parent: {{title}}\n\n{{new_note_content}}',
      }),
    });
    expect(plan.newNotes[0].content).toContain('parent: My Source Note');
  });
});
