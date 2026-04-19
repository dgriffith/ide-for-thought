export interface StockQuery {
  name: string;
  description: string;
  query: string;
}

const PREFIXES = `PREFIX minerva: <https://minerva.dev/ontology#>
PREFIX dc: <http://purl.org/dc/terms/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
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
  {
    name: 'Typed outgoing links',
    description: 'All typed links from each note (supports, rebuts, expands, etc.)',
    query: `${PREFIXES}
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT ?sourceTitle ?linkType ?targetTitle WHERE {
  ?source rdf:type minerva:Note .
  ?source dc:title ?sourceTitle .
  ?source ?predicate ?target .
  ?target rdf:type minerva:Note .
  ?target dc:title ?targetTitle .
  ?predicate rdfs:subPropertyOf minerva:linksTo .
  BIND(REPLACE(STR(?predicate), "https://minerva.dev/ontology#", "") AS ?linkType)
}
ORDER BY ?sourceTitle ?linkType`,
  },
  {
    name: 'Typed backlinks',
    description: 'All typed links pointing to each note (who supports/rebuts/expands this note)',
    query: `${PREFIXES}
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>

SELECT ?targetTitle ?linkType ?sourceTitle WHERE {
  ?source rdf:type minerva:Note .
  ?source dc:title ?sourceTitle .
  ?source ?predicate ?target .
  ?target rdf:type minerva:Note .
  ?target dc:title ?targetTitle .
  ?predicate rdfs:subPropertyOf minerva:linksTo .
  BIND(REPLACE(STR(?predicate), "https://minerva.dev/ontology#", "") AS ?linkType)
}
ORDER BY ?targetTitle ?linkType`,
  },
  {
    name: 'Sources: all with authors and year',
    description: 'Every indexed Source with its title, first author, and year',
    query: `${PREFIXES}
PREFIX thought: <https://minerva.dev/ontology/thought#>

SELECT ?sourceId ?title ?creator ?year WHERE {
  ?src minerva:sourceId ?sourceId .
  OPTIONAL { ?src dc:title ?title }
  OPTIONAL { ?src dc:creator ?creator }
  OPTIONAL { ?src dc:issued ?issued . BIND(SUBSTR(STR(?issued), 1, 4) AS ?year) }
}
ORDER BY ?sourceId`,
  },
  {
    name: 'Sources: most-cited',
    description: 'Sources ranked by the number of distinct notes citing or quoting them',
    query: `${PREFIXES}
PREFIX thought: <https://minerva.dev/ontology/thought#>

SELECT ?sourceId ?title (COUNT(DISTINCT ?note) AS ?citations) WHERE {
  ?src minerva:sourceId ?sourceId .
  OPTIONAL { ?src dc:title ?title }
  {
    ?note thought:cites ?src .
  } UNION {
    ?note thought:quotes ?excerpt .
    ?excerpt thought:fromSource ?src .
  }
}
GROUP BY ?src ?sourceId ?title
ORDER BY DESC(?citations)`,
  },
  {
    name: 'Sources: cited by N or more notes',
    description: 'Sources that cross a citation threshold (edit MIN_COUNT)',
    query: `${PREFIXES}
PREFIX thought: <https://minerva.dev/ontology/thought#>

# Edit MIN_COUNT to change the threshold.
SELECT ?sourceId ?title (COUNT(DISTINCT ?note) AS ?citations) WHERE {
  ?src minerva:sourceId ?sourceId .
  OPTIONAL { ?src dc:title ?title }
  {
    ?note thought:cites ?src .
  } UNION {
    ?note thought:quotes ?excerpt .
    ?excerpt thought:fromSource ?src .
  }
}
GROUP BY ?src ?sourceId ?title
HAVING (COUNT(DISTINCT ?note) >= 2)
ORDER BY DESC(?citations)`,
  },
  {
    name: 'Sources: most-quoted',
    description: 'Sources ranked by the number of linked Excerpts',
    query: `${PREFIXES}
PREFIX thought: <https://minerva.dev/ontology/thought#>

SELECT ?sourceId ?title (COUNT(?excerpt) AS ?excerptCount) WHERE {
  ?src minerva:sourceId ?sourceId .
  OPTIONAL { ?src dc:title ?title }
  ?excerpt thought:fromSource ?src .
}
GROUP BY ?src ?sourceId ?title
ORDER BY DESC(?excerptCount)`,
  },
  {
    name: 'Sources: missing metadata',
    description: 'Sources that are missing a title, an author, or both (stub records)',
    query: `${PREFIXES}
PREFIX thought: <https://minerva.dev/ontology/thought#>

SELECT ?sourceId ?title ?creator WHERE {
  ?src minerva:sourceId ?sourceId .
  OPTIONAL { ?src dc:title ?title }
  OPTIONAL { ?src dc:creator ?creator }
  FILTER(!BOUND(?title) || !BOUND(?creator))
}
ORDER BY ?sourceId`,
  },
  {
    name: 'Trust: Unreviewed LLM writes',
    description: 'Components attributed to an LLM without a corresponding approved proposal (trust principle violations)',
    query: `${PREFIXES}
PREFIX thought: <https://minerva.dev/ontology/thought#>

SELECT ?component ?label ?extractedBy WHERE {
  ?component rdf:type/rdfs:subClassOf* thought:Component .
  ?component thought:extractedBy ?extractedBy .
  FILTER(CONTAINS(LCASE(?extractedBy), "llm"))
  OPTIONAL { ?component thought:label ?label }
  FILTER NOT EXISTS {
    ?proposal rdf:type thought:Proposal .
    ?proposal thought:affectsNode ?component .
    ?proposal thought:proposalStatus thought:approved .
  }
}
ORDER BY ?component`,
  },
  {
    name: 'Pending proposals',
    description: 'All proposals awaiting human review',
    query: `${PREFIXES}
PREFIX thought: <https://minerva.dev/ontology/thought#>

SELECT ?proposal ?note ?operationType ?proposedBy ?proposedAt WHERE {
  ?proposal rdf:type thought:Proposal .
  ?proposal thought:proposalStatus thought:pending .
  ?proposal thought:operationType ?operationType .
  ?proposal thought:proposedBy ?proposedBy .
  ?proposal thought:proposedAt ?proposedAt .
  OPTIONAL { ?proposal thought:proposalNote ?note }
}
ORDER BY ?proposedAt`,
  },
  {
    name: 'Conversation history',
    description: 'All recorded conversations with their status and trigger',
    query: `${PREFIXES}
PREFIX thought: <https://minerva.dev/ontology/thought#>

SELECT ?conversation ?status ?startedAt ?triggerTitle WHERE {
  ?conversation rdf:type thought:Conversation .
  ?conversation thought:conversationStatus ?statusNode .
  ?statusNode rdfs:label ?status .
  ?conversation thought:startedAt ?startedAt .
  OPTIONAL {
    ?conversation thought:trigger ?trigger .
    ?trigger dc:title ?triggerTitle .
  }
}
ORDER BY DESC(?startedAt)`,
  },
];
