import { complete } from './index';
import { proposeWrite } from './approval';

const CRYSTALLIZATION_PROMPT = `You are an epistemic analyst. Given the following conversation excerpt, extract structured thought components using the Minerva thought ontology.

For each component you identify, output it as a Turtle triple block. Use these types:
- thought:Claim — an assertion presented as true
- thought:Grounds — evidence or data supporting a claim
- thought:Warrant — reasoning connecting grounds to claim
- thought:Hypothesis — a tentative claim for investigation
- thought:Question — an open inquiry
- thought:Observation — a noted phenomenon
- thought:Insight — a non-obvious understanding
- thought:Principle — a general rule or heuristic
- thought:Assumption — a premise taken as given
- thought:Implication — a consequence that follows
- thought:Definition — a definition of a term
- thought:Goal — a desired outcome
- thought:Plan — a proposed sequence of actions
- thought:Tension — an unresolved conflict

For each component, include:
- rdf:type (the thought component type)
- thought:label (a concise summary, 1-2 sentences)
- thought:sourceText (the verbatim passage you extracted from)
- thought:extractedBy "llm:crystallization"
- thought:hasStatus thought:proposed
- Any relationships between components (thought:supports, thought:challenges, thought:presupposes, etc.)

Use blank nodes or minted URIs like <_:claim1>, <_:grounds1> etc.

Output ONLY valid Turtle. No prose, no explanation, just the triples.
If no meaningful components can be extracted, output nothing.`;

export interface CrystallizationResult {
  turtle: string;
  componentCount: number;
}

export async function crystallize(
  text: string,
  conversationUri: string,
  proposedBy: string = 'llm:crystallization',
): Promise<CrystallizationResult> {
  const prompt = `${CRYSTALLIZATION_PROMPT}

## Conversation Excerpt

${text}`;

  const turtle = await complete(prompt);
  const trimmed = turtle.trim();

  if (!trimmed) {
    return { turtle: '', componentCount: 0 };
  }

  // Count rough number of components (rdf:type declarations)
  const componentCount = (trimmed.match(/rdf:type\s+thought:/g) || []).length;

  // Add grounding to the conversation
  const groundedTurtle = `${trimmed}`;

  // Route through approval engine as component_creation
  await proposeWrite({
    operationType: 'component_creation',
    turtleDiff: groundedTurtle,
    note: `Crystallized ${componentCount} thought component${componentCount !== 1 ? 's' : ''} from conversation`,
    conversationUri,
    proposedBy,
  });

  return { turtle: groundedTurtle, componentCount };
}
