/**
 * Skill file parser (#624). Splits YAML frontmatter from the markdown body,
 * validates every field, and normalizes friendly authoring shorthands into the
 * canonical SkillDef. Never throws on content problems — returns collected
 * errors so one malformed skill can't break the rest of the catalog.
 */

import YAML from 'yaml';
import type { ContextRequirement, OutputMode, ToolParameter } from '../../shared/tools/types';
import {
  SKILL_MENUS,
  type SkillDef,
  type SkillMenu,
  type SkillSource,
} from '../../shared/skills/types';
import { validateTemplate } from './template';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?/;

const CONTEXT_REQUIREMENTS: readonly ContextRequirement[] = [
  'selectedText', 'fullNote', 'relatedNotes', 'taggedNotes', 'claimUnderCursor', 'selectionRange',
  'sourceMetadata', 'sourceBody',
];
const SCOPES = ['note', 'source'] as const;
const OUTPUT_MODES: readonly OutputMode[] = [
  'newNote', 'appendToNote', 'replaceSelection', 'insertAtCursor', 'multipleNotes', 'openConversation',
];
const PARAM_TYPES = ['text', 'textarea', 'select', 'number', 'note'] as const;

export interface ParseResult {
  skill?: SkillDef;
  errors: string[];
  /** Best-effort label for error reporting even when the skill is rejected. */
  label: string;
}

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function normalizeParameters(raw: unknown, errors: string[]): ToolParameter[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    errors.push('`parameters` must be a list');
    return [];
  }
  const out: ToolParameter[] = [];
  raw.forEach((p, i) => {
    if (typeof p !== 'object' || p === null) {
      errors.push(`parameter #${i + 1} must be a mapping`);
      return;
    }
    const obj = p as Record<string, unknown>;
    const id = asString(obj.id);
    const label = asString(obj.label) ?? id;
    const type = asString(obj.type) ?? 'text';
    if (!id) { errors.push(`parameter #${i + 1} is missing \`id\``); return; }
    if (!(PARAM_TYPES as readonly string[]).includes(type)) {
      errors.push(`parameter "${id}" has invalid type "${type}"`);
      return;
    }
    const param: ToolParameter = { id, label: label ?? id, type: type as ToolParameter['type'] };
    const placeholder = asString(obj.placeholder);
    if (placeholder !== undefined) param.placeholder = placeholder;
    // `default` (friendly) or `defaultValue`
    const dflt = obj.default ?? obj.defaultValue;
    if (dflt !== undefined) {
      param.defaultValue =
        typeof dflt === 'string'
          ? dflt
          : typeof dflt === 'number' || typeof dflt === 'boolean'
            ? String(dflt)
            : JSON.stringify(dflt);
    }
    if (obj.required !== undefined) param.required = Boolean(obj.required);
    if (type === 'select') {
      const opts = obj.options;
      if (!Array.isArray(opts) || opts.length === 0) {
        errors.push(`select parameter "${id}" needs a non-empty \`options\` list`);
        return;
      }
      param.options = opts.map((o) =>
        typeof o === 'object' && o !== null
          ? { label: String((o as Record<string, unknown>).label ?? (o as Record<string, unknown>).value), value: String((o as Record<string, unknown>).value) }
          : { label: String(o), value: String(o) },
      );
    }
    out.push(param);
  });
  return out;
}

function normalizeStringArray(raw: unknown, field: string, allowed: readonly string[] | null, errors: string[]): string[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) { errors.push(`\`${field}\` must be a list`); return []; }
  const out: string[] = [];
  for (const item of raw) {
    const s = asString(item);
    if (s === undefined) { errors.push(`\`${field}\` entries must be strings`); continue; }
    if (allowed && !allowed.includes(s)) { errors.push(`\`${field}\` has invalid value "${s}"`); continue; }
    out.push(s);
  }
  return out;
}

export function parseSkill(content: string, source: SkillSource, filePath: string): ParseResult {
  const errors: string[] = [];
  const fallbackLabel = filePath.replace(/\/SKILL\.md$/i, '').split('/').pop() || filePath;

  const m = FRONTMATTER_RE.exec(content);
  if (!m) {
    return { errors: ['missing YAML frontmatter (file must start with `---`)'], label: fallbackLabel };
  }
  const body = content.slice(m[0].length).trim();

  let fm: Record<string, unknown>;
  try {
    const parsed: unknown = YAML.parse(m[1]!); // capture group present when the regex matches
    if (typeof parsed !== 'object' || parsed === null) {
      return { errors: ['frontmatter is not a YAML mapping'], label: fallbackLabel };
    }
    fm = parsed as Record<string, unknown>;
  } catch (e) {
    return { errors: [`invalid YAML frontmatter: ${(e as Error).message}`], label: fallbackLabel };
  }

  const name = asString(fm.name);
  const label = name ?? fallbackLabel;

  // Required fields
  if (!name) errors.push('`name` is required');
  const description = asString(fm.description);
  if (!description) errors.push('`description` is required');

  const menuRaw = asString(fm.menu);
  if (!menuRaw) errors.push('`menu` is required');
  else if (!(SKILL_MENUS as readonly string[]).includes(menuRaw)) {
    errors.push(`\`menu\` must be one of ${SKILL_MENUS.join(', ')} (got "${menuRaw}")`);
  }

  const outputModeRaw = asString(fm.outputMode);
  if (!outputModeRaw) errors.push('`outputMode` is required');
  else if (!(OUTPUT_MODES as readonly string[]).includes(outputModeRaw)) {
    errors.push(`\`outputMode\` is invalid (got "${outputModeRaw}")`);
  }

  if (!body) errors.push('skill body (the prompt) is empty');

  // Optional / normalized fields
  const context = normalizeStringArray(fm.context, 'context', CONTEXT_REQUIREMENTS, errors) as ContextRequirement[];
  const parameters = normalizeParameters(fm.parameters, errors);
  const tools = normalizeStringArray(fm.tools, 'tools', null, errors);
  const web = fm.web === undefined ? false : Boolean(fm.web);
  const model = asString(fm.model);
  const requiresSelection = Boolean(fm.requiresSelection);
  // Tri-state: undefined ⇒ derive from context; explicit false must survive
  // (a plain Boolean() would collapse it), so a skill can opt out of the note
  // requirement even while listing `context:[fullNote]`.
  const requiresNote = fm.requiresNote === undefined ? undefined : Boolean(fm.requiresNote);
  const outputNotePrefix = asString(fm.outputNotePrefix);
  const group = asString(fm.group);

  const scopeRaw = asString(fm.scope);
  if (scopeRaw !== undefined && !(SCOPES as readonly string[]).includes(scopeRaw)) {
    errors.push(`\`scope\` must be one of ${SCOPES.join(', ')} (got "${scopeRaw}")`);
  }
  const scope = (scopeRaw as SkillDef['scope']) ?? 'note';
  const firstMessage = asString(fm.firstMessage) ?? '';
  const longDescription = asString(fm.longDescription) ?? description ?? '';

  let slashCommand = asString(fm.slashCommand);
  if (slashCommand && !slashCommand.startsWith('/')) slashCommand = `/${slashCommand}`;

  // Template validation (context-independent): catch typos / unbalanced blocks.
  for (const err of validateTemplate(body)) errors.push(`body: ${err}`);
  if (firstMessage) {
    for (const err of validateTemplate(firstMessage)) errors.push(`firstMessage: ${err}`);
  }

  if (errors.length > 0) return { errors, label };

  const id = asString(fm.id) ?? slugify(name!);
  if (!id) return { errors: ['could not derive an `id` (provide one explicitly)'], label };

  const skill: SkillDef = {
    id,
    name: name!,
    description: description!,
    longDescription,
    menu: menuRaw as SkillMenu,
    ...(group !== undefined ? { group } : {}),
    scope,
    outputMode: outputModeRaw as OutputMode,
    context,
    parameters,
    tools,
    web,
    ...(model !== undefined ? { model } : {}),
    ...(slashCommand !== undefined ? { slashCommand } : {}),
    ...(outputNotePrefix !== undefined ? { outputNotePrefix } : {}),
    requiresSelection,
    ...(requiresNote !== undefined ? { requiresNote } : {}),
    firstMessage,
    body,
    source,
    filePath,
  };
  return { skill, errors: [], label };
}
