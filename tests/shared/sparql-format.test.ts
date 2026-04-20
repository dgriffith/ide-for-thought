import { describe, it, expect } from 'vitest';
import { formatSparql } from '../../src/shared/sparql-format';

/** Helper: strip a leading newline so test strings can be indented. */
function q(s: string): string {
  return s.replace(/^\n/, '');
}

describe('formatSparql (issue #196)', () => {
  it('expands a single-line query into WHERE + indented triple patterns', () => {
    expect(formatSparql('SELECT ?x WHERE { ?x a <urn:Foo> . }')).toBe(q(`
SELECT ?x WHERE {
  ?x a <urn:Foo> .
}
`));
  });

  it('puts each PREFIX declaration on its own line with a blank line before SELECT', () => {
    const input = 'PREFIX a: <urn:a> PREFIX b: <urn:b> SELECT ?x WHERE { ?x a:p ?y . }';
    expect(formatSparql(input)).toBe(q(`
PREFIX a: <urn:a>
PREFIX b: <urn:b>

SELECT ?x WHERE {
  ?x a:p ?y .
}
`));
  });

  it('puts `;` continuations on their own line at the current indent', () => {
    const input = 'SELECT ?x WHERE { ?x a <urn:Foo> ; <urn:p> ?y . }';
    expect(formatSparql(input)).toBe(q(`
SELECT ?x WHERE {
  ?x a <urn:Foo> ;
  <urn:p> ?y .
}
`));
  });

  it('puts FILTER on its own line inside the WHERE body', () => {
    const input = 'SELECT ?x WHERE { ?x a <urn:Foo> . FILTER(?x > 5) }';
    expect(formatSparql(input)).toBe(q(`
SELECT ?x WHERE {
  ?x a <urn:Foo> .
  FILTER(?x > 5)
}
`));
  });

  it('indents OPTIONAL block body one deeper than the WHERE body', () => {
    const input = 'SELECT ?x WHERE { ?x a <urn:Foo> . OPTIONAL { ?x <urn:p> ?y } }';
    expect(formatSparql(input)).toBe(q(`
SELECT ?x WHERE {
  ?x a <urn:Foo> .
  OPTIONAL {
    ?x <urn:p> ?y
  }
}
`));
  });

  it('puts trailing clauses (ORDER BY, LIMIT) after the closing brace on own lines', () => {
    const input = 'SELECT ?x WHERE { ?x a <urn:Foo> . } ORDER BY DESC(?x) LIMIT 10';
    expect(formatSparql(input)).toBe(q(`
SELECT ?x WHERE {
  ?x a <urn:Foo> .
}
ORDER BY DESC(?x)
LIMIT 10
`));
  });

  it('preserves comments on their own line at the current indent', () => {
    const input = '# Top comment\nSELECT ?x WHERE { ?x a <urn:Foo> . }';
    expect(formatSparql(input)).toBe(q(`
# Top comment
SELECT ?x WHERE {
  ?x a <urn:Foo> .
}
`));
  });

  it('does not mangle strings that contain { or . or ;', () => {
    const input = `SELECT ?x WHERE { ?x <urn:p> "contains { and . and ; inside" . }`;
    expect(formatSparql(input)).toBe(q(`
SELECT ?x WHERE {
  ?x <urn:p> "contains { and . and ; inside" .
}
`));
  });

  it('does not mangle IRIs that contain `>` adjacencies', () => {
    const input = 'SELECT ?x WHERE { ?x <http://foo.example/bar?y=1> ?y . }';
    expect(formatSparql(input)).toBe(q(`
SELECT ?x WHERE {
  ?x <http://foo.example/bar?y=1> ?y .
}
`));
  });

  it('is idempotent on already-formatted output', () => {
    const input = 'SELECT ?x WHERE { ?x a <urn:Foo> ; <urn:p> ?y . FILTER(?x > 5) } ORDER BY ?x LIMIT 5';
    const once = formatSparql(input);
    const twice = formatSparql(once);
    expect(twice).toBe(once);
  });

  it('handles SELECT with aggregate + alias', () => {
    const input = 'SELECT ?x (COUNT(?y) AS ?n) WHERE { ?x <urn:p> ?y . } GROUP BY ?x';
    expect(formatSparql(input)).toBe(q(`
SELECT ?x (COUNT(?y) AS ?n) WHERE {
  ?x <urn:p> ?y .
}
GROUP BY ?x
`));
  });

  it('handles FILTER NOT EXISTS', () => {
    const input = 'SELECT ?x WHERE { ?x a <urn:Foo> . FILTER NOT EXISTS { ?x <urn:p> ?y } }';
    // FILTER NOT EXISTS reads as two words plus a block; the formatter
    // keeps FILTER at current indent and opens the nested block.
    expect(formatSparql(input)).toBe(q(`
SELECT ?x WHERE {
  ?x a <urn:Foo> .
  FILTER NOT EXISTS {
    ?x <urn:p> ?y
  }
}
`));
  });

  it('formats a stock-query-shaped input matching the written style', () => {
    // Shape matches the stock queries in src/shared/stock-queries.ts:
    // PREFIX block, SELECT, WHERE body indented, trailing ORDER BY.
    const input =
      'PREFIX minerva: <https://minerva.dev/ontology#> ' +
      'PREFIX dc: <http://purl.org/dc/terms/> ' +
      'PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> ' +
      'SELECT ?title ?tag WHERE { ?note rdf:type minerva:Note . ?note dc:title ?title . ' +
      '?note minerva:hasTag ?tagNode . ?tagNode minerva:tagName ?tag . } ORDER BY ?title ?tag';

    expect(formatSparql(input)).toBe(q(`
PREFIX minerva: <https://minerva.dev/ontology#>
PREFIX dc: <http://purl.org/dc/terms/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>

SELECT ?title ?tag WHERE {
  ?note rdf:type minerva:Note .
  ?note dc:title ?title .
  ?note minerva:hasTag ?tagNode .
  ?tagNode minerva:tagName ?tag .
}
ORDER BY ?title ?tag
`));
  });

  it('returns empty string unchanged (trimmed)', () => {
    expect(formatSparql('')).toBe('');
    expect(formatSparql('   \n  ')).toBe('');
  });
});
