import ONTOLOGY_TTL from '../../../shared/ontology.ttl?raw';
import THOUGHT_ONTOLOGY_TTL from '../../../shared/ontology-thought.ttl?raw';
import type { NotebaseTool } from './types';

function runDescribeSchema(): string {
  return [
    '# Minerva Core Ontology (minerva:)',
    '',
    ONTOLOGY_TTL,
    '',
    '# Thought Ontology (thought:)',
    '',
    THOUGHT_ONTOLOGY_TTL,
  ].join('\n');
}

export const describeGraphSchema: NotebaseTool = {
  definition: {
    name: 'describe_graph_schema',
    description:
      'Return the full Minerva ontology as Turtle. Contains every class ' +
      '(minerva:Note, minerva:Tag, thought:Claim, etc.) and every predicate ' +
      '(minerva:supports, minerva:hasTag, dc:title, thought:hasClaim, etc.) ' +
      'used in the graph, with rdfs:label and rdfs:comment for each. Call ' +
      'this before writing a non-trivial SPARQL query if you are not sure ' +
      'what the schema looks like. The returned text is authoritative.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  run: () => ({ content: runDescribeSchema(), isError: false }),
};
