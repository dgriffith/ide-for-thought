/**
 * propose_compute helpers (#245), extracted from the IPC layer so they're
 * unit-testable without pulling in electron (#676). No electron imports here —
 * just the graph + turtle escaping + shared types. register-compute /
 * register-conversation import these for their handlers.
 */

import * as graph from '../graph/index';
import { type ProjectContext } from '../project-context-types';
import { escapeTurtleLiteral } from '../llm/turtle';
import type { ConversationComputeDraft } from '../../shared/conversation-compute-drafts';
import type { CellResult } from '../../shared/compute/types';

/**
 * Serialize a CellResult into a plain-text block the LLM can read on its next
 * turn. Tables get a small markdown rendering (capped at ~30 rows for sanity);
 * errors get a single-line marker; images are referenced by a placeholder
 * since the API can't see them inline here. The returned string is wrapped with
 * `[Output of <draftId>]` delimiters so the LLM (and a human reading the
 * transcript) can locate the section quickly.
 */
export function formatComputeResultAsContext(
  draft: ConversationComputeDraft,
  codeRan: string,
  result: CellResult,
): string {
  const header = `[Output of compute proposal ${draft.draftId} — ${draft.language}]`;
  const codeBlock = `\`\`\`${draft.language}\n${codeRan.trim()}\n\`\`\``;
  if (!result.ok) {
    return `${header}\n${codeBlock}\n\n**Error:** ${result.error}`;
  }
  const out = result.output;
  switch (out.type) {
    case 'text':
      return `${header}\n${codeBlock}\n\n\`\`\`\n${out.value}\n\`\`\``;
    case 'json':
      return `${header}\n${codeBlock}\n\n\`\`\`json\n${JSON.stringify(out.value, null, 2)}\n\`\`\``;
    case 'table': {
      const ROW_CAP = 30;
      const rows = out.rows.slice(0, ROW_CAP);
      const head = `| ${out.columns.join(' | ')} |`;
      const sep = `| ${out.columns.map(() => '---').join(' | ')} |`;
      const body = rows
        .map((r) => `| ${r.map((c) => formatTableCell(c)).join(' | ')} |`)
        .join('\n');
      const trailer = out.truncated || out.rows.length > ROW_CAP
        ? `\n\n(showing ${rows.length} of ${out.totalRows ?? out.rows.length} rows)`
        : '';
      return `${header}\n${codeBlock}\n\n${head}\n${sep}\n${body}${trailer}`;
    }
    case 'image':
      return `${header}\n${codeBlock}\n\n[image output: ${out.mime} — open the conversation panel to view]`;
    case 'html':
      // Pass HTML through verbatim; the LLM can read the markup but won't
      // render it. Truncate to a sane length so a giant table doesn't blow up
      // the next turn's context.
      return `${header}\n${codeBlock}\n\n\`\`\`html\n${out.html.slice(0, 4000)}\n\`\`\``;
  }
}

function formatTableCell(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value);
  }
  // Anything else (Date, object literal, etc.) — JSON-stringify rather than
  // risk "[object Object]" landing in the LLM context.
  try { return JSON.stringify(value); } catch { return ''; }
}

/**
 * Write the ComputeProposal triples into the graph. Called from the RUN handler
 * so every executed cell leaves an audit-trail record — the integrity stock
 * query verifies the LLM hasn't snuck a cell past review.
 */
export function recordComputeProposalRun(
  ctx: ProjectContext,
  draft: ConversationComputeDraft,
  codeRan: string,
): void {
  const proposalUri = `https://minerva.dev/ontology/thought#proposal/${draft.draftId}`;
  const convUri = `https://minerva.dev/ontology/thought#conversation/${draft.conversationId}`;
  const executedAt = new Date().toISOString();
  const turtle = `
    @prefix thought: <https://minerva.dev/ontology/thought#> .
    @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

    <${proposalUri}> a thought:ComputeProposal ;
      thought:proposalStatus thought:approved ;
      thought:proposedBy "llm:propose_compute" ;
      thought:proposedAt "${draft.createdAt}"^^xsd:dateTime ;
      thought:conversationRef <${convUri}> ;
      thought:language "${escapeTurtleLiteral(draft.language)}" ;
      thought:code "${escapeTurtleLiteral(draft.code)}" ;
      thought:executedCode "${escapeTurtleLiteral(codeRan)}" ;
      thought:executed "true"^^xsd:boolean ;
      thought:executedAt "${executedAt}"^^xsd:dateTime .
  `;
  graph.parseIntoStore(ctx, turtle);
}

/**
 * Build the markdown block for an Insert-into-notebook action. The provenance
 * comment line is parsed by the indexer when the LLM later asks `read_note` on
 * the destination — it sees the comment and knows which cells were LLM-proposed
 * vs. human-written.
 */
export function buildComputeProposalNoteBlock(
  draft: ConversationComputeDraft,
  codeToInsert: string,
): string {
  const provenance = [
    `<!-- compute-proposal:`,
    `  draft: ${draft.draftId}`,
    `  proposed_by: llm`,
    `  proposed_in_conversation: ${draft.conversationId}`,
    `  proposed_at: ${draft.createdAt}`,
    `  rationale: ${draft.rationale.replace(/-->/g, '--&gt;')}`,
    `-->`,
  ].join('\n');
  const fence = '```';
  return `${provenance}\n${fence}${draft.language}\n${codeToInsert.trim()}\n${fence}`;
}
