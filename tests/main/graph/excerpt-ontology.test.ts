import { describe, it, expect, beforeAll } from 'vitest';
import * as $rdf from 'rdflib';
import fs from 'node:fs';
import path from 'node:path';

const THOUGHT = $rdf.Namespace('https://minerva.dev/ontology/thought#');
const RDF = $rdf.Namespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#');
const RDFS = $rdf.Namespace('http://www.w3.org/2000/01/rdf-schema#');
const OWL = $rdf.Namespace('http://www.w3.org/2002/07/owl#');
const DC = $rdf.Namespace('http://purl.org/dc/terms/');
const XSD = $rdf.Namespace('http://www.w3.org/2001/XMLSchema#');

const ONTOLOGY_PATH = path.join(__dirname, '../../../src/shared/ontology-thought.ttl');
const ONTOLOGY_TTL = fs.readFileSync(ONTOLOGY_PATH, 'utf-8');

function freshStore(): $rdf.IndexedFormula {
  const store = $rdf.graph();
  $rdf.parse(ONTOLOGY_TTL, store, THOUGHT('').value, 'text/turtle');
  return store;
}

describe('Excerpt class and core predicates', () => {
  let store: $rdf.IndexedFormula;
  beforeAll(() => { store = freshStore(); });

  it('declares thought:Excerpt as an owl:Class subclass of thought:Component', () => {
    expect(store.statementsMatching(THOUGHT('Excerpt'), RDF('type'), OWL('Class'))).toHaveLength(1);
    expect(store.statementsMatching(THOUGHT('Excerpt'), RDFS('subClassOf'), THOUGHT('Component'))).toHaveLength(1);
  });

  it('declares thought:fromSource from Excerpt to Source', () => {
    expect(store.statementsMatching(THOUGHT('fromSource'), RDFS('domain'), THOUGHT('Excerpt'))).toHaveLength(1);
    expect(store.statementsMatching(THOUGHT('fromSource'), RDFS('range'), THOUGHT('Source'))).toHaveLength(1);
  });

  it('declares thought:citedText as a string literal on Excerpt', () => {
    expect(store.statementsMatching(THOUGHT('citedText'), RDFS('domain'), THOUGHT('Excerpt'))).toHaveLength(1);
    expect(store.statementsMatching(THOUGHT('citedText'), RDFS('range'), XSD('string'))).toHaveLength(1);
  });

  it('declares thought:quotes from any Component to Excerpt', () => {
    expect(store.statementsMatching(THOUGHT('quotes'), RDFS('domain'), THOUGHT('Component'))).toHaveLength(1);
    expect(store.statementsMatching(THOUGHT('quotes'), RDFS('range'), THOUGHT('Excerpt'))).toHaveLength(1);
  });
});

describe('Excerpt location predicates', () => {
  let store: $rdf.IndexedFormula;
  beforeAll(() => { store = freshStore(); });

  const locationPredicates: Array<{ local: string; range: ReturnType<typeof XSD> }> = [
    { local: 'page', range: XSD('integer') },
    { local: 'pageRange', range: XSD('string') },
    { local: 'charStart', range: XSD('integer') },
    { local: 'charEnd', range: XSD('integer') },
    { local: 'selector', range: XSD('string') },
    { local: 'locationText', range: XSD('string') },
  ];

  for (const { local, range } of locationPredicates) {
    it(`declares thought:${local} on Excerpt domain`, () => {
      expect(store.statementsMatching(THOUGHT(local), RDFS('domain'), THOUGHT('Excerpt'))).toHaveLength(1);
      expect(store.statementsMatching(THOUGHT(local), RDFS('range'), range)).toHaveLength(1);
    });
  }
});

describe('hand-authored excerpt stub parses cleanly', () => {
  it('parses an excerpt with fromSource and structured location', () => {
    const store = freshStore();
    const ttl = `
      @prefix thought: <https://minerva.dev/ontology/thought#> .
      @prefix dc:      <http://purl.org/dc/terms/> .
      @prefix xsd:     <http://www.w3.org/2001/XMLSchema#> .

      <urn:src:smith-2023> a thought:Article ;
          dc:title "On the structure of knowledge graphs" .

      <urn:ex:smith-2023-p42> a thought:Excerpt ;
          thought:fromSource <urn:src:smith-2023> ;
          thought:citedText "Graphs are inherently relational." ;
          thought:page 42 ;
          thought:charStart 1234 ;
          thought:charEnd 1278 .
    `;
    expect(() => $rdf.parse(ttl, store, 'urn:test:void', 'text/turtle')).not.toThrow();

    const ex = $rdf.sym('urn:ex:smith-2023-p42');
    expect(store.any(ex, THOUGHT('citedText'))?.value).toBe('Graphs are inherently relational.');
    expect(store.any(ex, THOUGHT('page'))?.value).toBe('42');
    expect(store.any(ex, THOUGHT('fromSource'))?.value).toBe('urn:src:smith-2023');
  });
});
