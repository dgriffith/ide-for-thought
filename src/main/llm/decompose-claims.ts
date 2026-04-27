/**
 * "Decompose into individual claims" orchestrator (#408).
 *
 * Calls the LLM with the user-selected passage, parses the JSON response
 * into typed claims, and files the result as a single approval-engine
 * proposal. The bundle has one `note` payload (a human-readable
 * decomposition summary) plus N `graph-triples` payloads (one
 * thought:Claim node per claim) — all-or-nothing through approve/reject.
 */

import { randomUUID } from 'node:crypto';
import { complete } from './index';
import { proposeWrite } from './approval';
import * as graph from '../graph/index';
import {
  buildDecomposeClaimsPrompt,
  parseDecomposeClaimsResponse,
  escapeTurtleLiteral,
  type DecomposedClaim,
} from '../../shared/refactor/decompose-claims';
import type { ProjectContext } from '../project-context-types';
import type { ProposalPayload } from './approval';

const EXTRACTED_BY = 'llm:decompose-claims';

export interface DecomposeClaimsArgs {
  /** The passage to analyse. Trimmed; an empty passage is a no-op. */
  passage: string;
  /** Source-note path, used to title the output note. Optional. */
  sourceRelPath?: string | null;
  /** What to attribute the proposal to. Defaults to llm:decompose-claims. */
  proposedBy?: string;
  /** Per-call model override. Falls back to the global default. */
  model?: string;
}

export interface DecomposeClaimsResult {
  claimCount: number;
  /** URI of the resulting Proposal. Null when the LLM returned no claims (no proposal filed). */
  proposalUri: string | null;
  /** Diagnostic populated when the LLM response couldn't be parsed; empty on success. */
  error: string;
}

export async function decomposeClaims(
  ctx: ProjectContext,
  args: DecomposeClaimsArgs,
): Promise<DecomposeClaimsResult> {
  const passage = args.passage.trim();
  if (!passage) {
    return { claimCount: 0, proposalUri: null, error: '' };
  }

  graph.enterLLMContext();
  try {
    const sourceTitle = deriveSourceTitle(args.sourceRelPath);
    const prompt = buildDecomposeClaimsPrompt({ sourceTitle, passage });

    const raw = await complete(prompt, args.model ? { model: args.model } : undefined);
    const { claims, error } = parseDecomposeClaimsResponse(raw);

    if (error) {
      return { claimCount: 0, proposalUri: null, error };
    }
    if (claims.length === 0) {
      return { claimCount: 0, proposalUri: null, error: '' };
    }

    const stem = sourceStem(args.sourceRelPath);
    const claimRecords = claims.map((c) => ({
      claim: c,
      uri: mintClaimUri(),
    }));

    const notePayload: ProposalPayload = {
      kind: 'note',
      relativePath: `notes/decomposition-of-${stem}.md`,
      content: buildNoteBody(sourceTitle, claimRecords),
    };

    const triplesPayloads: ProposalPayload[] = claimRecords.map(({ claim, uri }) => ({
      kind: 'graph-triples',
      turtle: buildClaimTurtle(uri, claim),
      affectsNodeUris: [uri],
    }));

    const proposal = await proposeWrite(ctx, {
      operationType: 'component_creation',
      payloads: [notePayload, ...triplesPayloads],
      note: `Decomposed ${claims.length} claim${claims.length === 1 ? '' : 's'}${
        sourceTitle ? ` from "${sourceTitle}"` : ''
      }`,
      proposedBy: args.proposedBy ?? EXTRACTED_BY,
    });

    return {
      claimCount: claims.length,
      proposalUri: proposal?.uri ?? null,
      error: '',
    };
  } finally {
    graph.exitLLMContext();
  }
}

function deriveSourceTitle(sourceRelPath?: string | null): string {
  if (!sourceRelPath) return '';
  const base = sourceRelPath.split('/').pop() ?? sourceRelPath;
  return base.replace(/\.md$/i, '');
}

function sourceStem(sourceRelPath?: string | null): string {
  const title = deriveSourceTitle(sourceRelPath);
  if (!title) return 'passage';
  return slugify(title);
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'passage';
}

function mintClaimUri(): string {
  return `https://minerva.dev/c/claim-${randomUUID()}`;
}

interface ClaimRecord {
  claim: DecomposedClaim;
  uri: string;
}

function buildNoteBody(sourceTitle: string, records: ClaimRecord[]): string {
  const heading = sourceTitle
    ? `# Decomposition: ${sourceTitle}\n`
    : `# Decomposition\n`;
  const lead = sourceTitle
    ? `Extracted from [[${sourceTitle}]].\n`
    : `Extracted from selected passage.\n`;

  const claimSections = records.map(({ claim, uri }, i) => {
    const quoted = claim.sourceText
      .split(/\r?\n/)
      .map((line) => `> ${line}`)
      .join('\n');
    return [
      `## ${i + 1}. ${claim.label}`,
      ``,
      `_kind:_ \`${claim.kind}\``,
      ``,
      quoted,
      ``,
      `<${uri}>`,
    ].join('\n');
  });

  return `${heading}\n${lead}\n## Claims\n\n${claimSections.join('\n\n')}\n`;
}

function buildClaimTurtle(uri: string, claim: DecomposedClaim): string {
  return [
    `<${uri}> a thought:Claim ;`,
    `  thought:label "${escapeTurtleLiteral(claim.label)}" ;`,
    `  thought:sourceText "${escapeTurtleLiteral(claim.sourceText)}" ;`,
    `  thought:claimKind "${claim.kind}" ;`,
    `  thought:extractedBy "${EXTRACTED_BY}" ;`,
    `  thought:hasStatus thought:proposed .`,
  ].join('\n');
}
