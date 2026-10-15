/**
 * @vitest-environment node
 *
 * Checking a thoughtbase's own vocabulary (#2788): accepted whole or refused
 * whole, with each problem named.
 */
import { describe, it, expect } from 'vitest';
import {
  acceptVocabulary,
  checkVocabulary,
  emptyAccepted,
  MAX_VOCABULARY_BYTES,
  toCurie,
} from '../../../src/main/graph/user-ontology-check';

const LAB = [
  '@prefix lab: <https://lab.example/ns#> .',
  '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
  '@prefix owl: <http://www.w3.org/2002/07/owl#> .',
  '',
  'lab:Sample a owl:Class ; rdfs:label "Sample" ; rdfs:label "Probe"@de .',
  'lab:collectedOn a owl:DatatypeProperty ; rdfs:label "collected on" ;',
  '  rdfs:domain lab:Sample ; rdfs:range <http://www.w3.org/2001/XMLSchema#date> .',
  '',
].join('\n');

const problemsOf = (file: string, text: string, accepted = emptyAccepted()) => {
  const { status } = checkVocabulary(file, text, accepted);
  return status.ok ? [] : status.problems;
};

describe('checkVocabulary (#2788)', () => {
  it('accepts a vocabulary, listing its prefixes, classes and properties with their labels', () => {
    const checked = checkVocabulary('lab.ttl', LAB, emptyAccepted());
    expect(checked.status).toEqual({
      file: 'lab.ttl',
      ok: true,
      prefixes: [{ prefix: 'lab', iri: 'https://lab.example/ns#' }],
      classes: [{ iri: 'https://lab.example/ns#Sample', curie: 'lab:Sample', label: 'Sample' }],
      properties: [{ iri: 'https://lab.example/ns#collectedOn', curie: 'lab:collectedOn', label: 'collected on' }],
      triples: 7,
      notes: [],
    });
    expect(checked.quads).toHaveLength(7);
    // rdfs: and owl: are standard, bound to the same IRIs — not injected again.
    expect(checked.injected.map((p) => p.prefix)).toEqual(['lab']);
  });

  it('refuses a file that isn\'t Turtle, saying where', () => {
    expect(problemsOf('bad.ttl', 'lab:x a .')).toEqual([expect.stringMatching(/^It isn't valid Turtle: .*line 1/)]);
  });

  it('refuses a description of a built-in term — Minerva\'s namespaces, and the bundled ontology', () => {
    const thoughtClaim = '@prefix thought: <https://minerva.dev/ontology/thought#> .\nthought:Claim <http://www.w3.org/2000/01/rdf-schema#comment> "x" .';
    expect(problemsOf('a.ttl', thoughtClaim)).toEqual(['It describes thought:Claim, a built-in term; a vocabulary can add terms, not change Minerva\'s.']);
    const newMinervaTerm = '<https://minerva.dev/ontology#notYetATerm> a <http://www.w3.org/2000/01/rdf-schema#Class> .';
    expect(problemsOf('b.ttl', newMinervaTerm)).toEqual([expect.stringContaining('minerva:notYetATerm, a built-in term')]);
    // Naming a built-in as an object is how a vocabulary builds on it — fine.
    const buildsOn = '@prefix thought: <https://minerva.dev/ontology/thought#> .\n<https://lab.example/Finding> <http://www.w3.org/2000/01/rdf-schema#subClassOf> thought:Claim .';
    expect(problemsOf('c.ttl', buildsOn)).toEqual([]);
  });

  it('refuses rebinding a standard prefix, and accepts binding it to the same IRI', () => {
    expect(problemsOf('a.ttl', '@prefix skos: <https://attacker.example/skos#> .\n')).toEqual([
      'It binds the standard prefix skos: to <https://attacker.example/skos#>; Minerva binds it to <http://www.w3.org/2004/02/skos/core#>.',
    ]);
    expect(problemsOf('b.ttl', '@prefix skos: <http://www.w3.org/2004/02/skos/core#> .\n')).toEqual([]);
  });

  it('refuses a prefix bound differently by an accepted vocabulary, or twice in one file', () => {
    const accepted = emptyAccepted();
    acceptVocabulary(accepted, checkVocabulary('lab.ttl', LAB, accepted));
    expect(problemsOf('other.ttl', '@prefix lab: <https://elsewhere.example/#> .\n', accepted)).toEqual([
      'It binds lab: to <https://elsewhere.example/#>; lab.ttl binds it to <https://lab.example/ns#>.',
    ]);
    expect(problemsOf('same.ttl', '@prefix lab: <https://lab.example/ns#> .\n', accepted)).toEqual([]);
    expect(problemsOf('twice.ttl', '@prefix a: <https://a.example/#> .\n@prefix a: <https://b.example/#> .\n'))
      .toEqual(['It declares the prefix a: twice, as <https://a.example/#> and <https://b.example/#>.']);
  });

  it('never splices an IRI a query couldn\'t hold; the empty prefix is noted, not injected', () => {
    expect(problemsOf('rel.ttl', '@prefix r: <relative/> .\n')).toEqual([
      'The prefix r: is bound to <relative/>, which isn\'t an absolute IRI a query can use.',
    ]);
    const empty = checkVocabulary('e.ttl', '@prefix : <https://e.example/#> .\n:A a <http://www.w3.org/2000/01/rdf-schema#Class> .', emptyAccepted());
    expect(empty.status.ok).toBe(true);
    expect(empty.injected).toEqual([]);
    expect(empty.status.ok && empty.status.notes).toEqual([expect.stringContaining('The empty prefix ":" isn\'t added to queries')]);
  });

  it('refuses a relative IRI', () => {
    expect(problemsOf('a.ttl', '<Foo> a <http://www.w3.org/2000/01/rdf-schema#Class> .')).toEqual([
      '<Foo> is a relative IRI; write it in full, or give the file an @base.',
    ]);
  });

  it('refuses a term with two ranges, or two labels in one language — but not labels in two', () => {
    const twoRanges = '@prefix lab: <https://lab.example/ns#> .\n@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .\n'
      + 'lab:p rdfs:range lab:A ; rdfs:range lab:B .';
    expect(problemsOf('a.ttl', twoRanges)).toEqual([
      'lab:p has 2 different rdfs:range values: "https://lab.example/ns#A" | "https://lab.example/ns#B".',
    ]);
    const twoLabels = '<https://lab.example/x> <http://www.w3.org/2000/01/rdf-schema#label> "One", "Two" .';
    expect(problemsOf('b.ttl', twoLabels)).toEqual([expect.stringContaining('has 2 different rdfs:label values')]);
    expect(problemsOf('c.ttl', LAB)).toEqual([]); // "Sample" and "Probe"@de
  });

  it('refuses contradicting a vocabulary already accepted, naming the file', () => {
    const accepted = emptyAccepted();
    acceptVocabulary(accepted, checkVocabulary('lab.ttl', LAB, accepted));
    const relabel = '<https://lab.example/ns#Sample> <http://www.w3.org/2000/01/rdf-schema#label> "Specimen" .';
    expect(problemsOf('more.ttl', relabel, accepted)).toEqual([
      '<https://lab.example/ns#Sample>\'s rdfs:label is "Specimen"; lab.ttl says "Sample".',
    ]);
    const agrees = '<https://lab.example/ns#Sample> <http://www.w3.org/2000/01/rdf-schema#label> "Sample" .';
    expect(problemsOf('agrees.ttl', agrees, accepted)).toEqual([]);
  });

  it('refuses a file over the size cap without parsing it', () => {
    const big = `# ${'x'.repeat(MAX_VOCABULARY_BYTES)}\n`;
    expect(problemsOf('big.ttl', big)).toEqual([expect.stringMatching(/a vocabulary may be at most 1024 KB/)]);
  });

  it('toCurie uses the longest matching namespace and a plain local name', () => {
    const prefixes = [{ prefix: 'a', iri: 'https://x/' }, { prefix: 'b', iri: 'https://x/y#' }];
    expect(toCurie('https://x/y#Z', prefixes)).toBe('b:Z');
    expect(toCurie('https://x/q', prefixes)).toBe('a:q');
    expect(toCurie('https://x/has space', prefixes)).toBeUndefined();
    expect(toCurie('https://elsewhere/', prefixes)).toBeUndefined();
  });
});
