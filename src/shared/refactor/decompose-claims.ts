/**
 * "Decompose into individual claims" (#408): pull every distinct
 * assertion out of a passage as its own typed thought:Claim.
 *
 * This file is the pure shared piece — prompt builder, response parser,
 * and the canonical claim-record shape. The main-side orchestrator
 * (src/main/llm/decompose-claims.ts) handles the LLM call + builds the
 * ProposalBundle; the apply path is whatever the approval engine does
 * with that bundle.
 */

export type ClaimKind = 'factual' | 'evaluative' | 'definitional' | 'predictive';

export const CLAIM_KINDS: readonly ClaimKind[] = [
  'factual',
  'evaluative',
  'definitional',
  'predictive',
] as const;

export interface DecomposedClaim {
  /** 1-2 sentence summary the LLM wrote for this claim. */
  label: string;
  /** Verbatim passage the claim was lifted from. */
  sourceText: string;
  kind: ClaimKind;
}

export interface BuildDecomposeClaimsPromptArgs {
  /** Optional human-readable label for the source. Used to orient the LLM, not parsed back. */
  sourceTitle?: string;
  /** The passage to decompose. Required and non-empty. */
  passage: string;
}

export function buildDecomposeClaimsPrompt(args: BuildDecomposeClaimsPromptArgs): string {
  const titleLine = args.sourceTitle
    ? `## Source: ${args.sourceTitle}\n\n`
    : '';
  return `You are decomposing a passage into the individual **claims** it makes.

A claim is one distinct assertion presented as true. Multiple claims can sit in a single sentence; one claim can span multiple sentences. Treat each as its own atom so the reader can audit them one by one.

## Output

Return ONLY a JSON object of this shape — no prose, no code fence, no commentary:

{
  "claims": [
    {
      "label": "1-2 sentence summary of the claim, in your own words",
      "sourceText": "the verbatim text the claim came from (quote it exactly)",
      "kind": "factual" | "evaluative" | "definitional" | "predictive"
    }
  ]
}

## Kinds

- **factual** — asserts something is the case in the world ("the meeting was at 3pm", "X causes Y")
- **evaluative** — asserts a value judgment ("this approach is better", "the report is misleading")
- **definitional** — asserts what a term means ("a heuristic is a rule of thumb")
- **predictive** — asserts what will happen ("rates will rise next quarter", "this will fail")

## Rules

- Verbatim quotes only in \`sourceText\`. Do not paraphrase that field.
- One claim per atom. Do not coalesce two assertions into one entry.
- Skip questions, hedges ("I'm not sure if…"), and pure rhetorical moves — they are not claims.
- If the passage contains no claims at all, return \`{"claims": []}\`.

${titleLine}## Passage

${args.passage}`;
}

export interface ParseDecomposeClaimsResult {
  claims: DecomposedClaim[];
  /** Diagnostic message when the response couldn't be parsed. Empty string on success. */
  error: string;
}

export function parseDecomposeClaimsResponse(raw: string): ParseDecomposeClaimsResult {
  const trimmed = raw.trim();
  if (!trimmed) return { claims: [], error: '' };

  // Tolerate the model wrapping the JSON in a ```json fence even though
  // the prompt asks not to. Strip the fence if present.
  const stripped = stripCodeFence(trimmed);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (e) {
    return {
      claims: [],
      error: `Could not parse LLM response as JSON: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!parsed || typeof parsed !== 'object' || !('claims' in parsed)) {
    return { claims: [], error: 'Response missing "claims" array.' };
  }
  const claimsRaw: unknown = parsed.claims;
  if (!Array.isArray(claimsRaw)) {
    return { claims: [], error: '"claims" was not an array.' };
  }

  const claims: DecomposedClaim[] = [];
  for (const c of claimsRaw) {
    if (!c || typeof c !== 'object') continue;
    const rec = c as Record<string, unknown>;
    const label = typeof rec.label === 'string' ? rec.label.trim() : '';
    const sourceText = typeof rec.sourceText === 'string' ? rec.sourceText.trim() : '';
    const kindRaw = typeof rec.kind === 'string' ? rec.kind.toLowerCase() : '';
    if (!label || !sourceText) continue;
    if (!isClaimKind(kindRaw)) continue;
    claims.push({ label, sourceText, kind: kindRaw });
  }

  return { claims, error: '' };
}

function isClaimKind(s: string): s is ClaimKind {
  return (CLAIM_KINDS as readonly string[]).includes(s);
}

function stripCodeFence(s: string): string {
  // Match ``` or ```json (any language tag), and the closing ```.
  const fence = /^```[a-zA-Z0-9_-]*\n?([\s\S]*?)\n?```$/;
  const m = fence.exec(s);
  return m ? m[1] : s;
}

/**
 * Escape a string for use as a Turtle literal. Handles the backslash,
 * double-quote, newline, and tab cases — enough for label and sourceText
 * fields where the LLM may include quotes or paragraph breaks.
 */
export function escapeTurtleLiteral(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}
