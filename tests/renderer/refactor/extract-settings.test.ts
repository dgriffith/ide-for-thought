import { describe, it, expect } from 'vitest';
import {
  planExtract,
  planSplitHere,
  normalizeHeadingLevels,
  resolveDestinationFolder,
  renderFilenamePrefix,
} from '../../../src/renderer/lib/refactor/extract';
import { planSplitByHeading } from '../../../src/renderer/lib/refactor/split-by-heading';
import type { RefactorSettings } from '../../../src/renderer/lib/refactor/settings';
import { DEFAULT_REFACTOR_SETTINGS } from '../../../src/renderer/lib/refactor/settings';

const today = '2026-04-19';
const now = new Date('2026-04-19T12:00:00');

function s(patch: Partial<RefactorSettings>): RefactorSettings {
  return { ...DEFAULT_REFACTOR_SETTINGS, ...patch };
}

describe('resolveDestinationFolder', () => {
  it('defaults to same folder as source', () => {
    expect(resolveDestinationFolder('notes/foo.md', DEFAULT_REFACTOR_SETTINGS)).toBe('notes');
  });

  it('returns root for destination=root', () => {
    expect(resolveDestinationFolder('notes/foo.md', s({ destination: 'root' }))).toBe('');
  });

  it('renders destination=custom with tokens', () => {
    const folder = resolveDestinationFolder(
      'notes/foo.md',
      s({ destination: 'custom', destinationTemplate: 'refactored/{{date:YYYY}}/{{date:MM}}' }),
      now,
    );
    expect(folder).toBe('refactored/2026/04');
  });

  it('trims trailing slashes from custom templates', () => {
    const folder = resolveDestinationFolder(
      'a.md',
      s({ destination: 'custom', destinationTemplate: 'refactored///' }),
      now,
    );
    expect(folder).toBe('refactored');
  });
});

describe('renderFilenamePrefix', () => {
  it('returns empty by default', () => {
    expect(renderFilenamePrefix('a.md', DEFAULT_REFACTOR_SETTINGS)).toBe('');
  });

  it('renders token prefix', () => {
    const pre = renderFilenamePrefix('a.md', s({ filenamePrefix: '{{date:YYYYMMDD}}-' }), now);
    expect(pre).toBe('20260419-');
  });
});

describe('normalizeHeadingLevels', () => {
  it('shifts headings so shallowest becomes H1 when enabled', () => {
    const body = '### Deep\n\nbody\n\n#### Deeper\n';
    const out = normalizeHeadingLevels(body, s({ normalizeHeadings: true }));
    expect(out).toContain('# Deep');
    expect(out).toContain('## Deeper');
  });

  it('no-ops when disabled', () => {
    const body = '### Deep\n';
    expect(normalizeHeadingLevels(body, DEFAULT_REFACTOR_SETTINGS)).toBe(body);
  });

  it('no-ops when shallowest is already H1', () => {
    const body = '# Top\n\n## Sub\n';
    expect(normalizeHeadingLevels(body, s({ normalizeHeadings: true }))).toBe(body);
  });

  it('ignores headings inside fenced code blocks', () => {
    const body = '### Real\n\n```\n# not real\n```\n';
    const out = normalizeHeadingLevels(body, s({ normalizeHeadings: true }));
    expect(out).toContain('# Real');
    expect(out).toContain('# not real'); // unchanged because it's in a fence
  });
});

describe('planExtract honors settings', () => {
  const src = '# Overview\n\nSome intro.\n\n### Deep\n\ndeep body\n\n### Other\n';
  const from = src.indexOf('### Deep');
  const to = src.indexOf('### Other');

  it('uses custom destination folder', () => {
    const plan = planExtract({
      sourceRelativePath: 'notes/overview.md',
      sourceContent: src,
      selection: { from, to },
      title: 'Deep',
      today,
      now,
      settings: s({ destination: 'custom', destinationTemplate: 'refactored/{{date:YYYY}}' }),
    });
    expect(plan.newNotePath).toBe('refactored/2026/deep.md');
  });

  it('prepends filename prefix', () => {
    const plan = planExtract({
      sourceRelativePath: 'a.md',
      sourceContent: src,
      selection: { from, to },
      title: 'Deep',
      today,
      now,
      settings: s({ filenamePrefix: '{{date:YYYYMMDD}}-' }),
    });
    expect(plan.newNotePath).toBe('20260419-deep.md');
  });

  it('normalizes heading levels on the extracted body', () => {
    const plan = planExtract({
      sourceRelativePath: 'a.md',
      sourceContent: src,
      selection: { from, to },
      title: 'Deep',
      today,
      now,
      settings: s({ normalizeHeadings: true }),
    });
    // `### Deep` was the shallowest in the selection; it shifts to `# Deep`.
    expect(plan.newNoteContent).toContain('# Deep\n');
    expect(plan.newNoteContent).not.toContain('### Deep');
  });
});

describe('planSplitHere honors settings', () => {
  it('applies destination + prefix + normalize together', () => {
    const src = '# Note\n\nIntro.\n\n#### Deep Tail\n\ntail body\n';
    const cursor = src.indexOf('#### Deep Tail');
    const plan = planSplitHere({
      sourceRelativePath: 'notes/big.md',
      sourceContent: src,
      cursor,
      title: 'Deep Tail',
      today,
      now,
      settings: s({
        destination: 'root',
        filenamePrefix: 'split-',
        normalizeHeadings: true,
      }),
    });
    expect(plan.newNotePath).toBe('split-deep-tail.md');
    expect(plan.newNoteContent).toContain('# Deep Tail');
  });
});

describe('planSplitByHeading honors settings', () => {
  it('uses custom destination as the subfolder parent', () => {
    const src = '## A\nfoo\n\n## B\nbar\n';
    const plan = planSplitByHeading({
      sourceRelativePath: 'notes/big.md',
      sourceContent: src,
      level: 2,
      today,
      now,
      settings: s({ destination: 'custom', destinationTemplate: 'archive/{{date:YYYY}}' }),
    });
    expect(plan.newNotes[0].relativePath).toBe('archive/2026/big/a.md');
  });

  it('prepends filename prefix to each fragment', () => {
    const src = '## A\nfoo\n\n## B\nbar\n';
    const plan = planSplitByHeading({
      sourceRelativePath: 'a.md',
      sourceContent: src,
      level: 2,
      today,
      now,
      settings: s({ filenamePrefix: 'frag-' }),
    });
    expect(plan.newNotes.map((n) => n.relativePath)).toEqual([
      'a/frag-a.md',
      'a/frag-b.md',
    ]);
  });

  it('normalizes headings in each fragment', () => {
    const src = '## A\n\n### Nested\n\nbody\n';
    const plan = planSplitByHeading({
      sourceRelativePath: 'a.md',
      sourceContent: src,
      level: 2,
      today,
      now,
      settings: s({ normalizeHeadings: true }),
    });
    // Fragment's shallowest was H2, shifts to H1.
    expect(plan.newNotes[0].content).toContain('# A');
    expect(plan.newNotes[0].content).toContain('## Nested');
  });
});
