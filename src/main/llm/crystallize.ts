import { complete } from './index';
import { proposeWrite, stripTurtleCodeFence } from './approval';
import * as graph from '../graph/index';
import type { ProjectContext } from '../project-context-types';

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
  ctx: ProjectContext,
  text: string,
  conversationUri: string,
  proposedBy: string = 'llm:crystallization',
  model?: string,
): Promise<CrystallizationResult> {
  graph.enterLLMContext();
  try {
    const prompt = `${CRYSTALLIZATION_PROMPT}

## Conversation Excerpt

${text}`;

    const raw = await complete(prompt, model ? { model } : undefined);
    // The model often wraps Turtle in a ```turtle code fence even when the
    // prompt forbids it. Strip before everything downstream — counting
    // components, extracting subject IRIs, the diff view in the Proposals
    // panel — so the stored payload is clean.
    const trimmed = stripTurtleCodeFence(raw).trim();

    if (!trimmed) {
      return { turtle: '', componentCount: 0 };
    }

    // Count rough number of components (rdf:type declarations)
    const componentCount = (trimmed.match(/rdf:type\s+thought:/g) || []).length;

    // Add grounding to the conversation
    const groundedTurtle = `${trimmed}`;

    // Pull every absolute IRI subject out of the LLM's Turtle so the
    // resulting Proposal carries thought:affectsNode for every component
    // it creates. The "Trust: Unreviewed LLM writes" stock query joins
    // proposals to components on this predicate — without it, every
    // crystallized component is a false-positive trust violation.
    const affectsNodeUris = extractSubjectIris(groundedTurtle);

    await proposeWrite(ctx, {
      operationType: 'component_creation',
      payloads: [
        { kind: 'graph-triples', turtle: groundedTurtle, affectsNodeUris },
      ],
      note: `Crystallized ${componentCount} thought component${componentCount !== 1 ? 's' : ''} from conversation`,
      conversationUri,
      proposedBy,
    });

    return { turtle: groundedTurtle, componentCount };
  } finally {
    graph.exitLLMContext();
  }
}

/**
 * Extract every absolute-IRI subject from a Turtle blob. Used by
 * crystallize to enumerate the components a proposal will create so the
 * proposal's thought:affectsNode triples cover all of them.
 *
 * Best-effort: a regex over the unparsed string. Misses subjects expressed
 * as prefixed names (no full IRI to point at), and misses blank nodes
 * (those have no stable URI to record). For a stricter parse, switch to
 * the rdflib parser — but we want to record the URI before approval
 * applies the diff, so we read the LLM's text, not the parsed store.
 */
export function extractSubjectIris(turtle: string): string[] {
  const out = new Set<string>();
  // Match `<http://...>` or `<https://...>` at the start of a triple.
  // A "start" means after a `;`-or-`.` predicate-list terminator, after
  // a `}` graph close, or at the beginning of the document — but the
  // simplest practical heuristic is "an IRI followed by whitespace then
  // anything that isn't `,`" since predicate-position IRIs follow a
  // predicate keyword and are surrounded differently. We approximate
  // by matching IRIs that appear at the start of a non-empty line
  // (after optional indentation).
  const lineHead = /^[ \t]*<((?:https?|urn):[^>\s]+)>/gm;
  let m: RegExpExecArray | null;
  while ((m = lineHead.exec(turtle)) !== null) {
    out.add(m[1]);
  }
  return [...out];
}
