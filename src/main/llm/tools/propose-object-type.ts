import { proposeObjectTypeDef } from '../object-types';
import { PROPERTY_TYPES, type PropertyDef, type PropertyType } from '../../../shared/objects/type-def';
import type { SaveTypeInput } from '../../types/write';
import type { NotebaseTool, ToolContext, ToolCallbacks } from './types';

/**
 * `propose_object_type` (#2069) — the LLM-facing counterpart to
 * `TypeEditorDialog.svelte`. Files ONE pending `thought:Proposal` (a
 * `type-def` payload) that lands in the Proposals panel for review;
 * approving creates/edits `.minerva/types/<id>.md` and reloads the catalog.
 * It only ever proposes — never writes directly, and never invents a
 * property `type` outside the declared `PropertyType` set.
 */
async function runProposeObjectType(
  ctx: ToolContext,
  input: unknown,
): Promise<{ content: string; isError: boolean }> {
  if (!ctx.conversationId) {
    return { content: 'propose_object_type requires a bound conversation id.', isError: true };
  }
  const parsed = parseInput(input);
  if ('error' in parsed) return { content: parsed.error, isError: true };

  try {
    const { id, isEdit } = await proposeObjectTypeDef(ctx.rootPath, ctx.conversationId, parsed.input, parsed.note);
    return {
      content: JSON.stringify({
        status: 'proposed',
        id,
        isEdit,
        hint:
          'STOP. This is a PENDING proposal the user reviews and approves in the ' +
          'Proposals panel — the type has NOT been created or changed yet. End the ' +
          `turn with ONE short sentence ("Proposed ${isEdit ? 'an edit to' : 'a new'} ` +
          `type \`${id}\` — review it in Proposals.") and DO NOT call ` +
          'propose_object_type again this turn.',
      }),
      isError: false,
    };
  } catch (err) {
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
}

const PROPERTY_TYPE_SET: ReadonlySet<string> = new Set(PROPERTY_TYPES);

function parseProperties(raw: unknown): PropertyDef[] | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return { error: '`properties` must be a non-empty array.' };
  }
  const properties: PropertyDef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') return { error: 'each property must be an object.' };
    const p = item as Record<string, unknown>;
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    const type = typeof p.type === 'string' ? p.type : '';
    if (!name) return { error: 'each property needs a non-empty `name`.' };
    if (!PROPERTY_TYPE_SET.has(type)) {
      return { error: `property "${name}" has type "${type}", which isn't one of: ${PROPERTY_TYPES.join(', ')}.` };
    }
    const def: PropertyDef = { name, type: type as PropertyType };
    if (typeof p.label === 'string' && p.label.trim()) def.label = p.label.trim();
    if (type === 'enum' && Array.isArray(p.options)) {
      def.options = p.options.filter((o): o is string => typeof o === 'string');
    }
    if (type === 'link-to-type' && typeof p.targetType === 'string' && p.targetType.trim()) {
      def.targetType = p.targetType.trim();
    }
    properties.push(def);
  }
  return properties;
}

function parseInput(input: unknown): { note: string; input: SaveTypeInput } | { error: string } {
  if (!input || typeof input !== 'object') return { error: 'input must be an object.' };
  const obj = input as Record<string, unknown>;
  const label = typeof obj.label === 'string' ? obj.label.trim() : '';
  if (!label) return { error: '`label` must be a non-empty string.' };

  const properties = parseProperties(obj.properties);
  if ('error' in properties) return properties;

  const note = typeof obj.note === 'string' && obj.note.trim() ? obj.note.trim() : `Proposed type "${label}"`;
  const saveInput: SaveTypeInput = { label, properties };
  if (typeof obj.id === 'string' && obj.id.trim()) saveInput.id = obj.id.trim();
  if (typeof obj.icon === 'string' && obj.icon.trim()) saveInput.icon = obj.icon.trim();
  if (typeof obj.color === 'string' && obj.color.trim()) saveInput.color = obj.color.trim();
  if (typeof obj.cover === 'string' && obj.cover.trim()) saveInput.cover = obj.cover.trim();
  if (Array.isArray(obj.card)) {
    const card = obj.card.filter((c): c is string => typeof c === 'string');
    if (card.length > 0) saveInput.card = card;
  }
  if (typeof obj.parent === 'string' && obj.parent.trim()) saveInput.parent = obj.parent.trim();
  if (typeof obj.externalClass === 'string' && obj.externalClass.trim()) saveInput.externalClass = obj.externalClass.trim();
  if (typeof obj.template === 'string' && obj.template.trim()) saveInput.template = obj.template;

  return { note, input: saveInput };
}

export const proposeObjectType: NotebaseTool = {
  definition: {
    name: 'propose_object_type',
    description:
      'Propose a new object type, or an edit to an existing one, filed as a ' +
      'pending proposal the user reviews in the Proposals panel (Approve creates/' +
      'updates the type and it becomes immediately usable; Reject leaves no trace). ' +
      'Call list_object_types first so property names/ids don\'t collide by ' +
      'accident. To EDIT an existing type, pass its exact `id`; passing a `label` ' +
      'whose slug collides with an existing type\'s id WITHOUT passing that id is ' +
      'rejected rather than silently overwritten. Each property\'s `type` must be ' +
      'one of the declared kinds — never invent one.',
    input_schema: {
      type: 'object',
      properties: {
        note: { type: 'string', description: 'A short rationale shown to the user on the proposal.' },
        label: { type: 'string', description: 'Display name for the type, e.g. "Recipe".' },
        id: { type: 'string', description: 'Existing type id to edit. Omit to create a new type (id is derived from the label).' },
        properties: {
          type: 'array',
          minItems: 1,
          description: 'Declared properties for this type.',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Frontmatter key, e.g. "author".' },
              type: { type: 'string', enum: [...PROPERTY_TYPES], description: 'One of the declared property kinds.' },
              label: { type: 'string', description: 'Display label; defaults to the name.' },
              options: { type: 'array', items: { type: 'string' }, description: 'Allowed values — enum properties only.' },
              targetType: { type: 'string', description: 'Target type id — link-to-type properties only.' },
            },
            required: ['name', 'type'],
          },
        },
        icon: { type: 'string', description: 'Emoji shown next to the type.' },
        color: { type: 'string', description: 'CSS color for the type\'s accent.' },
        cover: { type: 'string', description: 'Property name whose value is shown as a gallery-view cover image.' },
        card: { type: 'array', items: { type: 'string' }, description: 'Property names shown on a note-link card for this type.' },
        parent: { type: 'string', description: 'Existing type id this type specializes.' },
        externalClass: { type: 'string', description: 'External vocabulary CURIE this type aligns to, e.g. "foaf:Person".' },
        template: { type: 'string', description: 'Template body (markdown) seeded into new instances.' },
      },
      required: ['label', 'properties'],
    },
  },
  run: (ctx: ToolContext, input: unknown, _callbacks: ToolCallbacks) => runProposeObjectType(ctx, input),
};
