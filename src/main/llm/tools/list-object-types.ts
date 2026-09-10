import { loadTypeCatalog } from '../../types/loader';
import type { TypeDef, PropertyDef } from '../../../shared/objects/type-def';
import type { NotebaseTool, ToolContext } from './types';

function formatProperty(p: PropertyDef): string {
  let line = `  - ${p.name} (${p.type})`;
  if (p.label) line += ` "${p.label}"`;
  if (p.type === 'enum' && p.options && p.options.length > 0) line += ` options: [${p.options.join(', ')}]`;
  if (p.type === 'link-to-type' && p.targetType) line += ` targetType: ${p.targetType}`;
  return line;
}

function formatType(t: TypeDef): string {
  const lines = [`${t.id} — "${t.label}" (${t.source})`];
  if (t.parent) lines.push(`  parent: ${t.parent}`);
  if (t.externalClass) lines.push(`  externalClass: ${t.externalClass}`);
  lines.push(`  template: ${t.template ? 'yes' : 'no'}`);
  if (t.properties.length === 0) {
    lines.push('  (no properties)');
  } else {
    lines.push(...t.properties.map(formatProperty));
  }
  return lines.join('\n');
}

async function runListObjectTypes(ctx: ToolContext): Promise<string> {
  const catalog = await loadTypeCatalog(ctx.rootPath);
  if (catalog.types.length === 0) return 'No object types defined in this thoughtbase.';
  const lines = catalog.types.map(formatType);
  return `${catalog.types.length} object types:\n\n${lines.join('\n\n')}`;
}

export const listObjectTypes: NotebaseTool = {
  definition: {
    name: 'list_object_types',
    description:
      'List every object type defined in this thoughtbase (stock + user), with ' +
      'each property\'s full definition — type, enum options, link-to-type target, ' +
      'parent type, and whether a template exists. Read-only. Call this before ' +
      'proposing a note\'s type or a new type definition, so you only reference ' +
      'ids that actually exist and match each property\'s declared shape.',
    input_schema: { type: 'object', properties: {} },
  },
  run: async (ctx) => ({ content: await runListObjectTypes(ctx), isError: false }),
};
