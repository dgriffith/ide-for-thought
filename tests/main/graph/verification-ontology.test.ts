/**
 * The verification & currency predicates (#414–#417 follow-up) the research
 * skills file onto audited claims. Pins that they're declared as datatype
 * properties on thought:Claim so the ontology documents what the skills emit.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as $rdf from 'rdflib';
import fs from 'node:fs';
import path from 'node:path';

const THOUGHT = $rdf.Namespace('https://minerva.dev/ontology/thought#');
const RDF = $rdf.Namespace('http://www.w3.org/1999/02/22-rdf-syntax-ns#');
const RDFS = $rdf.Namespace('http://www.w3.org/2000/01/rdf-schema#');
const OWL = $rdf.Namespace('http://www.w3.org/2002/07/owl#');
const XSD = $rdf.Namespace('http://www.w3.org/2001/XMLSchema#');

const ONTOLOGY_TTL = fs.readFileSync(
  path.join(__dirname, '../../../src/shared/ontology-thought.ttl'),
  'utf-8',
);

describe('verification & currency predicates', () => {
  let store: $rdf.IndexedFormula;
  beforeAll(() => {
    store = $rdf.graph();
    $rdf.parse(ONTOLOGY_TTL, store, THOUGHT('').value, 'text/turtle');
  });

  const claimProps: Array<[string, string]> = [
    ['verificationStatus', 'string'],
    ['currencyStatus', 'string'],
    ['asOfDate', 'date'],
    ['hasPrimarySource', 'string'],
    ['hasGroundedMagnitude', 'string'],
  ];

  for (const [prop, range] of claimProps) {
    it(`thought:${prop} is a datatype property on thought:Claim (xsd:${range})`, () => {
      expect(store.holds(THOUGHT(prop), RDF('type'), OWL('DatatypeProperty'))).toBe(true);
      expect(store.holds(THOUGHT(prop), RDFS('domain'), THOUGHT('Claim'))).toBe(true);
      expect(store.holds(THOUGHT(prop), RDFS('range'), XSD(range))).toBe(true);
    });
  }

  it('thought:verifiedBy is a datatype property on thought:Component', () => {
    expect(store.holds(THOUGHT('verifiedBy'), RDF('type'), OWL('DatatypeProperty'))).toBe(true);
    expect(store.holds(THOUGHT('verifiedBy'), RDFS('domain'), THOUGHT('Component'))).toBe(true);
    expect(store.holds(THOUGHT('verifiedBy'), RDFS('range'), XSD('string'))).toBe(true);
  });
});
