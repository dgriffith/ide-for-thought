/**
 * Type-definition parser (#1062). Splits YAML frontmatter from the template
 * body, validates every field, and normalizes authoring shorthands into a
 * `TypeDef`. Never throws on content problems — returns collected errors so one
 * malformed type can't break the rest of the catalog (mirrors skills/parse.ts).
 */
import YAML from 'yaml';
import {
  PROPERTY_TYPES,
  pascalCase,
  titleCase,
  type PropertyDef,
  type PropertyType,
  type TypeDef,
  type TypeSource,
} from '../../shared/objects/type-def';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

export interface ParseTypeResult {
  type?: TypeDef;
  errors: string[];
  /** Best-effort label for error reporting even when the type is rejected. */
  label: string;
}

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v.trim() || undefined : undefined;
}

/** Normalize the `properties:` list; skips (with an error) any malformed entry. */
function normalizeProperties(raw: unknown, errors: string[]): PropertyDef[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    errors.push('`properties` must be a list');
    return [];
  }
  const out: PropertyDef[] = [];
  raw.forEach((p, i) => {
    if (typeof p !== 'object' || p === null) {
      errors.push(`property #${i + 1} must be a mapping`);
      return;
    }
    const obj = p as Record<string, unknown>;
    const name = asString(obj.name);
    if (!name) {
      errors.push(`property #${i + 1} is missing \`name\``);
      return;
    }
    const type = (asString(obj.type) ?? 'text') as PropertyType;
    if (!PROPERTY_TYPES.includes(type)) {
      errors.push(`property "${name}" has unknown type "${type}" (expected one of ${PROPERTY_TYPES.join(', ')})`);
      return;
    }
    const def: PropertyDef = { name, type };
    const label = asString(obj.label);
    if (label) def.label = label; else def.label = titleCase(name);
    if (type === 'enum') {
      const options = Array.isArray(obj.options) ? obj.options.map(asString).filter((o): o is string => !!o) : [];
      if (options.length === 0) errors.push(`enum property "${name}" has no \`options\``);
      def.options = options;
    }
    if (type === 'link-to-type') {
      const target = asString(obj.targetType ?? obj.target);
      if (!target) errors.push(`link-to-type property "${name}" is missing \`targetType\``);
      else def.targetType = slugify(target);
    }
    out.push(def);
  });
  return out;
}

/** Normalize the `card:` field — a YAML list or comma-separated string of
 *  property names. Unknown names are dropped with a soft error (still loads). */
function normalizeCard(raw: unknown, properties: PropertyDef[], errors: string[]): string[] {
  if (raw === undefined) return [];
  let names: string[];
  if (Array.isArray(raw)) {
    names = raw.map(asString).filter((s): s is string => !!s);
  } else if (typeof raw === 'string') {
    names = raw.split(',').map((s) => s.trim()).filter(Boolean);
  } else {
    errors.push('`card` must be a list or comma-separated string');
    return [];
  }
  const declared = new Set(properties.map((p) => p.name));
  const out: string[] = [];
  for (const name of names) {
    if (declared.has(name)) out.push(name);
    else errors.push(`\`card\` lists "${name}", which is not a declared property`);
  }
  return out;
}

/**
 * Parse one type-definition file. `source` tags provenance; `filePath` is the
 * absolute path (user) or glob key (stock) for error reporting.
 */
export function parseType(content: string, source: TypeSource, filePath: string): ParseTypeResult {
  const errors: string[] = [];
  const m = content.match(FRONTMATTER_RE);
  if (!m) {
    return { errors: ['missing YAML frontmatter (`---` block)'], label: filePath };
  }

  let fm: Record<string, unknown>;
  try {
    const parsed = YAML.parse(m[1]!) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { errors: ['frontmatter must be a mapping'], label: filePath };
    }
    fm = parsed as Record<string, unknown>;
  } catch (e) {
    return { errors: [`invalid YAML: ${(e as Error).message}`], label: filePath };
  }

  const label = asString(fm.label) ?? asString(fm.name);
  const id = asString(fm.id) ? slugify(asString(fm.id)!) : label ? slugify(label) : '';
  const bestLabel = label ?? id ?? filePath;

  if (!label) errors.push('missing `label`');
  if (!id) errors.push('could not derive an id (needs `id` or `label`)');

  const properties = normalizeProperties(fm.properties, errors);
  const template = content.slice(m[0].length).trim() || undefined;

  // Hard errors (no id/label) reject the type; soft errors (a bad property) are
  // reported but the type still loads (house UX: no hand-holding).
  if (!label || !id) return { errors, label: bestLabel };

  const type: TypeDef = {
    id,
    label,
    classLocalName: pascalCase(id),
    properties,
    source,
    filePath,
  };
  if (template) type.template = template;
  const icon = asString(fm.icon);
  if (icon) type.icon = icon;
  const color = asString(fm.color);
  if (color) type.color = color;
  const cover = asString(fm.cover);
  if (cover) {
    // Soft-validate: `cover` must name a declared property (else the gallery has
    // nothing to key off). Report but still load — house UX: no hand-holding.
    if (!properties.some((p) => p.name === cover)) {
      errors.push(`\`cover\` names "${cover}", which is not a declared property`);
    }
    type.cover = cover;
  }
  // `card`: ordered property names shown on the type-keyed render card (#1071).
  // Accept a YAML list or a comma-separated string; soft-flag names that aren't
  // declared properties but keep the rest.
  const card = normalizeCard(fm.card, properties, errors);
  if (card.length > 0) type.card = card;
  // `parent` (a.k.a. `extends`): the type this one specializes (#1586), stored
  // as an id ref. Existence is validated later, in the loader (all types known).
  const parent = asString(fm.parent) ?? asString(fm.extends);
  if (parent) type.parent = slugify(parent);

  return { type, errors, label: bestLabel };
}
