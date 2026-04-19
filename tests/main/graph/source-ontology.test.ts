import { describe, it, expect, beforeAll } from 'vitest';
import * as $rdf from 'rdflib';
import fs from 'node:fs';
import path from 'node:path';

const THOUGHT = $rdf.Namespace('https://minerva.dev/ontology/thought#');
const RDF = $rdf.Namespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#');
const RDFS = $rdf.Namespace('http://www.w3.org/2000/01/rdf-schema#');
const OWL = $rdf.Namespace('http://www.w3.org/2002/07/owl#');
const DC = $rdf.Namespace('http://purl.org/dc/terms/');
const BIBO = $rdf.Namespace('http://purl.org/ontology/bibo/');
const SCHEMA = $rdf.Namespace('http://schema.org/');

const ONTOLOGY_PATH = path.join(__dirname, '../../../src/shared/ontology-thought.ttl');
const ONTOLOGY_TTL = fs.readFileSync(ONTOLOGY_PATH, 'utf-8');

function freshStore(): $rdf.IndexedFormula {
  const store = $rdf.graph();
  $rdf.parse(ONTOLOGY_TTL, store, THOUGHT('').value, 'text/turtle');
  return store;
}

describe('Source subtypes in thought ontology', () => {
  let store: $rdf.IndexedFormula;
  beforeAll(() => {
    store = freshStore();
  });

  for (const subtype of ['WebPage', 'Article', 'Book', 'Preprint', 'Report', 'PDFSource']) {
    it(`declares thought:${subtype} as a subclass of thought:Source`, () => {
      const matches = store.statementsMatching(
        THOUGHT(subtype),
        RDFS('subClassOf'),
        THOUGHT('Source'),
      );
      expect(matches.length).toBe(1);
    });

    it(`declares thought:${subtype} as an owl:Class`, () => {
      const matches = store.statementsMatching(THOUGHT(subtype), RDF('type'), OWL('Class'));
      expect(matches.length).toBe(1);
    });
  }
});

describe('Source metadata predicates', () => {
  let store: $rdf.IndexedFormula;
  beforeAll(() => {
    store = freshStore();
  });

  // Test that each expected predicate is declared with a domain of thought:Source.
  const predicates: Array<{ ns: $rdf.Namespace; local: string; label: string }> = [
    { ns: DC, local: 'title', label: 'title' },
    { ns: DC, local: 'creator', label: 'creator' },
    { ns: DC, local: 'issued', label: 'issued' },
    { ns: DC, local: 'publisher', label: 'publisher' },
    { ns: DC, local: 'language', label: 'language' },
    { ns: DC, local: 'abstract', label: 'abstract' },
    { ns: BIBO, local: 'doi', label: 'DOI' },
    { ns: BIBO, local: 'isbn', label: 'ISBN' },
    { ns: BIBO, local: 'uri', label: 'canonical URI' },
    { ns: BIBO, local: 'numPages', label: 'page count' },
    { ns: BIBO, local: 'pages', label: 'page range' },
    { ns: BIBO, local: 'volume', label: 'volume' },
    { ns: BIBO, local: 'issue', label: 'issue' },
    { ns: SCHEMA, local: 'inContainer', label: 'in container' },
    { ns: THOUGHT, local: 'accessedAt', label: 'accessed at' },
    { ns: THOUGHT, local: 'archivedAt', label: 'archived at' },
  ];

  for (const { ns, local, label: _label } of predicates) {
    it(`declares ${ns('').value.replace(/#$/, '').split('/').pop()}:${local} on domain thought:Source`, () => {
      const matches = store.statementsMatching(
        ns(local),
        RDFS('domain'),
        THOUGHT('Source'),
      );
      expect(matches.length).toBe(1);
    });
  }
});

describe('hand-authored source stubs parse and query cleanly', () => {
  it('parses a web-page source stub', () => {
    const store = freshStore();
    const ttl = `
      @prefix thought: <https://minerva.dev/ontology/thought#> .
      @prefix dc:      <http://purl.org/dc/terms/> .
      @prefix bibo:    <http://purl.org/ontology/bibo/> .
      @prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .

      <urn:src:example-article> a thought:WebPage ;
        dc:title "An example article" ;
        dc:creator "Ada Lovelace" ;
        dc:issued "2026-04-12"^^xsd:date ;
        bibo:uri <https://example.com/article> ;
        thought:accessedAt "2026-04-19T10:00:00Z"^^xsd:dateTime .
    `;
    expect(() =>
      $rdf.parse(ttl, store, 'urn:test:void', 'text/turtle'),
    ).not.toThrow();

    const src = $rdf.sym('urn:src:example-article');
    expect(store.any(src, DC('title'))?.value).toBe('An example article');
    expect(store.any(src, DC('creator'))?.value).toBe('Ada Lovelace');
    // Confirm it inherits from Source via subClassOf (one-hop check).
    const typeStmt = store.any(src, RDF('type'));
    expect(typeStmt?.value).toBe(THOUGHT('WebPage').value);
    const isSubclass = store.statementsMatching(
      THOUGHT('WebPage'),
      RDFS('subClassOf'),
      THOUGHT('Source'),
    ).length > 0;
    expect(isSubclass).toBe(true);
  });

  it('parses an article stub with DOI, container, and page range', () => {
    const store = freshStore();
    const ttl = `
      @prefix thought: <https://minerva.dev/ontology/thought#> .
      @prefix dc:      <http://purl.org/dc/terms/> .
      @prefix bibo:    <http://purl.org/ontology/bibo/> .
      @prefix schema:  <http://schema.org/> .
      @prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .

      <urn:src:journal/nature> a thought:Source ;
        dc:title "Nature" ;
        dc:publisher "Springer Nature" .

      <urn:src:smith-2023> a thought:Article ;
        dc:title "On the structure of knowledge graphs" ;
        dc:creator "Alice Smith" ,
                   "Bob Jones" ;
        dc:issued "2023-07-15"^^xsd:date ;
        bibo:doi "10.1038/s41586-023-0001-0" ;
        bibo:volume "619" ;
        bibo:issue "7969" ;
        bibo:pages "245-267" ;
        schema:inContainer <urn:src:journal/nature> .
    `;
    $rdf.parse(ttl, store, 'urn:test:void', 'text/turtle');

    const src = $rdf.sym('urn:src:smith-2023');
    expect(store.any(src, BIBO('doi'))?.value).toBe('10.1038/s41586-023-0001-0');
    expect(store.any(src, BIBO('pages'))?.value).toBe('245-267');
    const creators = store.statementsMatching(src, DC('creator')).map(s => s.object.value);
    expect(creators).toEqual(expect.arrayContaining(['Alice Smith', 'Bob Jones']));
    // Container link resolves to another Source.
    const container = store.any(src, SCHEMA('inContainer'));
    expect(container?.value).toBe('urn:src:journal/nature');
    expect(store.any($rdf.sym(container!.value), DC('title'))?.value).toBe('Nature');
  });

  it('parses a preprint stub with archivedAt pointing at a local PDF', () => {
    const store = freshStore();
    const ttl = `
      @prefix thought: <https://minerva.dev/ontology/thought#> .
      @prefix dc:      <http://purl.org/dc/terms/> .
      @prefix bibo:    <http://purl.org/ontology/bibo/> .
      @prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .

      <urn:src:arxiv/2401.12345> a thought:Preprint ;
        dc:title "A pre-printed paper" ;
        dc:creator "Carol Example" ;
        bibo:uri <https://arxiv.org/abs/2401.12345> ;
        thought:archivedAt ".minerva/sources/arxiv-2401.12345/original.pdf" .
    `;
    $rdf.parse(ttl, store, 'urn:test:void', 'text/turtle');

    const src = $rdf.sym('urn:src:arxiv/2401.12345');
    expect(store.any(src, THOUGHT('archivedAt'))?.value).toBe(
      '.minerva/sources/arxiv-2401.12345/original.pdf',
    );
  });

  it('enables finding all Article sources by type', () => {
    const store = freshStore();
    const ttl = `
      @prefix thought: <https://minerva.dev/ontology/thought#> .
      @prefix dc:      <http://purl.org/dc/terms/> .

      <urn:src:a> a thought:Article ; dc:title "Paper A" .
      <urn:src:b> a thought:Article ; dc:title "Paper B" .
      <urn:src:c> a thought:Book ;    dc:title "Book C" .
      <urn:src:d> a thought:WebPage ; dc:title "Page D" .
    `;
    $rdf.parse(ttl, store, 'urn:test:void', 'text/turtle');

    const articles = store
      .statementsMatching(undefined, RDF('type'), THOUGHT('Article'))
      .map(s => store.any(s.subject, DC('title'))?.value)
      .filter((v): v is string => typeof v === 'string');
    expect(articles.sort()).toEqual(['Paper A', 'Paper B']);
  });
});
