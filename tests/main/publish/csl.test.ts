import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  sourceTtlToCsl,
  excerptTtlToInfo,
  parseAuthorName,
  parseIssuedDate,
} from '../../../src/main/publish/csl/source-to-csl';
import { loadCitationAssets } from '../../../src/main/publish/csl';
import { resolvePlan, runExporter } from '../../../src/main/publish/pipeline';
import { noteHtmlExporter } from '../../../src/main/publish/exporters/note-html';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-csl-test-'));
}

// ── Source TTL → CSL-JSON ─────────────────────────────────────────────────

describe('sourceTtlToCsl (#247)', () => {
  it('maps thought:Article + common dc/bibo/schema fields', () => {
    const ttl = `this: a thought:Article ;
    dc:title "On the Growth of Things" ;
    dc:creator "Jane Smith" ;
    dc:creator "Bob Jones" ;
    dc:issued "2020-04-15"^^xsd:date ;
    schema:inContainer "Journal of Things" ;
    bibo:volume "12" ;
    bibo:issue "3" ;
    bibo:pages "45-67" ;
    bibo:doi "10.1234/foo.bar" ;
    bibo:uri <https://doi.org/10.1234/foo.bar> .`;
    const csl = sourceTtlToCsl(ttl, 'smith-2020');
    expect(csl.id).toBe('smith-2020');
    expect(csl.type).toBe('article-journal');
    expect(csl.title).toBe('On the Growth of Things');
    expect(csl.author).toEqual([
      { family: 'Smith', given: 'Jane' },
      { family: 'Jones', given: 'Bob' },
    ]);
    expect(csl.issued).toEqual({ 'date-parts': [[2020, 4, 15]] });
    expect(csl['container-title']).toBe('Journal of Things');
    expect(csl.volume).toBe('12');
    expect(csl.issue).toBe('3');
    expect(csl.page).toBe('45-67');
    expect(csl.DOI).toBe('10.1234/foo.bar');
    expect(csl.URL).toBe('https://doi.org/10.1234/foo.bar');
  });

  it('maps thought:Book to CSL type "book"', () => {
    const csl = sourceTtlToCsl(`this: a thought:Book ; dc:title "X" .`, 'x');
    expect(csl.type).toBe('book');
  });

  it('falls back to type "article" for thought:PDFSource and Preprint', () => {
    expect(sourceTtlToCsl('this: a thought:PDFSource .', 'x').type).toBe('article');
    expect(sourceTtlToCsl('this: a thought:Preprint .', 'x').type).toBe('article');
  });

  it('handles year-only and year-month dc:issued', () => {
    const year = sourceTtlToCsl(`this: a thought:Article ; dc:issued "1987"^^xsd:gYear .`, 'x');
    expect(year.issued).toEqual({ 'date-parts': [[1987]] });
    const ym = sourceTtlToCsl(`this: a thought:Article ; dc:issued "1987-04"^^xsd:gYearMonth .`, 'x');
    expect(ym.issued).toEqual({ 'date-parts': [[1987, 4]] });
  });
});

describe('parseAuthorName', () => {
  it('splits Western First Last into given + family', () => {
    expect(parseAuthorName('Jane Smith')).toEqual({ family: 'Smith', given: 'Jane' });
    expect(parseAuthorName('Martin L. King Jr.'))
      .toEqual({ family: 'King', given: 'Martin L.', suffix: 'Jr.' });
  });

  it('handles surname-first "Last, First"', () => {
    expect(parseAuthorName('Smith, Jane L.')).toEqual({ family: 'Smith', given: 'Jane L.' });
  });

  it('strips Jr./Sr./II suffixes (comma or no comma)', () => {
    // "Brooks, Jr." — ambiguous between "mononym with suffix" and
    // "surname with suffix". Treat as surname+suffix: APA will render
    // "Brooks, Jr." which is the intent for most real-world data.
    expect(parseAuthorName('Brooks, Jr.')).toEqual({ family: 'Brooks', suffix: 'Jr.' });
  });

  it('routes institutional names through `literal`', () => {
    expect(parseAuthorName('IEEE Computer Society')).toEqual({ literal: 'IEEE Computer Society' });
    expect(parseAuthorName('Example University')).toEqual({ literal: 'Example University' });
  });

  it('single-token names → literal (handles mononyms gracefully)', () => {
    expect(parseAuthorName('Aristotle')).toEqual({ literal: 'Aristotle' });
  });
});

describe('parseIssuedDate', () => {
  it('parses YYYY / YYYY-MM / YYYY-MM-DD', () => {
    expect(parseIssuedDate('2024')).toEqual({ 'date-parts': [[2024]] });
    expect(parseIssuedDate('2024-04')).toEqual({ 'date-parts': [[2024, 4]] });
    expect(parseIssuedDate('2024-04-15')).toEqual({ 'date-parts': [[2024, 4, 15]] });
  });

  it('returns undefined for garbage', () => {
    expect(parseIssuedDate('nope')).toBeUndefined();
    expect(parseIssuedDate('')).toBeUndefined();
  });
});

// ── Excerpt TTL parsing ──────────────────────────────────────────────────

describe('excerptTtlToInfo (#247)', () => {
  it('pulls source id + page locator when present', () => {
    const ttl = `this: a thought:Excerpt ;
    thought:fromSource sources:brooks-1986 ;
    thought:page 11 ;
    thought:citedText "essence" .`;
    expect(excerptTtlToInfo(ttl, 'ex-1')).toEqual({
      id: 'ex-1',
      sourceId: 'brooks-1986',
      locator: '11',
      citedText: 'essence',
    });
  });

  it('prefers pageRange over page when both are present', () => {
    const ttl = `this: a thought:Excerpt ;
    thought:fromSource sources:toulmin-1958 ;
    thought:pageRange "97-98" .`;
    const info = excerptTtlToInfo(ttl, 'ex-2');
    expect(info?.locator).toBe('97-98');
  });

  it('returns null when thought:fromSource is missing', () => {
    expect(excerptTtlToInfo('this: a thought:Excerpt ; thought:citedText "x" .', 'ex-3')).toBeNull();
  });
});

// ── End-to-end through the pipeline + renderer ───────────────────────────

describe('CSL integration through the export pipeline', () => {
  let root: string;

  beforeEach(async () => {
    root = mkTempProject();
    // Minimal project with one source + one excerpt referencing it.
    await fsp.mkdir(path.join(root, '.minerva/sources/smith-2020'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/sources/smith-2020/meta.ttl'),
      `this: a thought:Article ;
  dc:title "On the Growth of Things" ;
  dc:creator "Smith, Jane" ;
  dc:creator "Jones, Bob" ;
  dc:issued "2020-04-15"^^xsd:date ;
  schema:inContainer "Journal of Things" ;
  bibo:doi "10.1234/foo.bar" .\n`,
      'utf-8',
    );
    await fsp.mkdir(path.join(root, '.minerva/excerpts'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/excerpts/ex-42.ttl'),
      `this: a thought:Excerpt ;
  thought:fromSource sources:smith-2020 ;
  thought:page 42 ;
  thought:citedText "On the Growth of Things p.42" .\n`,
      'utf-8',
    );
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('loadCitationAssets walks the project\'s sources + excerpts', async () => {
    const assets = await loadCitationAssets(root);
    expect(assets.knownSourceIds).toEqual(['smith-2020']);
    expect(assets.items.get('smith-2020')?.title).toBe('On the Growth of Things');
    expect(assets.excerpts.get('ex-42')?.sourceId).toBe('smith-2020');
    expect(assets.excerpts.get('ex-42')?.locator).toBe('42');
  });

  it('APA in-text citation: "(Smith & Jones, 2020)"', async () => {
    const assets = await loadCitationAssets(root);
    const renderer = assets.createRenderer();
    const rendered = renderer.renderCitation('smith-2020');
    expect(rendered).toContain('Smith');
    expect(rendered).toContain('2020');
    // APA renders the author ampersand as `&amp;` — strict HTML escape.
    expect(rendered).toMatch(/Smith (&amp;|&#38;) Jones/);
  });

  it('APA bibliography: alphabetised References list', async () => {
    const assets = await loadCitationAssets(root);
    const renderer = assets.createRenderer();
    renderer.renderCitation('smith-2020');
    const { entries } = renderer.renderBibliography();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain('Smith, J., &#38; Jones, B. (2020)');
    expect(entries[0]).toContain('On the Growth of Things');
    expect(entries[0]).toContain('Journal of Things');
  });

  it('[[quote::id]] renders with the excerpt\'s page locator', async () => {
    const assets = await loadCitationAssets(root);
    const renderer = assets.createRenderer();
    const ex = assets.excerpts.get('ex-42')!;
    const rendered = renderer.renderCitation(ex.sourceId, ex.locator);
    expect(rendered).toContain('42');
  });

  it('missing source renders as [missing: id] rather than crashing', async () => {
    const assets = await loadCitationAssets(root);
    const renderer = assets.createRenderer();
    const rendered = renderer.renderCitation('never-existed');
    expect(rendered).toContain('[missing: never-existed]');
    expect(renderer.missing().has('never-existed')).toBe(true);
  });

  it('note-html exporter includes a rendered References section when a note cites', async () => {
    await fsp.writeFile(path.join(root, 'analysis.md'),
      '# Analysis\n\nAs [[cite::smith-2020]] showed, trees grow.\nAlso [[quote::ex-42]].\n',
      'utf-8',
    );
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'analysis.md' });
    const output = await runExporter(noteHtmlExporter, plan);
    const html = String(output.files[0].contents);

    // Two citations; both map to Smith, 2020 (the quote uses the same
    // source via thought:fromSource). References section appears.
    expect(html).toContain('<section class="references">');
    expect(html).toContain('<h2>References</h2>');
    expect(html).toContain('Smith, J., &#38; Jones, B.');
    // Inline mark on the first cite — not the raw wiki-link syntax.
    expect(html).not.toContain('[[cite::smith-2020]]');
    // Page locator on the quote mark somewhere in the rendered output.
    expect(html).toMatch(/42/);
  });

  it('notes without citations get no References section', async () => {
    await fsp.writeFile(path.join(root, 'no-cites.md'), '# Title\n\nJust prose.\n', 'utf-8');
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'no-cites.md' });
    const output = await runExporter(noteHtmlExporter, plan);
    const html = String(output.files[0].contents);
    expect(html).not.toContain('<section class="references">');
  });
});

// ── Bundled-style snapshots (#296) ───────────────────────────────────────
//
// One bibliography snapshot per non-APA bundled style against the same
// fixture project. APA is already covered by explicit assertions above;
// these guard the other four against accidental file swaps. If a style
// file is updated upstream and the rendering shifts, the snapshot diff
// makes the change visible — confirm intent, then `pnpm test -u`.

describe('bundled CSL styles render end-to-end (#296)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkTempProject();
    await fsp.mkdir(path.join(root, '.minerva/sources/smith-2020'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/sources/smith-2020/meta.ttl'),
      `this: a thought:Article ;
  dc:title "On the Growth of Things" ;
  dc:creator "Smith, Jane" ;
  dc:creator "Jones, Bob" ;
  dc:issued "2020-04-15"^^xsd:date ;
  schema:inContainer "Journal of Things" ;
  bibo:volume "12" ;
  bibo:issue "3" ;
  bibo:pages "45-67" ;
  bibo:doi "10.1234/foo.bar" .\n`,
      'utf-8',
    );
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it.each([
    'chicago-author-date',
    'chicago-notes-bibliography',
    'mla',
    'ieee',
    'vancouver',
  ])('%s: in-text citation + bibliography render and snapshot', async (styleId) => {
    const assets = await loadCitationAssets(root, { styleId });
    const renderer = assets.createRenderer();
    const inText = renderer.renderCitation('smith-2020');
    const { entries, isNote } = renderer.renderBibliography();

    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain('On the Growth of Things');
    expect({ inText, entry: entries[0], isNote }).toMatchSnapshot();
  });
});

// ── Consecutive-cite merging (#298) ──────────────────────────────────────
//
// `[[cite::a]] [[cite::b]]` should render as a single merged
// parenthetical — `(Foo 2020; Bar 2021)` in author-date styles — rather
// than two adjacent ones. The merge is gated on every id resolving so
// missing markers stay visible at their original positions.

describe('consecutive-cite merging (#298)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkTempProject();
    await fsp.mkdir(path.join(root, '.minerva/sources/foo-2020'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/sources/foo-2020/meta.ttl'),
      `this: a thought:Article ;
  dc:title "Foo Studies" ;
  dc:creator "Foo, Alice" ;
  dc:issued "2020"^^xsd:gYear .\n`,
      'utf-8',
    );
    await fsp.mkdir(path.join(root, '.minerva/sources/bar-2021'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/sources/bar-2021/meta.ttl'),
      `this: a thought:Article ;
  dc:title "Bar Considered" ;
  dc:creator "Bar, Bob" ;
  dc:issued "2021"^^xsd:gYear .\n`,
      'utf-8',
    );
    await fsp.mkdir(path.join(root, '.minerva/excerpts'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/excerpts/ex-foo-1.ttl'),
      `this: a thought:Excerpt ;
  thought:fromSource sources:foo-2020 ;
  thought:page 7 .\n`,
      'utf-8',
    );
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('renderCitationCluster merges two ids into one APA parenthetical', async () => {
    const assets = await loadCitationAssets(root);
    const renderer = assets.createRenderer();
    const rendered = renderer.renderCitationCluster([
      { id: 'foo-2020' },
      { id: 'bar-2021' },
    ]);
    // APA: "(Bar, 2021; Foo, 2020)" — alphabetised, single parenthetical.
    expect(rendered).toMatch(/^\([^)]*\)$/);
    expect(rendered).toContain('Bar');
    expect(rendered).toContain('Foo');
    expect(rendered).toContain(';');
    // Both ids are tracked as cited so they appear in the bibliography.
    expect(renderer.cited().has('foo-2020')).toBe(true);
    expect(renderer.cited().has('bar-2021')).toBe(true);
  });

  it('two adjacent [[cite::]] in markdown render as a single merged mark', async () => {
    await fsp.writeFile(path.join(root, 'merge.md'),
      '# Merge\n\nAs [[cite::foo-2020]] [[cite::bar-2021]] showed.\n',
      'utf-8',
    );
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'merge.md' });
    const output = await runExporter(noteHtmlExporter, plan);
    const html = String(output.files[0].contents);

    // Exactly one citation parenthetical, containing both names + a
    // semicolon separator. Two separate parens would show up as
    // ") (" somewhere in the rendered text.
    expect(html).not.toContain(') (');
    const inText = html.match(/\([^)]*Foo[^)]*Bar[^)]*\)|\([^)]*Bar[^)]*Foo[^)]*\)/);
    expect(inText).not.toBeNull();
    expect(inText![0]).toContain(';');
  });

  it('three consecutive cites separated by single spaces all merge', async () => {
    await fsp.mkdir(path.join(root, '.minerva/sources/baz-2022'), { recursive: true });
    await fsp.writeFile(path.join(root, '.minerva/sources/baz-2022/meta.ttl'),
      `this: a thought:Article ;
  dc:title "Baz Notes" ;
  dc:creator "Baz, Carol" ;
  dc:issued "2022"^^xsd:gYear .\n`,
      'utf-8',
    );
    await fsp.writeFile(path.join(root, 'three.md'),
      'See [[cite::foo-2020]] [[cite::bar-2021]] [[cite::baz-2022]].\n',
      'utf-8',
    );
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'three.md' });
    const output = await runExporter(noteHtmlExporter, plan);
    const html = String(output.files[0].contents);

    // Single paren containing all three names + two semicolons.
    const matches = html.match(/\([^)]+\)/g) ?? [];
    const citationParen = matches.find((p) => /Foo|Bar|Baz/.test(p));
    expect(citationParen).toBeDefined();
    expect(citationParen).toContain('Foo');
    expect(citationParen).toContain('Bar');
    expect(citationParen).toContain('Baz');
    // Two `; ` separators for three items in one cluster.
    expect((citationParen!.match(/;/g) ?? []).length).toBe(2);
  });

  it('newline-separated cites also merge (whitespace, not punctuation)', async () => {
    await fsp.writeFile(path.join(root, 'wrapped.md'),
      'Per [[cite::foo-2020]]\n[[cite::bar-2021]] this holds.\n',
      'utf-8',
    );
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'wrapped.md' });
    const output = await runExporter(noteHtmlExporter, plan);
    const html = String(output.files[0].contents);
    expect(html).not.toContain(') (');
    expect(html).toMatch(/\([^)]*(Foo|Bar)[^)]*;[^)]*\)/);
  });

  it('cite + quote with locator merges and the locator survives', async () => {
    await fsp.writeFile(path.join(root, 'mixed.md'),
      'Per [[cite::bar-2021]] [[quote::ex-foo-1]].\n',
      'utf-8',
    );
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'mixed.md' });
    const output = await runExporter(noteHtmlExporter, plan);
    const html = String(output.files[0].contents);
    // One paren, both names, the page locator from the excerpt.
    expect(html).not.toContain(') (');
    const paren = (html.match(/\([^)]*\)/g) ?? []).find((p) => /Foo|Bar/.test(p));
    expect(paren).toBeDefined();
    expect(paren).toContain('Foo');
    expect(paren).toContain('Bar');
    expect(paren).toContain('7');
  });

  it('non-whitespace separator (comma) prevents the merge', async () => {
    await fsp.writeFile(path.join(root, 'comma.md'),
      'Per [[cite::foo-2020]], [[cite::bar-2021]] showed.\n',
      'utf-8',
    );
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'comma.md' });
    const output = await runExporter(noteHtmlExporter, plan);
    const html = String(output.files[0].contents);
    // Two separate parentheticals, each with a single name.
    const parens = (html.match(/\([^)]+\)/g) ?? []).filter((p) => /Foo|Bar/.test(p));
    expect(parens.length).toBe(2);
    expect(parens.some((p) => p.includes('Foo') && !p.includes('Bar'))).toBe(true);
    expect(parens.some((p) => p.includes('Bar') && !p.includes('Foo'))).toBe(true);
  });

  it('missing id in a run falls back to per-item rendering so [missing: x] stays visible', async () => {
    await fsp.writeFile(path.join(root, 'missing.md'),
      'See [[cite::foo-2020]] [[cite::nope-2099]] [[cite::bar-2021]].\n',
      'utf-8',
    );
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'missing.md' });
    const output = await runExporter(noteHtmlExporter, plan);
    const html = String(output.files[0].contents);
    expect(html).toContain('[missing: nope-2099]');
    // Each present cite renders as its own parenthetical when a sibling
    // is missing — no merged cluster swallows them.
    const parens = (html.match(/\([^)]+\)/g) ?? []).filter((p) => /Foo|Bar/.test(p));
    expect(parens.some((p) => p.includes('Foo') && !p.includes('Bar'))).toBe(true);
    expect(parens.some((p) => p.includes('Bar') && !p.includes('Foo'))).toBe(true);
  });

  it('single [[cite::]] (no neighbour) still works exactly as before', async () => {
    await fsp.writeFile(path.join(root, 'single.md'),
      'Just [[cite::foo-2020]] alone.\n',
      'utf-8',
    );
    const plan = await resolvePlan(root, { kind: 'single-note', relativePath: 'single.md' });
    const output = await runExporter(noteHtmlExporter, plan);
    const html = String(output.files[0].contents);
    expect(html).toContain('Foo');
    expect(html).toContain('2020');
    expect(html).not.toContain('[[cite::foo-2020]]');
  });
});
