export interface StockQuery {
  name: string;
  description: string;
  query: string;
}

const PREFIXES = `PREFIX minerva: <https://minerva.dev/ontology#>
PREFIX dc: <http://purl.org/dc/terms/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
`;

export const STOCK_QUERIES: StockQuery[] = [
  {
    name: 'All notes with tags',
    description: 'Lists every note and its associated tags',
    query: `${PREFIXES}
SELECT ?title ?tag WHERE {
  ?note rdf:type minerva:Note .
  ?note dc:title ?title .
  ?note minerva:hasTag ?tagNode .
  ?tagNode minerva:tagName ?tag .
}
ORDER BY ?title ?tag`,
  },
  {
    name: 'Backlinks to note',
    description: 'Notes that link to a specific note (edit the target path)',
    query: `${PREFIXES}
# Edit the target note path below
SELECT ?title ?path WHERE {
  ?source rdf:type minerva:Note .
  ?source dc:title ?title .
  ?source minerva:relativePath ?path .
  ?source minerva:linksTo ?target .
  ?target minerva:relativePath "YOUR_NOTE.md" .
}
ORDER BY ?title`,
  },
  {
    name: 'Orphan notes',
    description: 'Notes with no incoming or outgoing wiki-links',
    query: `${PREFIXES}
SELECT ?title ?path WHERE {
  ?note rdf:type minerva:Note .
  ?note dc:title ?title .
  ?note minerva:relativePath ?path .
  FILTER NOT EXISTS { ?note minerva:linksTo ?any }
  FILTER NOT EXISTS { ?other minerva:linksTo ?note }
}
ORDER BY ?title`,
  },
  {
    name: 'Most-linked notes',
    description: 'Notes ranked by number of incoming links',
    query: `${PREFIXES}
SELECT ?title ?path (COUNT(?source) AS ?incomingLinks) WHERE {
  ?note rdf:type minerva:Note .
  ?note dc:title ?title .
  ?note minerva:relativePath ?path .
  ?source minerva:linksTo ?note .
}
GROUP BY ?note ?title ?path
ORDER BY DESC(?incomingLinks)`,
  },
  {
    name: 'Recently modified',
    description: 'Notes ordered by last modification date',
    query: `${PREFIXES}
SELECT ?title ?path ?modified WHERE {
  ?note rdf:type minerva:Note .
  ?note dc:title ?title .
  ?note minerva:relativePath ?path .
  ?note dc:modified ?modified .
}
ORDER BY DESC(?modified)`,
  },
  {
    name: 'All tags with counts',
    description: 'Tag names with the number of notes using each',
    query: `${PREFIXES}
SELECT ?tag (COUNT(?note) AS ?count) WHERE {
  ?tagNode rdf:type minerva:Tag .
  ?tagNode minerva:tagName ?tag .
  ?note minerva:hasTag ?tagNode .
}
GROUP BY ?tagNode ?tag
ORDER BY DESC(?count)`,
  },
  {
    name: 'Notes in folder',
    description: 'Notes within a specific folder (edit the folder path)',
    query: `${PREFIXES}
# Edit the folder path below
SELECT ?title ?path WHERE {
  ?note rdf:type minerva:Note .
  ?note dc:title ?title .
  ?note minerva:relativePath ?path .
  ?note minerva:inFolder ?folder .
  ?folder minerva:relativePath "YOUR_FOLDER" .
}
ORDER BY ?title`,
  },
];
