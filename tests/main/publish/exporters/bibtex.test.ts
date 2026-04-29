import { describe, it, expect } from 'vitest';
import { bibtexExporter } from '../../../../src/main/publish/exporters/bibtex';
import type { ExportPlan } from '../../../../src/main/publish/types';
import type { CslItem } from '../../../../src/main/publish/csl/source-to-csl';
import type { CitationAssets } from '../../../../src/main/publish/csl';

function fakeCitations(
  items: CslItem[],
  excerpts: Record<string, { sourceId: string; locator?: string }> = {},
): CitationAssets {
  const map = new Map(items.map((it) => [it.id, it]));
  return {
    style: '',
    locale: '',
    items: map,
    excerpts: new Map(Object.entries(excerpts)),
    knownSourceIds: [...map.keys()],
    // The bibtex exporter never calls createRenderer; stub regardless.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createRenderer: (() => ({})) as any,
  };
}

function planFromInputs(
  inputKind: ExportPlan['inputKind'],
  notes: { relativePath: string; content: string }[],
  citations: CitationAssets,
): ExportPlan {
  return {
    inputKind,
    inputs: notes.map((n) => ({
      relativePath: n.relativePath,
      kind: 'note',
      content: n.content,
      frontmatter: {},
      title: n.relativePath,
    })),
    excluded: [],
    linkPolicy: 'inline-title',
    assetPolicy: 'keep-relative',
    citations,
  };
}

describe('bibtexExporter (#115)', () => {
  it('project scope emits every loaded source, even uncited ones', async () => {
    const items: CslItem[] = [
      {
        id: 'a',
        type: 'article-journal',
        author: [{ family: 'Smith' }],
        issued: { 'date-parts': [[2020]] },
        title: 'Paper',
      },
      {
        id: 'b',
        type: 'book',
        author: [{ family: 'Jones' }],
        issued: { 'date-parts': [[2018]] },
        title: 'Book',
      },
    ];
    const plan = planFromInputs('project', [], fakeCitations(items));
    const out = await bibtexExporter.run(plan);
    const bib = String(out.files[0].contents);
    expect(bib).toContain('@article{smith-2020-paper');
    expect(bib).toContain('@book{jones-2018-book');
  });

  it('single-note scope only emits sources cited from that note', async () => {
    const items: CslItem[] = [
      {
        id: 'a',
        type: 'article-journal',
        author: [{ family: 'Smith' }],
        issued: { 'date-parts': [[2020]] },
        title: 'Paper',
      },
      {
        id: 'b',
        type: 'book',
        author: [{ family: 'Jones' }],
        issued: { 'date-parts': [[2018]] },
        title: 'Book',
      },
    ];
    const plan = planFromInputs(
      'single-note',
      [{ relativePath: 'n.md', content: 'See [[cite::a]] for details.\n' }],
      fakeCitations(items),
    );
    const out = await bibtexExporter.run(plan);
    const bib = String(out.files[0].contents);
    expect(bib).toContain('smith-2020-paper');
    expect(bib).not.toContain('jones-2018-book');
  });

  it('resolves [[quote::id]] through the excerpts map', async () => {
    const items: CslItem[] = [
      {
        id: 'a',
        type: 'article-journal',
        author: [{ family: 'Smith' }],
        issued: { 'date-parts': [[2020]] },
        title: 'Paper',
      },
    ];
    const plan = planFromInputs(
      'single-note',
      [{ relativePath: 'n.md', content: '[[quote::ex-1]]\n' }],
      fakeCitations(items, { 'ex-1': { sourceId: 'a' } }),
    );
    const out = await bibtexExporter.run(plan);
    expect(String(out.files[0].contents)).toContain('smith-2020-paper');
  });

  it('escapes LaTeX special characters in field values', async () => {
    const items: CslItem[] = [
      {
        id: 'a',
        type: 'article-journal',
        author: [{ family: 'Smith & Sons' }],
        issued: { 'date-parts': [[2020]] },
        title: 'A 100% Solution: Cost ~$50',
      },
    ];
    const plan = planFromInputs('project', [], fakeCitations(items));
    const out = await bibtexExporter.run(plan);
    const bib = String(out.files[0].contents);
    // & escaped, % escaped, $ escaped, ~ replaced.
    expect(bib).toContain('Smith \\& Sons');
    expect(bib).toContain('100\\%');
    expect(bib).toContain('\\$50');
    expect(bib).toContain('\\textasciitilde{}');
  });

  it('wraps the title in {} so BibTeX preserves casing', async () => {
    const items: CslItem[] = [
      {
        id: 'a',
        type: 'article-journal',
        title: 'NASA and IBM',
        author: [{ family: 'Smith' }],
        issued: { 'date-parts': [[2020]] },
      },
    ];
    const plan = planFromInputs('project', [], fakeCitations(items));
    const out = await bibtexExporter.run(plan);
    expect(String(out.files[0].contents)).toContain('title = {{NASA and IBM}}');
  });

  it('joins multiple authors with " and "', async () => {
    const items: CslItem[] = [
      {
        id: 'a',
        type: 'article-journal',
        title: 'Co-authored',
        author: [
          { family: 'Smith', given: 'Jane' },
          { family: 'Jones', given: 'Bob' },
        ],
        issued: { 'date-parts': [[2020]] },
      },
    ];
    const plan = planFromInputs('project', [], fakeCitations(items));
    const out = await bibtexExporter.run(plan);
    expect(String(out.files[0].contents)).toContain('author = {Smith, Jane and Jones, Bob}');
  });

  it('picks BibTeX entry types from CSL types', async () => {
    const items: CslItem[] = [
      { id: 'a', type: 'article-journal', title: 'A' },
      { id: 'b', type: 'book', title: 'B' },
      { id: 'c', type: 'paper-conference', title: 'C' },
      { id: 'd', type: 'webpage', title: 'D' },
    ];
    const plan = planFromInputs('project', [], fakeCitations(items));
    const out = await bibtexExporter.run(plan);
    const bib = String(out.files[0].contents);
    expect(bib).toMatch(/@article\{/);
    expect(bib).toMatch(/@book\{/);
    expect(bib).toMatch(/@inproceedings\{/);
    expect(bib).toMatch(/@misc\{/);
  });

  it('returns an empty file list when there is nothing to export', async () => {
    const plan = planFromInputs(
      'single-note',
      [{ relativePath: 'n.md', content: '# nothing cited\n' }],
      fakeCitations([]),
    );
    const out = await bibtexExporter.run(plan);
    expect(out.files).toHaveLength(0);
  });
});
