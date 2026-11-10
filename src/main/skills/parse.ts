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
  type SkillFork,
  type SkillMenu,
  type SkillSource,
} from '../../shared/skills/types';
import { validateTemplate, type TemplatePluginSettings } from './template';
import { slugifyId as slugify } from '../../shared/slug';
import { findFrontmatter, normalizeNoteText } from '../../shared/frontmatter-block';
import { MAX_FORK_MAX_BRANCHES } from '../../shared/tools/fork-settings';

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

/** `{{item}}` in a `fork: { each, instructions }` (#2974), replaced before the template is checked. */
const ITEM = /\{\{\s*item\s*\}\}/g;

/**
 * A skill's `fork:` and `join:` (#2974). Either a list of branches, each
 * `{ title, instructions }`, or one instruction over a list:
 * `{ each: [a, b], instructions: "… {{item}} …", title?: "{{item}}" }`.
 * Two to eight branches; how many actually start is also capped by the
 * user's own limit when the skill runs.
 */
function normalizeFork(raw: unknown, joinRaw: unknown, errors: string[]): SkillFork | undefined {
  if (raw === undefined) {
    if (joinRaw !== undefined) errors.push('`join` only applies to a skill with `fork`');
    return undefined;
  }
  const branches: SkillFork['branches'] = [];
  if (Array.isArray(raw)) {
    raw.forEach((entry, i) => {
      const e = typeof entry === 'object' && entry !== null ? entry as Record<string, unknown> : {};
      const title = asString(e.title);
      const instructions = asString(e.instructions);
      if (!title || !instructions) errors.push(`fork[${i}] needs a \`title\` and \`instructions\``);
      else branches.push({ title, instructions });
    });
  } else if (typeof raw === 'object' && raw !== null) {
    const r = raw as Record<string, unknown>;
    const instructions = asString(r.instructions);
    const title = asString(r.title) ?? '{{item}}';
    if (!Array.isArray(r.each) || r.each.some((x) => typeof x !== 'string' || !x.trim())) {
      errors.push('`fork.each` must be a list of names, one per branch');
    } else if (!instructions) {
      errors.push('`fork.instructions` is required with `fork.each`');
    } else {
      for (const item of r.each as string[]) {
        branches.push({ title: title.replace(ITEM, item.trim()), instructions: instructions.replace(ITEM, item.trim()) });
      }
    }
  } else {
    errors.push('`fork` must be a list of { title, instructions }, or { each, instructions }');
  }
  if (branches.length > 0 && (branches.length < 2 || branches.length > MAX_FORK_MAX_BRANCHES)) {
    errors.push(`\`fork\` needs 2 to ${MAX_FORK_MAX_BRANCHES} branches (got ${branches.length})`);
  }
  const join = joinRaw === undefined ? undefined : asString(joinRaw);
  if (joinRaw !== undefined && !join) errors.push('`join` must be text');
  return { branches, ...(join ? { join } : {}) };
}

/** `mcp:<server key>` or `mcp:<server key>/<tool>` in a plugin skill's `tools:` (#2649). */
export const MCP_TOOL_ENTRY = /^mcp:([A-Za-z0-9][A-Za-z0-9_-]*)(?:\/([^\s/]+))?$/;

/**
 * @param pluginSettings for a plugin's skill, what its templates may read as
 *   `{{plugin.settings.<key>}}` (#2636); any other skill may read none.
 * @param pluginServers for a plugin's skill, the keys of the MCP servers its
 *   plugin ships, which its `tools:` may name as `mcp:<key>` (#2649); any
 *   other skill may name none.
 */
export function parseSkill(
  raw: string,
  source: SkillSource,
  filePath: string,
  pluginSettings?: TemplatePluginSettings,
  pluginServers?: ReadonlySet<string>,
): ParseResult {
  const errors: string[] = [];
  // A user skill written on Windows may be CRLF or carry a byte-order mark;
  // read it as LF so the template body has no `\r` (#2690).
  const content = normalizeNoteText(raw);
  const fallbackLabel = filePath.replace(/\/SKILL\.md$/i, '').split('/').pop() || filePath;

  const block = findFrontmatter(content);
  if (!block) {
    return { errors: ['missing YAML frontmatter (file must start with `---`)'], label: fallbackLabel };
  }
  const body = content.slice(block.end).trim();

  let fm: Record<string, unknown>;
  try {
    const parsed: unknown = YAML.parse(block.yaml);
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
  for (const entry of tools) {
    if (!entry.startsWith('mcp:')) continue;
    const m = MCP_TOOL_ENTRY.exec(entry);
    if (!m) errors.push(`tools: "${entry}" must be mcp:<server> or mcp:<server>/<tool>`);
    else if (!pluginServers) errors.push(`tools: "${entry}": only a plugin's skills can name MCP tools, and only its own plugin's`);
    else if (!pluginServers.has(m[1]!)) errors.push(`tools: "${entry}": the plugin ships no MCP server "${m[1]}"`);
  }
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

  const fork = normalizeFork(fm.fork, fm.join, errors);
  if (fork) {
    if (outputModeRaw !== 'openConversation') errors.push('`fork` needs `outputMode: openConversation`');
    if (!firstMessage) errors.push('`fork` needs a `firstMessage`: it is what every branch is asked');
  }

  // Template validation (context-independent): catch typos / unbalanced blocks.
  for (const err of validateTemplate(body, pluginSettings)) errors.push(`body: ${err}`);
  if (firstMessage) {
    for (const err of validateTemplate(firstMessage, pluginSettings)) errors.push(`firstMessage: ${err}`);
  }
  for (const [i, b] of (fork?.branches ?? []).entries()) {
    for (const err of validateTemplate(b.instructions, pluginSettings)) errors.push(`fork[${i}].instructions: ${err}`);
  }
  if (fork?.join) {
    for (const err of validateTemplate(fork.join, pluginSettings)) errors.push(`join: ${err}`);
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
    ...(fork ? { fork } : {}),
    body,
    source,
    filePath,
  };
  return { skill, errors: [], label };
}
