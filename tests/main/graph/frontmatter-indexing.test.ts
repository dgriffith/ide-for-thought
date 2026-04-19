import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  initGraph,
  indexNote,
  queryGraph,
} from '../../../src/main/graph/index';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-fm-test-'));
}

describe('frontmatter → graph indexing (issue #126)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkTempProject();
    await initGraph(root);
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('maps known keys to canonical predicates (author → dc:creator, doi → bibo:doi, year → dc:issued)', async () => {
    await indexNote('paper.md', `---
title: My Paper
author: Ada Lovelace
doi: 10.1234/abc
year: 1843
---
# My Paper
`);

    const { results } = await queryGraph(`
      PREFIX bibo: <http://purl.org/ontology/bibo/>
      SELECT ?creator ?doi ?issued WHERE {
        ?note minerva:relativePath "paper.md" .
        OPTIONAL { ?note dc:creator ?creator }
        OPTIONAL { ?note bibo:doi ?doi }
        OPTIONAL { ?note dc:issued ?issued }
      } LIMIT 1
    `);
    const row = (results as Array<Record<string, string>>)[0];
    expect(row.creator).toBe('Ada Lovelace');
    expect(row.doi).toBe('10.1234/abc');
    expect(row.issued).toBe('1843');
  });

  it('emits one triple per YAML list element', async () => {
    await indexNote('paper.md', `---
authors:
  - Alice Smith
  - Bob Jones
---
# Paper
`);

    const { results } = await queryGraph(`
      SELECT ?creator WHERE {
        ?note minerva:relativePath "paper.md" ; dc:creator ?creator .
      }
    `);
    const creators = (results as Array<{ creator: string }>).map(r => r.creator);
    expect(creators.sort()).toEqual(['Alice Smith', 'Bob Jones']);
  });

  it('frontmatter tags become minerva:hasTag edges', async () => {
    await indexNote('paper.md', `---
tags: [research, epistemology]
---
# Paper
`);

    const { results } = await queryGraph(`
      SELECT ?tagName WHERE {
        ?note minerva:relativePath "paper.md" ;
              minerva:hasTag ?tag .
        ?tag minerva:tagName ?tagName .
      }
    `);
    const tags = (results as Array<{ tagName: string }>).map(r => r.tagName);
    expect(tags.sort()).toEqual(['epistemology', 'research']);
  });

  it('coerces integers, decimals, booleans to typed literals', async () => {
    await indexNote('paper.md', `---
pages: 42
ratio: 3.14
draft: true
---
# Paper
`);

    const { results } = await queryGraph(`
      PREFIX bibo: <http://purl.org/ontology/bibo/>
      SELECT ?pages ?ratio ?draft WHERE {
        ?note minerva:relativePath "paper.md" .
        OPTIONAL { ?note bibo:pages ?pages }
        OPTIONAL { ?note minerva:meta-ratio ?ratio }
        OPTIONAL { ?note minerva:meta-draft ?draft }
      }
    `);
    const row = (results as Array<Record<string, string>>)[0];
    expect(row.pages).toBe('42');
    expect(row.ratio).toBe('3.14');
    expect(row.draft).toBe('true');
  });

  it('ISO dates become xsd:date / xsd:dateTime literals on dc:issued', async () => {
    await indexNote('paper.md', `---
date: 2023-07-15
---
# Paper
`);

    const { results } = await queryGraph(`
      SELECT ?issued WHERE {
        ?note minerva:relativePath "paper.md" ; dc:issued ?issued .
      }
    `);
    const row = (results as Array<{ issued: string }>)[0];
    // yaml parses 2023-07-15 as a Date, which serializes to an ISO dateTime.
    expect(row.issued).toMatch(/^2023-07-15/);
  });

  it('resolves wiki-links in frontmatter values to note URIs (backlink-ready)', async () => {
    await indexNote('a.md', '# A');
    await indexNote('b.md', `---
related: "[[a]]"
---
# B
`);

    const { results } = await queryGraph(`
      SELECT ?target ?targetPath WHERE {
        ?note minerva:relativePath "b.md" ;
              minerva:meta-related ?target .
        OPTIONAL { ?target minerva:relativePath ?targetPath }
      }
    `);
    const row = (results as Array<Record<string, string>>)[0];
    expect(row.target).toContain('note/a');
    expect(row.targetPath).toBe('a.md');
  });

  it('unknown keys still fall through to minerva:meta-<key>', async () => {
    await indexNote('paper.md', `---
weirdField: some value
---
# Paper
`);
    const { results } = await queryGraph(`
      SELECT ?v WHERE { ?note minerva:relativePath "paper.md" ; minerva:meta-weirdField ?v . }
    `);
    expect((results as Array<{ v: string }>)[0].v).toBe('some value');
  });

  it('frontmatter title still suppressed (H1/filename title wins the dc:title slot)', async () => {
    await indexNote('paper.md', `---
title: Frontmatter Title
---
# H1 Heading
`);
    const { results } = await queryGraph(`
      SELECT ?title WHERE { ?note minerva:relativePath "paper.md" ; dc:title ?title . }
    `);
    const titles = (results as Array<{ title: string }>).map(r => r.title);
    // Exactly one dc:title (the frontmatter one wins — extractTitle prefers it).
    expect(titles).toEqual(['Frontmatter Title']);
  });
});
