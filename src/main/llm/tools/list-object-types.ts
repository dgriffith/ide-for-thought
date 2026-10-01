import { loadTypeCatalog } from '../../types/loader';
import type { TypeDef, PropertyDef } from '../../../shared/objects/type-def';
import type { NotebaseTool, ToolContext } from './types';
import { effectiveTemplate } from '../../../shared/objects/inheritance';

function formatProperty(p: PropertyDef): string {
  let line = `  - ${p.name} (${p.type})`;
  if (p.label) line += ` "${p.label}"`;
  if (p.type === 'enum' && p.options && p.options.length > 0) line += ` options: [${p.options.join(', ')}]`;
  if (p.type === 'link-to-type' && p.targetType) line += ` targetType: ${p.targetType}`;
  return line;
}

/** How much of a default body the catalog listing shows per type. A long body
 *  shouldn't flood every call; `type_id` fetches one type's in full. */
const BODY_PREVIEW_CHARS = 400;

function formatType(t: TypeDef, byId: ReadonlyMap<string, TypeDef>, full: boolean): string {
  const lines = [`${t.id} — "${t.label}" (${t.source})`];
  if (t.parent) lines.push(`  parent: ${t.parent}`);
  if (t.externalClass) lines.push(`  externalClass: ${t.externalClass}`);
  if (t.properties.length === 0) {
    lines.push('  (no properties)');
  } else {
    lines.push(...t.properties.map(formatProperty));
  }
  // The default body a new note of this type starts from (#2492) — its own, or
  // the nearest ancestor's (#2494). `{{name}}` placeholders name properties.
  const body = effectiveTemplate(t.id, byId);
  if (!body) {
    lines.push('  default body: none');
  } else {
    const from = body.fromTypeId === t.id ? '' : ` (inherited from ${body.fromTypeId})`;
    const truncated = !full && body.template.length > BODY_PREVIEW_CHARS;
    const text = truncated ? body.template.slice(0, BODY_PREVIEW_CHARS) : body.template;
    lines.push(`  default body${from}:`);
    lines.push(...text.split('\n').map((l) => `    ${l}`));
    if (truncated) lines.push(`    …(truncated — call list_object_types with type_id: "${t.id}" for the full body)`);
  }
  return lines.join('\n');
}

async function runListObjectTypes(ctx: ToolContext, input: unknown): Promise<{ content: string; isError: boolean }> {
  const catalog = await loadTypeCatalog(ctx.rootPath);
  const byId = new Map(catalog.types.map((t) => [t.id, t]));
  const typeId = typeof (input as { type_id?: unknown } | null)?.type_id === 'string'
    ? (input as { type_id: string }).type_id.trim() : '';
  if (typeId) {
    const t = byId.get(typeId);
    if (!t) return { content: `No object type "${typeId}". Call list_object_types with no arguments to see them all.`, isError: true };
    return { content: formatType(t, byId, true), isError: false };
  }
  if (catalog.types.length === 0) return { content: 'No object types defined in this thoughtbase.', isError: false };
  const lines = catalog.types.map((t) => formatType(t, byId, false));
  return { content: `${catalog.types.length} object types:\n\n${lines.join('\n\n')}`, isError: false };
}

export const listObjectTypes: NotebaseTool = {
  definition: {
    name: 'list_object_types',
    description:
      'List every object type defined in this thoughtbase (stock + user), with ' +
      'each property\'s full definition — type, enum options, link-to-type target, ' +
      'parent type, and its DEFAULT BODY — the markdown a new note of that type ' +
      'starts from (own, or inherited from its parent). A body may contain ' +
      '{{property}} placeholders. Read-only. Call this before proposing a note\'s ' +
      'type or a new type definition, so you only reference ids that actually exist ' +
      'and match each property\'s declared shape — and before creating a note of a ' +
      'type, so you can start it from that type\'s default body. Pass `type_id` to ' +
      'get one type in full when its body was truncated.',
    input_schema: {
      type: 'object',
      properties: {
        type_id: { type: 'string', description: 'Optional: one type id to show in full (default body untruncated).' },
      },
    },
  },
  run: (ctx, input) => runListObjectTypes(ctx, input),
};
