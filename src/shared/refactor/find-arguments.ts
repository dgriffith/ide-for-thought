/**
 * "Find supporting / opposing arguments" (#409 + #410): for a given
 * thought:Claim, generate the strongest cases for or against it,
 * web-grounded.
 *
 * Pure shared piece — prompt builders + JSON response parser. The
 * orchestrator that calls the LLM and files the ProposalBundle lives in
 * `src/main/llm/find-arguments.ts`.
 *
 * Both polarities use the same shape and the same parser. The system
 * prompt diverges to enforce the anti-flattery rules per ticket:
 *   - support: don't soften the case if you disagree.
 *   - oppose: don't weaken the opposition just because the user prefers
 *     the original claim.
 */

export type Polarity = 'support' | 'oppose';

export type ArgumentStrength = 'strong' | 'moderate' | 'weak';

export const ARGUMENT_STRENGTHS: readonly ArgumentStrength[] = [
  'strong',
  'moderate',
  'weak',
] as const;

export interface ArgumentCitation {
  /** Verbatim URL the LLM cited. */
  url: string;
  /** Short snippet from the cited page that grounds the argument. May be empty if the model omitted it. */
  snippet: string;
}

export interface ArgumentRecord {
  /** 1-sentence summary of THIS argument (not the original claim). */
  label: string;
  /** Inferential structure — "X because Y because Z, so the claim follows". */
  structure: string;
  strength: ArgumentStrength;
  citations: ArgumentCitation[];
}

export type Verdict = 'arguments-found' | 'no-strong-arguments-found';

export interface FindArgumentsResult {
  verdict: Verdict;
  /** Human-readable prose summarising the case. Empty string when verdict is no-strong-arguments-found. */
  summary: string;
  /** May be empty when verdict is no-strong-arguments-found. */
  arguments: ArgumentRecord[];
}

export interface BuildFindArgumentsPromptArgs {
  polarity: Polarity;
  claimLabel: string;
  /** Optional verbatim source passage the claim was extracted from — useful context for the LLM. */
  claimSourceText?: string;
}

const SHARED_RULES = `
- Cite the web. Use the web_search and web_fetch tools to ground every argument; an argument without at least one citation is not strong enough to include.
- Distinguish argument strength from your personal confidence. Grade each argument as \`strong\`, \`moderate\`, or \`weak\` based on how good the argument is *as an argument* — not whether you find the original claim plausible overall.
- One claim per atom. Each entry in \`arguments\` should be a single inferential chain, not a bundle.
- If you genuinely cannot find at least one argument that meets the bar (cited, coherent, at least \`weak\`), return \`{"verdict": "no-strong-arguments-found", "summary": "", "arguments": []}\`. Returning a fake or padded list is a worse outcome than this verdict.

## Output

Return ONLY a JSON object of this shape — no prose, no code fence, no commentary:

{
  "verdict": "arguments-found" | "no-strong-arguments-found",
  "summary": "a few sentences of human-readable prose summarising the case (empty string when no arguments found)",
  "arguments": [
    {
      "label": "1-sentence claim of THIS argument",
      "structure": "the inferential chain — \\"X because Y because Z, so the original claim follows\\"",
      "strength": "strong" | "moderate" | "weak",
      "citations": [
        { "url": "https://example.com/article", "snippet": "verbatim quote from the cited page" }
      ]
    }
  ]
}
`.trim();

export function buildFindArgumentsSystemPrompt(polarity: Polarity): string {
  if (polarity === 'support') {
    return `You are helping a researcher audit a specific claim by surfacing the strongest cases **in favour of it**.

## Anti-flattery rule

Do NOT soften the case if you personally disagree with the claim. Do NOT inflate the case beyond what the citations actually support. If the genuine state of the evidence is "there are no strong supporting arguments here", say so via the no-strong-arguments-found verdict — that is a valid and useful answer.

${SHARED_RULES}`;
  }
  return `You are helping a researcher audit a specific claim by surfacing the strongest cases **against it**.

## Anti-flattery rule

Do NOT weaken the opposition because the user clearly prefers the original claim or because earlier conversation context suggests they want it defended. The user is explicitly asking you to argue the other side — your job is to do that as forcefully as the evidence allows. If you genuinely cannot find a strong opposing case, the no-strong-arguments-found verdict is the right answer; do not pad with weak rebuttals to look responsive.

${SHARED_RULES}`;
}

export function buildFindArgumentsUserMessage(args: BuildFindArgumentsPromptArgs): string {
  const polarityVerb = args.polarity === 'support' ? 'support' : 'rebut';
  const sourceBlock = args.claimSourceText
    ? `\n\n## Source passage (for context)\n\n> ${args.claimSourceText.split(/\r?\n/).map((l) => l).join('\n> ')}`
    : '';
  return `## Claim to ${polarityVerb}

${args.claimLabel}${sourceBlock}

Find the strongest arguments that ${polarityVerb} this claim. Web search is available; use it.`;
}

export interface ParseFindArgumentsResult {
  result: FindArgumentsResult | null;
  error: string;
}

export function parseFindArgumentsResponse(raw: string): ParseFindArgumentsResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { result: null, error: 'LLM returned an empty response.' };
  }

  const stripped = stripCodeFence(trimmed);

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (e) {
    return {
      result: null,
      error: `Could not parse LLM response as JSON: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { result: null, error: 'Response was not a JSON object.' };
  }
  const obj = parsed as Record<string, unknown>;

  const verdictRaw = typeof obj.verdict === 'string' ? obj.verdict : '';
  if (verdictRaw !== 'arguments-found' && verdictRaw !== 'no-strong-arguments-found') {
    return {
      result: null,
      error: `Unknown verdict: ${JSON.stringify(verdictRaw)}.`,
    };
  }
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';

  if (verdictRaw === 'no-strong-arguments-found') {
    return {
      result: { verdict: 'no-strong-arguments-found', summary, arguments: [] },
      error: '',
    };
  }

  const argsRaw = obj.arguments;
  if (!Array.isArray(argsRaw)) {
    return { result: null, error: '"arguments" was not an array.' };
  }

  const argumentRecords: ArgumentRecord[] = [];
  for (const a of argsRaw) {
    if (!a || typeof a !== 'object') continue;
    const rec = a as Record<string, unknown>;
    const label = typeof rec.label === 'string' ? rec.label.trim() : '';
    const structure = typeof rec.structure === 'string' ? rec.structure.trim() : '';
    const strengthRaw = typeof rec.strength === 'string' ? rec.strength.toLowerCase() : '';
    if (!label || !structure) continue;
    if (!isStrength(strengthRaw)) continue;
    argumentRecords.push({
      label,
      structure,
      strength: strengthRaw,
      citations: parseCitations(rec.citations),
    });
  }

  if (argumentRecords.length === 0) {
    // The LLM said "arguments-found" but every entry was malformed. That's
    // either a parse-bug-ish state or a genuine "I tried but had nothing".
    // Treat it as the explicit no-strong-arguments-found verdict so the
    // caller's UX is consistent.
    return {
      result: { verdict: 'no-strong-arguments-found', summary, arguments: [] },
      error: '',
    };
  }

  return {
    result: {
      verdict: 'arguments-found',
      summary,
      arguments: argumentRecords,
    },
    error: '',
  };
}

function parseCitations(raw: unknown): ArgumentCitation[] {
  if (!Array.isArray(raw)) return [];
  const out: ArgumentCitation[] = [];
  for (const c of raw) {
    if (!c || typeof c !== 'object') continue;
    const rec = c as Record<string, unknown>;
    const url = typeof rec.url === 'string' ? rec.url.trim() : '';
    const snippet = typeof rec.snippet === 'string' ? rec.snippet.trim() : '';
    if (!url) continue;
    if (!isHttpUrl(url)) continue;
    out.push({ url, snippet });
  }
  return out;
}

function isHttpUrl(s: string): boolean {
  return /^https?:\/\//i.test(s);
}

function isStrength(s: string): s is ArgumentStrength {
  return (ARGUMENT_STRENGTHS as readonly string[]).includes(s);
}

function stripCodeFence(s: string): string {
  const fence = /^```[a-zA-Z0-9_-]*\n?([\s\S]*?)\n?```$/;
  const m = fence.exec(s);
  return m ? m[1] : s;
}

/**
 * Extract the first absolute Minerva-style claim URI from a snippet of
 * text — used by the renderer to detect "is the cursor near a claim?"
 * before enabling the Find Supporting / Find Opposing menu items.
 *
 * Matches `<https://…/c/claim-…>` or bare `https://…/c/claim-…`. Returns
 * null when nothing matches. The caller is responsible for verifying the
 * URI actually resolves to a thought:Claim in the graph.
 */
export function extractClaimUri(text: string): string | null {
  const re = /<?(https?:\/\/[^\s<>"]*\/c\/claim-[^\s<>"]+)>?/i;
  const m = re.exec(text);
  return m ? m[1] : null;
}

/** Escape for use as a Turtle literal — same rules as decompose-claims. */
export function escapeTurtleLiteral(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n')
    .replace(/\t/g, '\\t');
}
