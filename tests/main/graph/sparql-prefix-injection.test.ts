import { describe, it, expect } from 'vitest';
import { injectSparqlPrefixes } from '../../../src/main/graph/index';

describe('injectSparqlPrefixes', () => {
  it('prepends every standard prefix to a bare query', () => {
    const out = injectSparqlPrefixes('SELECT ?s WHERE { ?s ?p ?o }');
    expect(out).toContain('PREFIX minerva: <https://minerva.dev/ontology#>');
    expect(out).toContain('PREFIX owl: <http://www.w3.org/2002/07/owl#>');
    expect(out).toContain('PREFIX csvw: <http://www.w3.org/ns/csvw#>');
    expect(out).toContain('PREFIX bibo: <http://purl.org/ontology/bibo/>');
    expect(out).toContain('PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>');
    expect(out).toContain('PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>');
    expect(out).toContain('PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>');
  });

  it('does not re-inject a prefix the query already declares (uppercase)', () => {
    const input = 'PREFIX owl: <http://example.com/other#>\nSELECT ?s WHERE { ?s a owl:X }';
    const out = injectSparqlPrefixes(input);
    // One owl: declaration only — the user's, not ours.
    const matches = out.match(/PREFIX\s+owl:/gi) ?? [];
    expect(matches.length).toBe(1);
    expect(out).toContain('http://example.com/other#');
  });

  it('catches case variants (lowercase, MixedCase) of the PREFIX keyword', () => {
    const lower = 'prefix owl: <http://example.com/a#>\nSELECT ?s WHERE {}';
    expect((injectSparqlPrefixes(lower).match(/\bprefix\s+owl\s*:/gi) ?? []).length).toBe(1);

    const mixed = 'Prefix owl: <http://example.com/b#>\nSELECT ?s WHERE {}';
    expect((injectSparqlPrefixes(mixed).match(/\bprefix\s+owl\s*:/gi) ?? []).length).toBe(1);
  });

  it('tolerates extra whitespace between keyword and prefix name', () => {
    const input = 'PREFIX   csvw:   <http://example.com/c#>\nSELECT ?s WHERE {}';
    const matches = injectSparqlPrefixes(input).match(/PREFIX\s+csvw\s*:/gi) ?? [];
    expect(matches.length).toBe(1);
  });

  it('still injects the prefixes the user did not declare', () => {
    const input = 'PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>\nSELECT ?s WHERE {}';
    const out = injectSparqlPrefixes(input);
    // user kept their rdf, we added the rest
    expect(out).toContain('PREFIX owl: <http://www.w3.org/2002/07/owl#>');
    expect(out).toContain('PREFIX minerva:');
    expect((out.match(/PREFIX\s+rdf:/gi) ?? []).length).toBe(1);
  });

  it('leaves a fully-prefixed query unchanged (no duplicate decls)', () => {
    const input = [
      'PREFIX minerva: <https://minerva.dev/ontology#>',
      'PREFIX thought: <https://minerva.dev/ontology/thought#>',
      'PREFIX dc: <http://purl.org/dc/terms/>',
      'PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>',
      'PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>',
      'PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>',
      'PREFIX csvw: <http://www.w3.org/ns/csvw#>',
      'PREFIX owl: <http://www.w3.org/2002/07/owl#>',
      'PREFIX prov: <http://www.w3.org/ns/prov#>',
      'PREFIX bibo: <http://purl.org/ontology/bibo/>',
      'PREFIX schema: <http://schema.org/>',
      'PREFIX types: <https://minerva.dev/ontology/types#>',
      'PREFIX dcat: <http://www.w3.org/ns/dcat#>',
      'PREFIX skos: <http://www.w3.org/2004/02/skos/core#>',
      'PREFIX foaf: <http://xmlns.com/foaf/0.1/>',
      'SELECT ?s WHERE { ?s ?p ?o }',
    ].join('\n');
    const out = injectSparqlPrefixes(input);
    expect(out).toBe(input);
  });

  // Shrunk counterexamples from tests/property/sparql-prefixes.property.test.ts (#2388).
  it('still injects a prefix that a comment in the body only mentions', () => {
    const out = injectSparqlPrefixes(
      'SELECT * WHERE {\n  BIND(skos:x AS ?v0)\n  # PREFIX skos: <http://example.com/skos-in-a-comment#>\n}',
    );
    expect(out).toContain('PREFIX skos: <http://www.w3.org/2004/02/skos/core#>');
  });

  it('still injects a prefix that a string literal only mentions', () => {
    const out = injectSparqlPrefixes('SELECT * WHERE { BIND("prefix owl: in a string" AS ?s) }');
    expect(out).toContain('PREFIX owl: <http://www.w3.org/2002/07/owl#>');
  });

  it('treats prefix names as case-sensitive: PREFIX DC: does not declare dc', () => {
    const out = injectSparqlPrefixes('PREFIX DC: <http://example.com/a#>\nSELECT * WHERE { ?s dc:title ?t }');
    expect(out).toContain('PREFIX dc: <http://purl.org/dc/terms/>');
    expect(out).toContain('PREFIX DC: <http://example.com/a#>');
  });

  it('reads declarations after comments and BASE in the prologue', () => {
    const input = '# header\nBASE <urn:b:>\nprefix\tfoaf:<http://example.com/f#>\nSELECT * WHERE { ?s foaf:x ?o }';
    expect(injectSparqlPrefixes(input)).not.toContain('PREFIX foaf:');
  });
});
