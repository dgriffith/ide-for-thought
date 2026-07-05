import { randomUUID } from 'node:crypto';
import type {
  ConversationSourcePropertyDraft,
  ProposeSourcePropertiesInput,
} from '../../../shared/conversation-source-property-drafts';
import type { NotebaseTool, ToolContext, ToolCallbacks } from './types';

/**
 * Trust-principle parity with `set_properties`, for sources (#103):
 * `propose_source_properties` does NOT write. It validates the proposal, emits
 * a `ConversationSourcePropertyDraft` for inline review, and returns "drafted."
 * The `CONVERSATION_FILE_SOURCE_PROPERTY_DRAFT` handler upserts the predicates
 * once the user approves.
 */
function runProposeSourceProperties(
  ctx: ToolContext,
  input: unknown,
  callbacks: ToolCallbacks,
): { content: string; isError: boolean } {
  if (!callbacks.onSourcePropertyDraft) {
    return {
      content: 'propose_source_properties is only available in conversation contexts.',
      isError: true,
    };
  }
  if (!ctx.conversationId) {
    return {
      content: 'propose_source_properties requires a bound conversation id.',
      isError: true,
    };
  }
  const parsed = parseProposeSourcePropertiesInput(input);
  if ('error' in parsed) {
    return { content: parsed.error, isError: true };
  }

  const draft: ConversationSourcePropertyDraft = {
    draftId: `srcpropdraft-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: parsed.note,
    sourceId: parsed.sourceId,
    ...(parsed.abstract !== undefined ? { abstract: parsed.abstract } : {}),
    ...(parsed.tldr !== undefined ? { tldr: parsed.tldr } : {}),
    createdAt: new Date().toISOString(),
  };
  callbacks.onSourcePropertyDraft(draft);

  const proposed = [parsed.abstract ? 'abstract' : null, parsed.tldr ? 'tldr' : null]
    .filter(Boolean)
    .join(' + ');
  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      sourceId: parsed.sourceId,
      proposed: { abstract: !!parsed.abstract, tldr: !!parsed.tldr },
      // Same anti-loop hint as the other draft-emitting tools.
      hint:
        'STOP. The source summary has been queued for user review. End this ' +
        'turn with ONE short acknowledgement sentence and DO NOT call ' +
        'propose_source_properties again. DO NOT call any other tool. DO NOT ' +
        'repeat the abstract/tldr text inline.',
    }) + `\n\n(queued source-property draft for ${parsed.sourceId}: ${proposed})`,
    isError: false,
  };
}

function parseProposeSourcePropertiesInput(
  input: unknown,
): ProposeSourcePropertiesInput | { error: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'propose_source_properties input must be an object.' };
  }
  const obj = input as Record<string, unknown>;
  const note = typeof obj.note === 'string' ? obj.note.trim() : '';
  if (!note) return { error: '`note` is required and must be a non-empty string.' };
  const sourceId = typeof obj.sourceId === 'string' ? obj.sourceId.trim() : '';
  if (!sourceId) return { error: '`sourceId` is required and must be a non-empty string.' };
  const abstract = typeof obj.abstract === 'string' ? obj.abstract.trim() : '';
  const tldr = typeof obj.tldr === 'string' ? obj.tldr.trim() : '';
  if (!abstract && !tldr) {
    return { error: 'Provide at least one of `abstract` or `tldr`.' };
  }
  const out: ProposeSourcePropertiesInput = { note, sourceId };
  if (abstract) out.abstract = abstract;
  if (tldr) out.tldr = tldr;
  return out;
}

export const proposeSourceProperties: NotebaseTool = {
  definition: {
    name: 'propose_source_properties',
    description:
      'Propose summary metadata for a SOURCE (not a note): a formal ' +
      '`abstract` and/or a one-paragraph plain-language `tldr`. Use this ' +
      'when asked to summarize a source. The user reviews the proposal as ' +
      'an inline card; on Approve, `dc:abstract` / `thought:tldr` are ' +
      "written to the source's metadata and the graph re-indexed. On " +
      'Discard nothing is written.\n' +
      '\n' +
      'Provide at least one of `abstract` / `tldr`. Submit ONE call for the ' +
      'source — do not call it repeatedly. The `sourceId` is given to you in ' +
      'the conversation context; pass it through verbatim.',
    input_schema: {
      type: 'object',
      properties: {
        note: {
          type: 'string',
          description:
            'A short sentence describing what you are proposing. Surfaced ' +
            'to the user on the inline review card.',
        },
        sourceId: {
          type: 'string',
          description:
            'Id of the source to annotate (provided in the conversation ' +
            'context). Must match an existing source.',
        },
        abstract: {
          type: 'string',
          description:
            'A concise scholarly abstract (1–2 paragraphs), written in the ' +
            "source's own register. Omit if you are only proposing a TL;DR.",
        },
        tldr: {
          type: 'string',
          description:
            'A single plain-language paragraph a non-expert could follow — ' +
            'the "what is this and why does it matter" gist. Omit if you ' +
            'are only proposing an abstract.',
        },
      },
      required: ['note', 'sourceId'],
    },
  },
  run: (ctx, input, callbacks) => runProposeSourceProperties(ctx, input, callbacks),
};
