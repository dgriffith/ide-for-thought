import { randomUUID } from 'node:crypto';
import * as fs from '../../notebase/fs';
import { excerptIdFor } from '../../sources/create-excerpt';
import {
  CLAIM_KINDS,
  type ClaimKind,
  type ConversationClaimsDraft,
  type DraftClaim,
  type ProposeClaimsInput,
} from '../../../shared/conversation-claims-drafts';
import type { NotebaseTool, ToolContext, ToolCallbacks } from './types';

/**
 * Trust-principle parity with the other draft tools (#104):
 * `propose_claims` does NOT write. It reads the source body, resolves each
 * quote to an excerpt id + char range, emits a `ConversationClaimsDraft` for
 * inline review, and returns "drafted." The
 * `CONVERSATION_FILE_CLAIMS_DRAFT` handler files claim notes + excerpt nodes
 * through the approval engine once the user approves.
 */
async function runProposeClaims(
  ctx: ToolContext,
  input: unknown,
  callbacks: ToolCallbacks,
): Promise<{ content: string; isError: boolean }> {
  if (!callbacks.onClaimsDraft) {
    return { content: 'propose_claims is only available in conversation contexts.', isError: true };
  }
  if (!ctx.conversationId) {
    return { content: 'propose_claims requires a bound conversation id.', isError: true };
  }
  const parsed = parseProposeClaimsInput(input);
  if ('error' in parsed) {
    return { content: parsed.error, isError: true };
  }

  // Read the source body so each quote can be anchored by char range. A
  // missing body isn't fatal — claims still file, just quote-anchored.
  let body = '';
  try {
    body = await fs.readFile(ctx.rootPath, `.minerva/sources/${parsed.sourceId}/body.md`);
  } catch { /* no body.md — offsets stay unset */ }

  const claims: DraftClaim[] = parsed.claims.map((c) => {
    const quote = c.quote.trim();
    const idx = body ? body.indexOf(quote) : -1;
    const found = idx >= 0;
    return {
      text: c.text.trim(),
      kind: c.kind,
      quote,
      confidence: c.confidence,
      excerptId: excerptIdFor(parsed.sourceId, quote),
      quoteFound: found,
      ...(found ? { charStart: idx, charEnd: idx + quote.length } : {}),
    };
  });

  const draft: ConversationClaimsDraft = {
    draftId: `claimsdraft-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: parsed.note,
    sourceId: parsed.sourceId,
    claims,
    createdAt: new Date().toISOString(),
  };
  callbacks.onClaimsDraft(draft);

  const approx = claims.filter((c) => !c.quoteFound).length;
  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      sourceId: parsed.sourceId,
      claimCount: claims.length,
      quotesNotAnchored: approx,
      hint:
        'STOP. The claims have been queued for user review. End this turn with ' +
        'ONE short acknowledgement sentence and DO NOT call propose_claims ' +
        'again. DO NOT call any other tool. DO NOT repeat the claims inline.',
    }) + `\n\n(queued ${claims.length} claim(s) for ${parsed.sourceId}${approx ? `, ${approx} quote(s) not verbatim` : ''})`,
    isError: false,
  };
}

function parseProposeClaimsInput(
  input: unknown,
): ProposeClaimsInput | { error: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'propose_claims input must be an object.' };
  }
  const obj = input as Record<string, unknown>;
  const note = typeof obj.note === 'string' ? obj.note.trim() : '';
  if (!note) return { error: '`note` is required and must be a non-empty string.' };
  const sourceId = typeof obj.sourceId === 'string' ? obj.sourceId.trim() : '';
  if (!sourceId) return { error: '`sourceId` is required and must be a non-empty string.' };
  if (!Array.isArray(obj.claims) || obj.claims.length === 0) {
    return { error: '`claims` must be a non-empty array. If you have no claims to '
      + 'extract, reply to the user in plain text instead.' };
  }
  const claims: ProposeClaimsInput['claims'] = [];
  for (const raw of obj.claims) {
    if (!raw || typeof raw !== 'object') return { error: 'Each claim must be an object.' };
    const c = raw as Record<string, unknown>;
    const text = typeof c.text === 'string' ? c.text.trim() : '';
    if (!text) return { error: 'Each claim needs a non-empty `text`.' };
    const quote = typeof c.quote === 'string' ? c.quote.trim() : '';
    if (!quote) return { error: `claim "${text.slice(0, 40)}": a non-empty \`quote\` is required.` };
    const kind = typeof c.kind === 'string' ? c.kind : '';
    if (!(CLAIM_KINDS as readonly string[]).includes(kind)) {
      return { error: `claim "${text.slice(0, 40)}": \`kind\` must be one of ${CLAIM_KINDS.join(', ')}.` };
    }
    const confidence = typeof c.confidence === 'number' ? c.confidence : NaN;
    if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) {
      return { error: `claim "${text.slice(0, 40)}": \`confidence\` must be a number in [0, 1].` };
    }
    claims.push({ text, kind: kind as ClaimKind, quote, confidence });
  }
  return { note, sourceId, claims };
}

export const proposeClaims: NotebaseTool = {
  definition: {
    name: 'propose_claims',
    description:
      'Propose the key claims a SOURCE makes, each anchored to a supporting ' +
      'excerpt. Use this when asked to extract / mine claims from a source. ' +
      'The user reviews the list as an inline card; on Approve, each claim is ' +
      'filed as a thought:Claim note that cites a thought:Excerpt (anchored ' +
      'into the body) and carries its confidence. On Discard nothing is ' +
      'written.\n' +
      '\n' +
      'For each claim, the `quote` MUST be copied **verbatim** from the source ' +
      'body — it is used to locate and anchor the excerpt; a paraphrase will ' +
      'still file but loses the character-range anchor. Extract the *key* ' +
      'claims, not every atom. The `sourceId` is given in the conversation ' +
      'context; pass it through verbatim. Submit ONE call.',
    input_schema: {
      type: 'object',
      properties: {
        note: {
          type: 'string',
          description:
            'A short sentence describing what you are proposing. Surfaced to ' +
            'the user on the inline review card.',
        },
        sourceId: {
          type: 'string',
          description: 'Id of the source the claims come from (from context).',
        },
        claims: {
          type: 'array',
          minItems: 1,
          maxItems: 64,
          items: {
            type: 'object',
            properties: {
              text: { type: 'string', description: 'The claim as a concise assertion.' },
              kind: {
                type: 'string',
                enum: ['factual', 'evaluative', 'definitional', 'predictive'],
                description: 'factual (a state of the world), evaluative (a value judgment), definitional (what a term means), or predictive (what will happen).',
              },
              quote: {
                type: 'string',
                description: 'A verbatim passage from the source body that supports the claim.',
              },
              confidence: {
                type: 'number',
                minimum: 0,
                maximum: 1,
                description: 'Your confidence (0–1) that the source actually makes this claim.',
              },
            },
            required: ['text', 'kind', 'quote', 'confidence'],
          },
        },
      },
      required: ['note', 'sourceId', 'claims'],
    },
  },
  run: (ctx, input, callbacks) => runProposeClaims(ctx, input, callbacks),
};
