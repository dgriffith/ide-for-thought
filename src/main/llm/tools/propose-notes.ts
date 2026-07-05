import { randomUUID } from 'node:crypto';
import { fixupBundleLinks } from '../../../shared/refactor/bundle-link-fixup';
import type {
  ConversationDraft,
  DraftPayload,
  ProposeNotesInput,
} from '../../../shared/conversation-drafts';
import type { NotebaseTool, ToolContext, ToolCallbacks } from './types';

/**
 * The propose_notes tool deliberately does NOT call proposeWrite. Doing
 * so here would file the bundle behind the user's back, which violates
 * the trust principle ("LLM proposes, human approves"). Instead it
 * builds a ConversationDraft, hands it to the renderer via the
 * onDraft callback, and returns to the model with a brief
 * acknowledgement.
 */
function runProposeNotes(
  ctx: ToolContext,
  input: unknown,
  callbacks: ToolCallbacks,
): { content: string; isError: boolean } {
  if (!callbacks.onDraft) {
    return {
      content: 'propose_notes is only available in conversation contexts.',
      isError: true,
    };
  }
  if (!ctx.conversationId) {
    return {
      content: 'propose_notes requires a bound conversation id.',
      isError: true,
    };
  }
  const parsed = parseProposeNotesInput(input);
  if ('error' in parsed) {
    return { content: parsed.error, isError: true };
  }

  // Models routinely pick human-readable relativePaths ("Sets, Functions,
  // and the Need for Types.md") and link them with shorter convenience
  // names ("[[stop-1]]") — those don't resolve. Walk the bundle and
  // rewrite inter-bundle wiki-links so they target sibling basenames.
  const fixup = fixupBundleLinks(
    parsed.payloads.map((p) => ({ relativePath: p.relativePath, content: p.content })),
  );
  if (fixup.rewritten.length > 0) {
    console.log(
      `[propose_notes] rewrote ${fixup.rewritten.reduce((n, r) => n + r.rewrites.length, 0)} ` +
      `inter-bundle wiki-link(s) across ${fixup.rewritten.length} note(s)`,
    );
  }
  const fixedPayloads: DraftPayload[] = parsed.payloads.map((p, i) => ({
    kind: 'note',
    relativePath: p.relativePath,
    content: fixup.notes[i]!.content, // fixup.notes is 1:1 with parsed.payloads
  }));

  const draft: ConversationDraft = {
    draftId: `draft-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: parsed.note,
    payloads: fixedPayloads,
    createdAt: new Date().toISOString(),
  };
  callbacks.onDraft(draft);

  const titles = parsed.payloads.map((p) => p.relativePath).join(', ');
  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      noteCount: parsed.payloads.length,
      paths: parsed.payloads.map((p) => p.relativePath),
      // Be very explicit about stopping. An ambiguous "continue naturally"
      // hint led the model into a tool-use loop — calling propose_notes
      // again, and again, and again, up to maxIterations.
      hint: 'STOP. The bundle has been queued for user review. End this turn with ONE short acknowledgement sentence ("Drafted N notes for review.") and DO NOT call propose_notes again in this turn. DO NOT call any other tool. DO NOT repeat the note contents inline.',
    }) + `\n\n(filed as draft: ${titles})`,
    isError: false,
  };
}

function parseProposeNotesInput(
  input: unknown,
): ProposeNotesInput | { error: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'propose_notes input must be an object.' };
  }
  const obj = input as Record<string, unknown>;
  const note = typeof obj.note === 'string' ? obj.note.trim() : '';
  if (!note) return { error: '`note` is required and must be a non-empty string.' };
  if (!Array.isArray(obj.payloads) || obj.payloads.length === 0) {
    return {
      error: '`payloads` must be a non-empty array. If you have no concrete notes '
        + 'to file, do NOT call propose_notes — reply to the user in plain markdown '
        + 'text instead.',
    };
  }
  const payloads: DraftPayload[] = [];
  for (const raw of obj.payloads) {
    if (!raw || typeof raw !== 'object') {
      return { error: 'Each payload must be an object.' };
    }
    const p = raw as Record<string, unknown>;
    if (p.kind !== 'note') {
      return { error: `Unsupported payload kind: ${String(p.kind)}. Only "note" is supported today.` };
    }
    const relativePath = typeof p.relativePath === 'string' ? p.relativePath.trim() : '';
    const content = typeof p.content === 'string' ? p.content : '';
    if (!relativePath) return { error: 'payload.relativePath is required.' };
    if (!content) return { error: 'payload.content is required.' };
    if (relativePath.includes('..') || relativePath.startsWith('/') || relativePath.startsWith('\\')) {
      return { error: `Unsafe relativePath: ${relativePath}` };
    }
    payloads.push({ kind: 'note', relativePath, content });
  }
  return { note, payloads };
}

export const proposeNotes: NotebaseTool = {
  definition: {
    name: 'propose_notes',
    description:
      'Propose one or more new notes for the user to review. Use this when ' +
      'you want to file structured prose into the thoughtbase (e.g. a ' +
      'learning-journey index + per-stop child notes, an explanation broken ' +
      'into linked sub-notes, a summary of a research finding). The user ' +
      'reviews the bundle as an inline card; Approve files them through the ' +
      'standard approval engine, Reject discards.\n' +
      '\n' +
      'CRITICAL — wiki-link rule: when one note in the bundle links to another, ' +
      'the wiki-link target MUST be the basename of the OTHER note\'s ' +
      'relativePath (filename without the .md extension), spelled IDENTICALLY. ' +
      'Wiki-link resolution is exact-match on basename — `[[Sets, Functions, ' +
      'and the Need for Types]]` only resolves to ' +
      '`notes/.../Sets, Functions, and the Need for Types.md`. Pick paths and ' +
      'link targets together, in one pass; do not invent friendlier names for ' +
      'links. Bad: `[[stop-1]]` while the file is `notes/.../Sets, Functions, ' +
      'and the Need for Types.md`. Good: `[[Sets, Functions, and the Need for ' +
      'Types]]`. Prefer paths without commas/punctuation in the basename if you ' +
      'can — they\'re easier to link to.',
    input_schema: {
      type: 'object',
      properties: {
        note: {
          type: 'string',
          description:
            'A short sentence describing why you are proposing this bundle. ' +
            'Surfaced to the user on the inline review card.',
        },
        payloads: {
          type: 'array',
          minItems: 1,
          maxItems: 64,
          description: 'One or more note payloads to file. Use a single propose_notes call for the whole bundle (parent + children) rather than several calls — the user reviews the bundle as one card.',
          items: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: ['note'],
                description: 'Only "note" is supported today.',
              },
              relativePath: {
                type: 'string',
                description:
                  'Project-relative target path, e.g. "notes/distributed-consensus/raft.md". ' +
                  'Apply-time collision dedup will append "-2" if a file already exists at the path. ' +
                  'Pick basenames you are willing to use as wiki-link targets unchanged — see CRITICAL rule in the tool description.',
              },
              content: {
                type: 'string',
                description:
                  'Full note body in GitHub-flavored markdown. Include a level-1 heading and any frontmatter you want. ' +
                  'When linking to a sibling note in this same bundle, use [[<basename>]] where <basename> is the OTHER ' +
                  'payload\'s relativePath without the trailing ".md" — spelled IDENTICALLY (capitalisation, punctuation, spaces).',
              },
            },
            required: ['kind', 'relativePath', 'content'],
          },
        },
      },
      required: ['note', 'payloads'],
    },
  },
  run: (ctx, input, callbacks) => runProposeNotes(ctx, input, callbacks),
};
