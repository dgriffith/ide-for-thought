import { describe, it, expect } from 'vitest';
import { pandocExporter } from '../../../../src/main/publish/exporters/pandoc';
import type { ExportPlan } from '../../../../src/main/publish/types';
import type { CslItem } from '../../../../src/main/publish/csl/source-to-csl';
import type { CitationAssets } from '../../../../src/main/publish/csl';

function fakeCitations(
  items: CslItem[],
  excerpts: Record<string, { sourceId: string; locator?: string }> = {},
): CitationAssets {
  return {
    style: '',
    locale: '',
    items: new Map(items.map((it) => [it.id, it])),
    excerpts: new Map(Object.entries(excerpts)),
    knownSourceIds: items.map((it) => it.id),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createRenderer: (() => ({})) as any,
  };
}

function singleNotePlan(content: string, citations: CitationAssets): ExportPlan {
  return {
    inputKind: 'single-note',
    inputs: [
      {
        relativePath: 'analysis.md',
        kind: 'note',
        content,
        frontmatter: {},
        title: 'Analysis',
      },
    ],
    excluded: [],
    linkPolicy: 'inline-title',
    assetPolicy: 'keep-relative',
    citations,
  };
}

const SAMPLE_ITEM: CslItem = {
  id: 'doi-1',
  type: 'article-journal',
  author: [{ family: 'Smith', given: 'Jane' }],
  issued: { 'date-parts': [[2020]] },
  title: 'A Paper',
};

describe('pandocExporter (#114)', () => {
  it('rewrites [[cite::id]] to [@citekey] in the note body', async () => {
    const plan = singleNotePlan(
      'See [[cite::doi-1]] for details.\n',
      fakeCitations([SAMPLE_ITEM]),
    );
    const out = await pandocExporter.run(plan);
    const md = out.files.find((f) => f.path.endsWith('.md') && f.path !== 'README.md');
    expect(md).toBeTruthy();
    expect(String(md!.contents)).toContain('[@smith-2020-paper]');
    expect(String(md!.contents)).not.toContain('[[cite::');
  });

  it('rewrites [[quote::ex]] with a numeric page locator', async () => {
    const plan = singleNotePlan(
      '"It is known" [[quote::ex-1]].\n',
      fakeCitations([SAMPLE_ITEM], { 'ex-1': { sourceId: 'doi-1', locator: '12' } }),
    );
    const out = await pandocExporter.run(plan);
    const md = String(out.files.find((f) => f.path.endsWith('analysis.md'))!.contents);
    expect(md).toContain('[@smith-2020-paper, p. 12]');
  });

  it('rewrites a page-range locator with pp.', async () => {
    const plan = singleNotePlan(
      '[[quote::ex-1]]\n',
      fakeCitations([SAMPLE_ITEM], { 'ex-1': { sourceId: 'doi-1', locator: '12-15' } }),
    );
    const out = await pandocExporter.run(plan);
    const md = String(out.files.find((f) => f.path.endsWith('analysis.md'))!.contents);
    expect(md).toContain('[@smith-2020-paper, pp. 12-15]');
  });

  it('emits bibliography.json with citekey-keyed CSL items', async () => {
    const plan = singleNotePlan(
      '[[cite::doi-1]]\n',
      fakeCitations([SAMPLE_ITEM]),
    );
    const out = await pandocExporter.run(plan);
    const json = out.files.find((f) => f.path === 'bibliography.json');
    expect(json).toBeTruthy();
    const parsed = JSON.parse(String(json!.contents)) as CslItem[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('smith-2020-paper');
    expect(parsed[0].title).toBe('A Paper');
  });

  it('only includes cited items in the bibliography', async () => {
    const items: CslItem[] = [
      SAMPLE_ITEM,
      {
        id: 'doi-2',
        type: 'book',
        title: 'Uncited Book',
        author: [{ family: 'Jones' }],
        issued: { 'date-parts': [[2018]] },
      },
    ];
    const plan = singleNotePlan('[[cite::doi-1]]\n', fakeCitations(items));
    const out = await pandocExporter.run(plan);
    const parsed = JSON.parse(
      String(out.files.find((f) => f.path === 'bibliography.json')!.contents),
    ) as CslItem[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe('smith-2020-paper');
  });

  it('emits a README with example pandoc commands', async () => {
    const plan = singleNotePlan('[[cite::doi-1]]\n', fakeCitations([SAMPLE_ITEM]));
    const out = await pandocExporter.run(plan);
    const readme = out.files.find((f) => f.path === 'README.md');
    expect(readme).toBeTruthy();
    const txt = String(readme!.contents);
    expect(txt).toContain('pandoc analysis.md');
    expect(txt).toContain('--bibliography=bibliography.json');
    expect(txt).toContain('--citeproc');
  });

  it('leaves unresolved citation ids as the original [[cite::]] form', async () => {
    const plan = singleNotePlan(
      '[[cite::missing]] and [[cite::doi-1]].\n',
      fakeCitations([SAMPLE_ITEM]),
    );
    const out = await pandocExporter.run(plan);
    const md = String(out.files.find((f) => f.path === 'analysis.md')!.contents);
    expect(md).toContain('[[cite::missing]]');
    expect(md).toContain('[@smith-2020-paper]');
  });
});
