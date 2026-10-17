/**
 * Checking a drafted skill or plugin (#2652) before the user is shown it, in
 * memory: the same parser and manifest checker Settings uses, so a draft the
 * assistant got wrong comes back to it to fix, not to the user as a card that
 * can't be saved. Nothing here touches the disk.
 *
 * It isn't the last word for a plugin. Installing reads the written folder
 * whole (`readPluginPackage`: each contribution in its point's folder, with
 * its point's extension, links contained), and a draft that passes here but
 * fails there says why on the card. What this catches is what the model
 * controls: the manifest, the paths, and every skill it contributes.
 */
import {
  EXTENSION_DRAFT_KINDS,
  EXTENSION_DRAFT_LIMITS,
  draftPathProblem,
  type ExtensionDraftFile,
  type ExtensionDraftKind,
} from '../../shared/extensions/drafts';
import { PLUGIN_MANIFEST } from '../../shared/plugins/format';
import { parseSkill } from '../skills/parse';
import { validatePluginManifest } from '../plugins/manifest';
import { isInterpreter, pluginRelativePath } from '../plugins/mcp-schema';

export interface CheckedExtensionDraft {
  kind: ExtensionDraftKind;
  id: string;
  name: string;
  summary: string;
  files: ExtensionDraftFile[];
  mcpServers?: string[];
}

export type ExtensionDraftCheck = { ok: true; draft: CheckedExtensionDraft } | { ok: false; problems: string[] };

export interface DraftCheckContext {
  appVersion: string;
  /** Ids already taken: stock, user and plugin skills. A drafted skill may not reuse one. */
  takenSkillIds: ReadonlySet<string>;
}

const SKILL_FILE = /^(?:[^/]+\.md|[^/]+\/SKILL\.md)$/;

function readFiles(raw: unknown, problems: string[]): ExtensionDraftFile[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    problems.push('"files" must list at least one file, each { path, content }.');
    return [];
  }
  if (raw.length > EXTENSION_DRAFT_LIMITS.files) problems.push(`At most ${EXTENSION_DRAFT_LIMITS.files} files; got ${raw.length}.`);
  const files: ExtensionDraftFile[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const f of raw.slice(0, EXTENSION_DRAFT_LIMITS.files)) {
    const file = f as { path?: unknown; content?: unknown } | null;
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
      problems.push('Each file must be { path, content }, both strings.');
      continue;
    }
    const pathProblem = draftPathProblem(file.path);
    if (pathProblem) { problems.push(pathProblem); continue; }
    // The default macOS volume ignores case, so two spellings are one file.
    const key = file.path.toLowerCase();
    if (seen.has(key)) { problems.push(`"${file.path}" is listed twice.`); continue; }
    seen.add(key);
    const bytes = Buffer.byteLength(file.content, 'utf-8');
    if (bytes > EXTENSION_DRAFT_LIMITS.fileBytes) problems.push(`"${file.path}" is ${Math.ceil(bytes / 1024)} KB; at most ${EXTENSION_DRAFT_LIMITS.fileBytes / 1024} KB a file.`);
    total += bytes;
    files.push({ path: file.path, content: file.content });
  }
  if (total > EXTENSION_DRAFT_LIMITS.totalBytes) problems.push(`The files come to ${Math.ceil(total / 1024)} KB; at most ${EXTENSION_DRAFT_LIMITS.totalBytes / 1024} KB in all.`);
  return files;
}

function checkSkill(files: ExtensionDraftFile[], ctx: DraftCheckContext, problems: string[]): { id: string; name: string } | null {
  if (files.length !== 1 || !SKILL_FILE.test(files[0]!.path)) {
    problems.push('A skill is one file: "<name>.md", or "<name>/SKILL.md".');
    return null;
  }
  const r = parseSkill(files[0]!.content, 'user', files[0]!.path);
  if (!r.skill) {
    for (const e of r.errors) problems.push(`${files[0]!.path}: ${e}`);
    return null;
  }
  if (ctx.takenSkillIds.has(r.skill.id)) {
    problems.push(`A skill with the id "${r.skill.id}" already exists; pick another id.`);
    return null;
  }
  return { id: r.skill.id, name: r.skill.name };
}

function checkPlugin(files: ExtensionDraftFile[], ctx: DraftCheckContext, problems: string[]): { id: string; name: string; mcpServers: string[] } | null {
  const manifestFile = files.find((f) => f.path === PLUGIN_MANIFEST);
  if (!manifestFile) {
    problems.push(`A plugin needs a ${PLUGIN_MANIFEST} at the top of its folder.`);
    return null;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(manifestFile.content);
  } catch (e) {
    problems.push(`${PLUGIN_MANIFEST} isn't valid JSON: ${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
  const claimed = (raw as { id?: unknown } | null)?.id;
  const checked = validatePluginManifest(raw, { folder: typeof claimed === 'string' ? claimed : '', appVersion: ctx.appVersion });
  if (!checked.ok) {
    problems.push(...checked.problems.map((p) => `${PLUGIN_MANIFEST}: ${p}`));
    return null;
  }
  const { manifest } = checked;
  const byPath = new Map(files.map((f) => [f.path, f]));
  const fields = manifest.settings ?? [];
  const settings = {
    readable: new Set(fields.filter((f) => f.kind !== 'secret').map((f) => f.key)),
    secret: new Set(fields.filter((f) => f.kind === 'secret').map((f) => f.key)),
  };
  const servers = new Set((manifest.mcpServers ?? []).map((s) => s.key));
  for (const [point, paths] of Object.entries(manifest.contributes)) {
    for (const written of paths ?? []) {
      const p = pluginRelativePath(written) ?? written;
      const file = byPath.get(p) ?? (point === 'skills' ? byPath.get(`${p}/SKILL.md`) : undefined);
      if (!file) { problems.push(`${PLUGIN_MANIFEST} contributes "${p}" (${point}), but there's no such file in the draft.`); continue; }
      if (point !== 'skills') continue;
      const r = parseSkill(file.content, 'plugin', file.path, settings, servers);
      if (!r.skill) for (const e of r.errors) problems.push(`${file.path}: ${e}`);
      else if (ctx.takenSkillIds.has(r.skill.id)) problems.push(`${file.path}: a skill with the id "${r.skill.id}" already exists.`);
    }
  }
  for (const server of manifest.mcpServers ?? []) {
    const run = isInterpreter(server.command) && server.args[0] !== undefined ? server.args[0] : server.command;
    const program = pluginRelativePath(run) ?? run;
    if (!byPath.has(program)) problems.push(`The "${server.key}" server runs "${run}", which isn't in the draft.`);
  }
  return { id: manifest.id, name: manifest.name, mcpServers: [...servers] };
}

/** Check a draft the model wrote: `{ kind, summary, files }`. */
export function checkExtensionDraft(input: unknown, ctx: DraftCheckContext): ExtensionDraftCheck {
  const obj = (input && typeof input === 'object' ? input : {}) as { kind?: unknown; summary?: unknown; files?: unknown };
  const problems: string[] = [];
  const kind = obj.kind;
  if (typeof kind !== 'string' || !(EXTENSION_DRAFT_KINDS as readonly string[]).includes(kind)) {
    return { ok: false, problems: [`"kind" must be ${EXTENSION_DRAFT_KINDS.join(' or ')}.`] };
  }
  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';
  if (!summary) problems.push('"summary" must say, in a sentence or two, what this adds.');
  else if (summary.length > EXTENSION_DRAFT_LIMITS.summary) problems.push(`"summary" is at most ${EXTENSION_DRAFT_LIMITS.summary} characters.`);
  const files = readFiles(obj.files, problems);
  if (problems.length > 0) return { ok: false, problems };

  if (kind === 'skill') {
    const skill = checkSkill(files, ctx, problems);
    return skill ? { ok: true, draft: { kind, ...skill, summary, files } } : { ok: false, problems };
  }
  const plugin = checkPlugin(files, ctx, problems);
  if (!plugin || problems.length > 0) return { ok: false, problems };
  const { mcpServers, ...rest } = plugin;
  return { ok: true, draft: { kind: 'plugin', ...rest, summary, files, ...(mcpServers.length ? { mcpServers } : {}) } };
}
