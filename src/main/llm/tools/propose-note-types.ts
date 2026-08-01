import { proposeNoteTypings, type TypingAssignment } from '../infer-types';
import type { NotebaseTool, ToolContext, ToolCallbacks } from './types';

/**
 * `propose_note_types` (#1075) — migrate untyped notes to registry types. Unlike
 * the inline-card tools, this files pending `thought:Proposal` nodes DIRECTLY
 * (one per note) that land in the Proposals panel's diff view for per-note
 * approval. Approving sets `type:`; rejecting leaves the note untyped. It only
 * assigns EXISTING stock/user types — never invents one.
 */
async function runProposeNoteTypes(
  ctx: ToolContext,
  input: unknown,
): Promise<{ content: string; isError: boolean }> {
  if (!ctx.conversationId) {
    return { content: 'propose_note_types requires a bound conversation id.', isError: true };
  }
  const parsed = parseInput(input);
  if ('error' in parsed) return { content: parsed.error, isError: true };

  const { proposed, skipped } = await proposeNoteTypings(
    ctx.rootPath,
    ctx.conversationId,
    parsed.assignments,
    parsed.note,
  );

  if (proposed.length === 0) {
    const why = skipped.length > 0 ? ` (${skipped.length} skipped: ${skipped.slice(0, 5).map((s) => `${s.relativePath} — ${s.reason}`).join('; ')})` : '';
    return { content: `No type proposals were filed${why}.`, isError: true };
  }

  return {
    content: JSON.stringify({
      status: 'proposed',
      proposedCount: proposed.length,
      proposed: proposed.map((p) => ({ relativePath: p.relativePath, type: p.typeId })),
      skipped,
      hint:
        'STOP. Each note now has a PENDING type proposal the user reviews and ' +
        'approves per note in the Proposals panel — nothing has been typed yet. ' +
        `End the turn with ONE short sentence ("Proposed types for ${proposed.length} ` +
        'note(s) — review them in Proposals.") and DO NOT call propose_note_types ' +
        'again this turn.',
    }),
    isError: false,
  };
}

function parseInput(
  input: unknown,
): { note: string; assignments: TypingAssignment[] } | { error: string } {
  if (!input || typeof input !== 'object') return { error: 'input must be an object.' };
  const obj = input as Record<string, unknown>;
  const note = typeof obj.note === 'string' && obj.note.trim() ? obj.note.trim() : 'Inferred type';
  if (!Array.isArray(obj.assignments) || obj.assignments.length === 0) {
    return { error: '`assignments` must be a non-empty array of { relativePath, typeId }.' };
  }
  const assignments: TypingAssignment[] = [];
  for (const raw of obj.assignments) {
    if (!raw || typeof raw !== 'object') return { error: 'each assignment must be an object.' };
    const a = raw as Record<string, unknown>;
    const relativePath = typeof a.relativePath === 'string' ? a.relativePath.trim() : '';
    const typeId = typeof a.typeId === 'string' ? a.typeId.trim() : '';
    if (!relativePath) return { error: 'each assignment needs a non-empty `relativePath`.' };
    if (relativePath.includes('..')) return { error: `relativePath must not contain '..': ${relativePath}` };
    if (!typeId) return { error: `assignment for ${relativePath} needs a non-empty \`typeId\`.` };
    assignments.push({ relativePath, typeId });
  }
  return { note, assignments };
}

export const proposeNoteTypes: NotebaseTool = {
  definition: {
    name: 'propose_note_types',
    description:
      'Migrate untyped notes to types: propose a type for one or more notes, ' +
      'filed as pending proposals the user reviews per note in the Proposals ' +
      'panel (Approve sets `type:` in the note\'s frontmatter; Reject leaves it ' +
      'untyped). Infer each note\'s type from its frontmatter keys, tags, and ' +
      'content — e.g. a note with `author:`/`isbn:` is a Book. Assign ONLY types ' +
      'that already exist in the registry (call list_notes / query_graph and the ' +
      'type registry to see them) — never invent a type. Setting `type:` is ' +
      'reversible and leaves the body + existing keys untouched; keys that match ' +
      'the type\'s declared properties become its values automatically.',
    input_schema: {
      type: 'object',
      properties: {
        note: {
          type: 'string',
          description: 'A short rationale shown to the user on each proposal.',
        },
        assignments: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          description: 'One entry per note to type.',
          items: {
            type: 'object',
            properties: {
              relativePath: { type: 'string', description: 'Project-relative path to the note (include `.md`). Must already exist.' },
              typeId: { type: 'string', description: 'An existing registry type id (e.g. `book`, `person`).' },
            },
            required: ['relativePath', 'typeId'],
          },
        },
      },
      required: ['assignments'],
    },
  },
  run: (ctx: ToolContext, input: unknown, _callbacks: ToolCallbacks) => runProposeNoteTypes(ctx, input),
};
