/**
 * Upstream subject tags (#473) — adapter extraction + the indexer
 * translation that turns `minerva:upstreamTag` literals into real
 * `minerva:hasTag` edges on the source.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import { slugForTag, buildUpstreamTags } from '../../../src/main/sources/api-adapters/upstream-tags';
import { parseCrossrefWork } from '../../../src/main/sources/api-adapters/crossref';
import { parseArxivAtom } from '../../../src/main/sources/api-adapters/arxiv';
import { parseMeshTerms } from '../../../src/main/sources/api-adapters/pubmed';
import {
  initGraph,
  indexSource,
  sourcesByTag,
} from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';
import { removeUpstreamTagLines, stripUpstreamTags } from '../../../src/main/sources/strip-upstream-tags';
import { buildMetaTtl } from '../../../src/main/sources/ingest-identifier';

describe('slugForTag', () => {
  it('lowercases and joins runs of non-alphanum with a single hyphen', () => {
    expect(slugForTag('Computer Science Applications')).toBe('computer-science-applications');
    expect(slugForTag('cs.LG')).toBe('cs-lg');
    expect(slugForTag('Diabetes Mellitus, Type 2')).toBe('diabetes-mellitus-type-2');
  });
  it('trims leading and trailing hyphens', () => {
    expect(slugForTag('—Genetics—')).toBe('genetics');
  });
  it('returns empty string for inputs with no alphanumeric content', () => {
    expect(slugForTag('   ')).toBe('');
    expect(slugForTag('—')).toBe('');
  });
});

describe('buildUpstreamTags', () => {
  it('prefixes each entry with the source namespace', () => {
    expect(buildUpstreamTags('crossref', ['Sociology', 'Computer Science Applications'])).toEqual([
      'crossref/sociology',
      'crossref/computer-science-applications',
    ]);
  });
  it('dedupes within a single call', () => {
    expect(buildUpstreamTags('mesh', ['Genetics', 'Genetics', 'Computational Biology'])).toEqual([
      'mesh/genetics',
      'mesh/computational-biology',
    ]);
  });
  it('drops null / undefined / empty entries', () => {
    expect(buildUpstreamTags('arxiv', ['cs.LG', null, '', undefined, '   '])).toEqual(['arxiv/cs-lg']);
  });
});

describe('CrossRef adapter keywords', () => {
  it('extracts the subject array into crossref-prefixed tags', () => {
    const result = parseCrossrefWork({
      title: ['On Foo'],
      subject: ['Computer Science Applications', 'Sociology'],
    }, '10.1/foo');
    expect(result.keywords).toEqual([
      'crossref/computer-science-applications',
      'crossref/sociology',
    ]);
  });
  it('returns empty keywords when subject is absent', () => {
    const result = parseCrossrefWork({ title: ['Bar'] }, '10.1/bar');
    expect(result.keywords).toEqual([]);
  });
});

describe('arXiv adapter keywords', () => {
  const ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:arxiv="http://arxiv.org/schemas/atom">
  <entry>
    <title>Test paper</title>
    <summary>An abstract.</summary>
    <published>2024-01-01T00:00:00Z</published>
    <author><name>Author A</name></author>
    <arxiv:primary_category term="cs.LG"/>
    <category term="cs.LG"/>
    <category term="cs.AI"/>
    <category term="stat.ML"/>
  </entry>
</feed>`;
  it('collects every <category term="..."> into arxiv-prefixed tags', () => {
    const result = parseArxivAtom(ATOM, '2401.00001');
    expect(result.keywords.sort()).toEqual([
      'arxiv/cs-ai',
      'arxiv/cs-lg',
      'arxiv/stat-ml',
    ]);
    // The legacy `category` field still carries the primary term.
    expect(result.category).toBe('cs.LG');
  });
});

describe('parseMeshTerms', () => {
  it('extracts MeshHeading > DescriptorName text', () => {
    const xml = `<?xml version="1.0"?>
<PubmedArticleSet>
  <PubmedArticle>
    <MedlineCitation>
      <MeshHeadingList>
        <MeshHeading>
          <DescriptorName UI="D005819">Genetics</DescriptorName>
        </MeshHeading>
        <MeshHeading>
          <DescriptorName UI="D000465">Algorithms</DescriptorName>
          <QualifierName>methods</QualifierName>
        </MeshHeading>
      </MeshHeadingList>
    </MedlineCitation>
  </PubmedArticle>
</PubmedArticleSet>`;
    expect(parseMeshTerms(xml)).toEqual(['Genetics', 'Algorithms']);
  });
  it('returns an empty list when no MeshHeadingList is present', () => {
    expect(parseMeshTerms('<empty/>')).toEqual([]);
  });
});

describe('indexSource → hasTag edges from upstreamTag literals (#473)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-upstream-tags-'));
    ctx = projectContext(root);
    await initGraph(ctx);
  });
  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('writes minerva:hasTag edges for each upstreamTag literal', () => {
    const ttl = `this: a thought:Article ;
    dc:title "Test" ;
    minerva:upstreamTag "crossref/sociology" ;
    minerva:upstreamTag "crossref/computer-science-applications" ;
    thought:accessedAt "2026-05-01T00:00:00Z"^^xsd:dateTime .
`;
    indexSource(ctx, 'doi-test', ttl);
    expect(sourcesByTag(ctx, 'crossref/sociology').map((s) => s.sourceId)).toEqual(['doi-test']);
    expect(sourcesByTag(ctx, 'crossref/computer-science-applications').map((s) => s.sourceId)).toEqual(['doi-test']);
  });

  it('end-to-end: buildMetaTtl + indexSource yields tag panel rows', () => {
    const meta = buildMetaTtl({
      subtype: 'Article',
      title: 'X',
      creators: [],
      abstract: null,
      issued: null,
      publisher: null,
      containerTitle: null,
      doi: '10.1/x',
      isbn: null,
      arxiv: null,
      pubmed: null,
      uri: 'https://doi.org/10.1/x',
      pdfUrl: null,
      category: null,
      keywords: ['crossref/sociology', 'arxiv/cs-lg'],
    });
    indexSource(ctx, 'x', meta);
    expect(sourcesByTag(ctx, 'crossref/sociology').map((s) => s.sourceId)).toEqual(['x']);
    expect(sourcesByTag(ctx, 'arxiv/cs-lg').map((s) => s.sourceId)).toEqual(['x']);
  });
});

describe('strip upstream tags (#473)', () => {
  let root: string;
  let ctx: ProjectContext;
  const sourceId = 'doi-test';

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-strip-upstream-'));
    ctx = projectContext(root);
    await initGraph(ctx);
    const dir = path.join(root, '.minerva', 'sources', sourceId);
    fs.mkdirSync(dir, { recursive: true });
    const ttl = `this: a thought:Article ;
    dc:title "Test" ;
    minerva:upstreamTag "crossref/sociology" ;
    minerva:upstreamTag "crossref/computer-science-applications" ;
    thought:accessedAt "2026-05-01T00:00:00Z"^^xsd:dateTime .
`;
    fs.writeFileSync(path.join(dir, 'meta.ttl'), ttl);
    indexSource(ctx, sourceId, ttl);
  });
  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('removes every upstreamTag line and dedupes hasTag edges from the graph', async () => {
    const result = await stripUpstreamTags(root, sourceId);
    expect(result.removed).toBe(2);

    const ttl = fs.readFileSync(path.join(root, '.minerva', 'sources', sourceId, 'meta.ttl'), 'utf-8');
    expect(ttl).not.toContain('minerva:upstreamTag');

    expect(sourcesByTag(ctx, 'crossref/sociology')).toEqual([]);
    expect(sourcesByTag(ctx, 'crossref/computer-science-applications')).toEqual([]);
  });

  it('leaves other predicates alone', async () => {
    await stripUpstreamTags(root, sourceId);
    const ttl = fs.readFileSync(path.join(root, '.minerva', 'sources', sourceId, 'meta.ttl'), 'utf-8');
    expect(ttl).toContain('dc:title "Test"');
    expect(ttl).toContain('thought:accessedAt');
  });

  it('is a no-op on a meta.ttl with no upstream tags', () => {
    const ttl = `this: a thought:Article ;
    dc:title "x" ;
    thought:accessedAt "2026-05-01T00:00:00Z"^^xsd:dateTime .
`;
    expect(removeUpstreamTagLines(ttl)).toEqual({ ttl, removed: 0 });
  });
});
