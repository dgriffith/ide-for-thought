import { randomUUID } from 'node:crypto';
import type {
  ConversationPropertyDraft,
  PropertyUpdate,
  SetPropertiesInput,
} from '../../../shared/conversation-property-drafts';
import type { PropertyPatch, PropertyValue } from '../../../shared/refactor/frontmatter-patch';
import type { NotebaseTool, ToolContext, ToolCallbacks } from './types';

/**
 * Trust-principle parity with `propose_notes` / `propose_sources`:
 * `set_properties` does NOT write. It validates the bundle, emits a
 * `ConversationPropertyDraft` for inline user review, and returns
 * "drafted." The IPC handler for `CONVERSATION_FILE_PROPERTY_DRAFT`
 * applies the writes once the user approves.
 */
function runSetProperties(
  ctx: ToolContext,
  input: unknown,
  callbacks: ToolCallbacks,
): { content: string; isError: boolean } {
  if (!callbacks.onPropertyDraft) {
    return {
      content: 'set_properties is only available in conversation contexts.',
      isError: true,
    };
  }
  if (!ctx.conversationId) {
    return {
      content: 'set_properties requires a bound conversation id.',
      isError: true,
    };
  }
  const parsed = parseSetPropertiesInput(input);
  if ('error' in parsed) {
    return { content: parsed.error, isError: true };
  }

  const draft: ConversationPropertyDraft = {
    draftId: `propdraft-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: parsed.note,
    updates: parsed.updates,
    createdAt: new Date().toISOString(),
  };
  callbacks.onPropertyDraft(draft);

  const summary = parsed.updates
    .map((u) => `${u.relativePath} (${Object.keys(u.properties).length} key${Object.keys(u.properties).length === 1 ? '' : 's'})`)
    .join(', ');
  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      updateCount: parsed.updates.length,
      proposed: parsed.updates.map((u) => ({
        relativePath: u.relativePath,
        keys: Object.keys(u.properties),
      })),
      // Same anti-loop hint as propose_notes / propose_sources — the
      // model has historically retried draft-emitting tools when it
      // didn't see a "successful" write effect in the result.
      hint:
        'STOP. The property bundle has been queued for user review. End ' +
        'this turn with ONE short acknowledgement sentence ' +
        '("Proposed N property update(s) for review.") and DO NOT call ' +
        'set_properties again in this turn. DO NOT call any other tool. ' +
        'DO NOT repeat the property values inline.',
    }) + `\n\n(queued property draft: ${summary})`,
    isError: false,
  };
}

function parseSetPropertiesInput(
  input: unknown,
): SetPropertiesInput | { error: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'set_properties input must be an object.' };
  }
  const obj = input as Record<string, unknown>;
  const note = typeof obj.note === 'string' ? obj.note.trim() : '';
  if (!note) return { error: '`note` is required and must be a non-empty string.' };
  if (!Array.isArray(obj.updates) || obj.updates.length === 0) {
    return { error: '`updates` must be a non-empty array. If you have no property '
      + 'changes to propose, reply to the user in plain text instead.' };
  }
  const updates: PropertyUpdate[] = [];
  for (const raw of obj.updates) {
    if (!raw || typeof raw !== 'object') {
      return { error: 'Each update entry must be an object.' };
    }
    const u = raw as Record<string, unknown>;
    const relativePath = typeof u.relativePath === 'string' ? u.relativePath.trim() : '';
    if (!relativePath) {
      return { error: 'Each update entry must include a non-empty `relativePath`.' };
    }
    if (relativePath.includes('..')) {
      return { error: `relativePath must not contain '..': ${relativePath}` };
    }
    if (!u.properties || typeof u.properties !== 'object' || Array.isArray(u.properties)) {
      return { error: `update for ${relativePath}: \`properties\` must be a non-array object.` };
    }
    const props = u.properties as Record<string, unknown>;
    if (Object.keys(props).length === 0) {
      return { error: `update for ${relativePath}: \`properties\` must include at least one key.` };
    }
    // Validate each value can round-trip through YAML. We accept the
    // loose PropertyValue shape (scalars, arrays, nested objects, null);
    // anything outside that means the model sent something exotic
    // (undefined, function, bigint) — reject early so the user doesn't
    // approve a no-op patch.
    const sanitized: PropertyPatch = {};
    for (const [k, v] of Object.entries(props)) {
      if (!isPropertyValue(v)) {
        return { error: `update for ${relativePath}: value for key "${k}" is not a YAML-encodable scalar/array/object/null.` };
      }
      sanitized[k] = v;
    }
    updates.push({ relativePath, properties: sanitized });
  }
  return { note, updates };
}

function isPropertyValue(v: unknown): v is PropertyValue {
  if (v === null) return true;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return true;
  if (Array.isArray(v)) return v.every(isPropertyValue);
  if (typeof v === 'object') {
    return Object.values(v as Record<string, unknown>).every(isPropertyValue);
  }
  return false;
}

export const setProperties: NotebaseTool = {
  definition: {
    name: 'set_properties',
    description:
      'Propose YAML-frontmatter property updates on one or more notes. ' +
      'Use this for any structured-metadata change: setting a `status`, ' +
      'editing `tags`, recording a custom field like `priority` or ' +
      '`reviewed`, updating `title`, etc. The user reviews the bundle as ' +
      'an inline card; on Approve, each note is read, its frontmatter ' +
      'patched, and the file written back. On Discard nothing is written.\n' +
      '\n' +
      'Semantics: SHALLOW MERGE. Listed keys replace the value at that ' +
      'key; setting a value to `null` deletes the key; other keys in the ' +
      "frontmatter are left untouched. If you need to append to an array " +
      'rather than replace it, call `fetch_properties` first to read the ' +
      'current value, then submit the combined array.\n' +
      '\n' +
      'Use ONE `set_properties` call for the whole bundle (the user reviews ' +
      'all updates as a single card) rather than calling it once per note. ' +
      'When the only change is adding/removing a tag, you may still prefer ' +
      '`set_properties` with `{ tags: [...] }` so the user sees the diff ' +
      'instead of a silent tag mutation.',
    input_schema: {
      type: 'object',
      properties: {
        note: {
          type: 'string',
          description:
            'A short sentence describing why you are proposing this ' +
            'update. Surfaced to the user on the inline review card.',
        },
        updates: {
          type: 'array',
          minItems: 1,
          maxItems: 64,
          description:
            'One or more per-note patches. Each entry targets one note ' +
            'and shallow-merges its `properties` into the frontmatter.',
          items: {
            type: 'object',
            properties: {
              relativePath: {
                type: 'string',
                description:
                  'Project-relative path to the note (include `.md`). The ' +
                  'note must already exist — use `propose_notes` to ' +
                  'create new notes.',
              },
              properties: {
                type: 'object',
                description:
                  'Shallow patch. Each key is set to the given value; a ' +
                  '`null` value deletes the key. Values may be strings, ' +
                  'numbers, booleans, arrays, or nested objects — anything ' +
                  'YAML can encode.',
                additionalProperties: true,
              },
            },
            required: ['relativePath', 'properties'],
          },
        },
      },
      required: ['note', 'updates'],
    },
  },
  run: (ctx, input, callbacks) => runSetProperties(ctx, input, callbacks),
};
