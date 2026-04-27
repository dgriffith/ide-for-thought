/**
 * "Find supporting / opposing arguments" orchestrator (#409 + #410).
 *
 * Looks up the target Claim from the graph, asks the LLM (with web
 * tools enabled) to enumerate the strongest cases for or against it,
 * and files the result as a single approval-engine Proposal:
 *   - one `note` payload (prose summary + per-argument breakdown)
 *   - N `graph-triples` payloads (one thought:Grounds each, linked via
 *     thought:supports or thought:rebuts to the original Claim, with
 *     thought:hasCitation triples for every URL the LLM cited).
 *
 * If the LLM returns the no-strong-arguments-found verdict (anti-flattery
 * rule from the tickets — empty is a valid answer), no Proposal is
 * filed; the caller surfaces the verdict directly to the user.
 *
 * Trust-gated as `evidence_link` → `requires_approval`.
 */

import { randomUUID } from 'node:crypto';
import { completeWithTools } from './index';
import { proposeWrite } from './approval';
import * as graph from '../graph/index';
import { queryGraph } from '../graph/index';
import {
  buildFindArgumentsSystemPrompt,
  buildFindArgumentsUserMessage,
  parseFindArgumentsResponse,
  escapeTurtleLiteral,
  type ArgumentRecord,
  type Polarity,
  type Verdict,
} from '../../shared/refactor/find-arguments';
import type { ProjectContext } from '../project-context-types';
import type { ProposalPayload } from './approval';

export interface FindArgumentsArgs {
  polarity: Polarity;
  /** URI of the existing thought:Claim to argue for/against. Must resolve in the graph. */
  claimUri: string;
  /** Per-call model override. Falls back to the global default. */
  model?: string;
  /** What to attribute the proposal to. Default depends on polarity. */
  proposedBy?: string;
}

export interface FindArgumentsResultPayload {
  verdict: Verdict;
  argumentCount: number;
  /** URI of the resulting Proposal. Null when the verdict was no-strong-arguments-found. */
  proposalUri: string | null;
  /** Diagnostic populated when the LLM response couldn't be parsed; empty on success. */
  error: string;
}

export async function findArguments(
  ctx: ProjectContext,
  args: FindArgumentsArgs,
): Promise<FindArgumentsResultPayload> {
  graph.enterLLMContext();
  try {
    const claim = await loadClaim(ctx, args.claimUri);
    if (!claim) {
      return {
        verdict: 'no-strong-arguments-found',
        argumentCount: 0,
        proposalUri: null,
        error: `No thought:Claim found at <${args.claimUri}>.`,
      };
    }

    const system = buildFindArgumentsSystemPrompt(args.polarity);
    const userMessage = buildFindArgumentsUserMessage({
      polarity: args.polarity,
      claimLabel: claim.label,
      claimSourceText: claim.sourceText,
    });

    const { text } = await completeWithTools({
      system,
      messages: [{ role: 'user', content: userMessage }],
      toolContext: { rootPath: ctx.rootPath },
      ...(args.model ? { model: args.model } : {}),
    });

    const { result, error } = parseFindArgumentsResponse(text);
    if (error || !result) {
      return {
        verdict: 'no-strong-arguments-found',
        argumentCount: 0,
        proposalUri: null,
        error: error || 'Empty result from parser.',
      };
    }

    if (result.verdict === 'no-strong-arguments-found') {
      // Anti-flattery rule: an empty verdict is a real answer, not a
      // failure — no Proposal is filed. The caller surfaces the verdict
      // and summary back to the user.
      return {
        verdict: 'no-strong-arguments-found',
        argumentCount: 0,
        proposalUri: null,
        error: '',
      };
    }

    const groundsRecords = result.arguments.map((arg) => ({
      arg,
      uri: mintGroundsUri(),
    }));

    const proposedBy = args.proposedBy ?? extractedBy(args.polarity);
    const notePayload: ProposalPayload = {
      kind: 'note',
      relativePath: noteRelPath(args.polarity, claim.label),
      content: buildNoteBody(args.polarity, claim.label, result.summary, groundsRecords),
    };
    const triplesPayloads: ProposalPayload[] = groundsRecords.map(({ arg, uri }) => ({
      kind: 'graph-triples',
      turtle: buildGroundsTurtle(args.polarity, args.claimUri, uri, arg, proposedBy),
      affectsNodeUris: [uri],
    }));

    const proposal = await proposeWrite(ctx, {
      operationType: 'evidence_link',
      payloads: [notePayload, ...triplesPayloads],
      note: `${verbForNote(args.polarity)} ${result.arguments.length} argument${
        result.arguments.length === 1 ? '' : 's'
      } for "${truncate(claim.label, 80)}"`,
      proposedBy,
    });

    return {
      verdict: 'arguments-found',
      argumentCount: result.arguments.length,
      proposalUri: proposal?.uri ?? null,
      error: '',
    };
  } finally {
    graph.exitLLMContext();
  }
}

interface LoadedClaim {
  label: string;
  sourceText: string;
}

async function loadClaim(ctx: ProjectContext, claimUri: string): Promise<LoadedClaim | null> {
  const r = await queryGraph(ctx, `
    PREFIX thought: <https://minerva.dev/ontology/thought#>
    SELECT ?label ?sourceText WHERE {
      <${claimUri}> a thought:Claim ;
                    thought:label ?label .
      OPTIONAL { <${claimUri}> thought:sourceText ?sourceText . }
    } LIMIT 1
  `);
  const rows = r.results as Array<{ label: string; sourceText?: string }>;
  if (rows.length === 0) return null;
  return {
    label: rows[0].label ?? '',
    sourceText: rows[0].sourceText ?? '',
  };
}

function extractedBy(polarity: Polarity): string {
  return polarity === 'support'
    ? 'llm:find-supporting-arguments'
    : 'llm:find-opposing-arguments';
}

function verbForNote(polarity: Polarity): string {
  return polarity === 'support' ? 'Found' : 'Found';
}

function noteRelPath(polarity: Polarity, claimLabel: string): string {
  const stem = slugify(claimLabel) || 'claim';
  const tag = polarity === 'support' ? 'supporting' : 'opposing';
  return `notes/${tag}-arguments-for-${stem}.md`;
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function mintGroundsUri(): string {
  return `https://minerva.dev/c/grounds-${randomUUID()}`;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

function buildNoteBody(
  polarity: Polarity,
  claimLabel: string,
  summary: string,
  records: Array<{ arg: ArgumentRecord; uri: string }>,
): string {
  const heading = polarity === 'support'
    ? `# Supporting arguments for: ${claimLabel}`
    : `# Opposing arguments for: ${claimLabel}`;

  const summaryBlock = summary ? `\n${summary}\n` : '';
  const argSections = records.map(({ arg, uri }, i) => {
    const cites = arg.citations.length > 0
      ? `\n\n**Citations:**\n` + arg.citations
        .map((c) => c.snippet
          ? `- [${c.url}](${c.url}) — "${c.snippet}"`
          : `- [${c.url}](${c.url})`,
        ).join('\n')
      : '\n\n_No citations._';
    return [
      `## ${i + 1}. ${arg.label}`,
      ``,
      `_strength:_ \`${arg.strength}\``,
      ``,
      arg.structure,
      cites,
      ``,
      `<${uri}>`,
    ].join('\n');
  });

  return `${heading}\n${summaryBlock}\n## Arguments\n\n${argSections.join('\n\n')}\n`;
}

function buildGroundsTurtle(
  polarity: Polarity,
  claimUri: string,
  groundsUri: string,
  arg: ArgumentRecord,
  proposedBy: string,
): string {
  const linkPredicate = polarity === 'support' ? 'thought:supports' : 'thought:rebuts';
  const lines = [
    `<${groundsUri}> a thought:Grounds ;`,
    `  thought:label "${escapeTurtleLiteral(arg.label)}" ;`,
    `  thought:argumentStructure "${escapeTurtleLiteral(arg.structure)}" ;`,
    `  thought:strength "${arg.strength}" ;`,
    `  ${linkPredicate} <${claimUri}> ;`,
    `  thought:extractedBy "${proposedBy}" ;`,
    `  thought:hasStatus thought:proposed .`,
  ];
  for (const c of arg.citations) {
    lines.push(`<${groundsUri}> thought:hasCitation <${c.url}> .`);
  }
  return lines.join('\n');
}
