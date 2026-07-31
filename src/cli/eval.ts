/**
 * Skill-eval harness — deterministic core (#1522, PR 1).
 *
 * For each case directory it packages an LLM request **exactly the way Minerva
 * does at runtime** — reusing the real seam in `src/main/tools/executor.ts`
 * (`buildConversationPayload` / `buildOneShotPayload`) rather than
 * reconstructing the prompt — and writes it to the case's `output/` for review
 * with a diff tool. This PR emits only the **deterministic half**: `request.json`
 * (the packaged prompt) and a minimal `meta.json`. Same skill + same context +
 * same params ⇒ identical bytes, so `request.json` doubles as a committed CI
 * snapshot (see tests/cli/eval.test.ts) — no LLM call, no API key. The
 * non-deterministic half (`response.md` / `drafts.json` from a real model call)
 * lands in PR 2.
 *
 * Context is assembled headlessly by `buildEvalContext` (./eval-context) over
 * the same Electron-free graph core the CLI already drives.
 */
import path from 'node:path';
import { promises as fs } from 'node:fs';
import * as graph from '../main/graph/index';
import { projectContext, type ProjectContext } from '../main/project-context-types';
import { getSettings } from '../main/llm/settings';
import { loadSkillCatalog } from '../main/skills/loader';
import { compileSkill } from '../main/skills/compile';
import {
  buildConversationPayload,
  buildOneShotPayload,
  resolveToolModel,
} from '../main/tools/executor';
import { buildConversationTools } from '../main/llm/tools/registry';
import type { ThinkingToolDef } from '../shared/tools/types';
import type { ConversationToolKey } from '../shared/conversation-tools';
import { jsonStringify } from './json';
import { buildEvalContext, type CaseContextRefs, type InlineInputs } from './eval-context';

/** The human-authored `input/case.json`. */
export interface EvalCaseManifest {
  /** ThinkingToolDef id, e.g. `planning.steelman`. */
  skill: string;
  /** Model to pin (recommended, so a model swap is a visible diff and the
   *  packaged request is env-independent). Omit to follow the skill/default. */
  model?: string;
  /** Path to the thoughtbase root, relative to the case dir. Required for cases
   *  that reference notes/sources/graph-derived context; omit for inline cases. */
  thoughtbase?: string;
  /** Context references — pointers into the thoughtbase and/or inline hints. */
  context?: CaseContextRefs;
  /** Skill parameter values, threaded in as `ctx.parameterValues`. */
  parameters?: Record<string, string>;
}

/** The packaged LLM request written to `output/request.json` — the bytes that
 *  would be sent to the model. Deterministic given skill + context + params. */
export interface PackagedRequest {
  skill: string;
  model?: string;
  /** System prompt — conversation skills only (one-shot has none). */
  system?: string;
  messages: { role: 'user'; content: string }[];
  /** Conversation skills only. */
  webEnabled?: boolean;
  /** Enabled client-side tool names — conversation skills only. */
  tools?: string[];
  /** Template-scoped extra tools the skill declared, if any. */
  requiresTools?: ConversationToolKey[];
}

export interface EvalMeta {
  skill: string;
  model?: string;
  outputMode: string;
}

export interface EvalResult {
  /** The case dir, as passed in. */
  caseDir: string;
  request: PackagedRequest;
  meta: EvalMeta;
}

export interface RunEvalOptions {
  cwd: string;
  /** Write each case's `output/` (overwriting). Default true; the snapshot test
   *  passes false to compare against the committed files without mutating them. */
  write?: boolean;
  /** User-skills dir to load on top of stock. Defaults to stock-only (an
   *  intentionally-absent path) so the catalog — and thus the packaged prompt —
   *  is identical on every machine and in CI. */
  userSkillsDir?: string;
}

/** A path that does not exist, so `loadSkillCatalog` loads stock skills only.
 *  User skills are per-machine and would make snapshots non-portable. */
function stockOnlyDir(cwd: string): string {
  return path.join(cwd, '.minerva', '__eval_stock_only__');
}

async function readManifest(caseDir: string): Promise<EvalCaseManifest> {
  const raw = await fs.readFile(path.join(caseDir, 'input', 'case.json'), 'utf-8');
  const manifest = JSON.parse(raw) as EvalCaseManifest;
  if (!manifest.skill) throw new Error(`${caseDir}: case.json is missing "skill"`);
  return manifest;
}

/** Read any `input/*` inline overrides for synthetic (non-thoughtbase) cases. */
async function readInlineInputs(caseDir: string): Promise<InlineInputs> {
  const inputDir = path.join(caseDir, 'input');
  const read = async (name: string): Promise<string | undefined> =>
    fs.readFile(path.join(inputDir, name), 'utf-8').catch(() => undefined);
  const inline: InlineInputs = {};
  const note = await read('note.md');
  if (note !== undefined) inline.note = note;
  const selection = await read('selection.txt');
  if (selection !== undefined) inline.selection = selection.replace(/\n$/, '');
  const sourceBody = await read('source.md');
  if (sourceBody !== undefined) inline.sourceBody = sourceBody;
  return inline;
}

/** Package one case into its request + meta. Pure w.r.t. the filesystem (reads
 *  only) — `runEval` layers the `output/` write on top. */
async function packageCase(
  manifest: EvalCaseManifest,
  inline: InlineInputs,
  def: ThinkingToolDef,
  ctx: ProjectContext,
  settings: Awaited<ReturnType<typeof getSettings>>,
): Promise<{ request: PackagedRequest; meta: EvalMeta }> {
  const context = await buildEvalContext(ctx, def, manifest.context ?? {}, inline);
  if (manifest.parameters) context.parameterValues = manifest.parameters;

  // Record the effective model directly (not the payload's UI-omitted field) so a
  // pinned model is always visible and a model swap shows up as a diff.
  const model = resolveToolModel(def, settings, manifest.model);

  if (def.outputMode === 'openConversation') {
    const payload = buildConversationPayload(def, settings, {
      context,
      ...(manifest.model ? { modelOverride: manifest.model } : {}),
    });
    const request: PackagedRequest = {
      skill: def.id,
      ...(model ? { model } : {}),
      system: payload.systemPrompt,
      messages: [{ role: 'user', content: payload.firstMessage }],
      webEnabled: payload.webEnabled,
      tools: buildConversationTools({ extraTools: payload.requiresTools }).map((t) => t.name),
      ...(payload.requiresTools ? { requiresTools: payload.requiresTools } : {}),
    };
    return { request, meta: { skill: def.id, ...(model ? { model } : {}), outputMode: def.outputMode } };
  }

  const { prompt } = buildOneShotPayload(def, settings, {
    context,
    ...(manifest.model ? { modelOverride: manifest.model } : {}),
  });
  const request: PackagedRequest = {
    skill: def.id,
    ...(model ? { model } : {}),
    messages: [{ role: 'user', content: prompt }],
  };
  return { request, meta: { skill: def.id, ...(model ? { model } : {}), outputMode: def.outputMode } };
}

/**
 * Run one or more eval cases. Packages each case's prompt as Minerva would and,
 * unless `write` is false, overwrites the case's `output/{request.json,meta.json}`.
 */
export async function runEval(caseDirs: string[], opts: RunEvalOptions): Promise<EvalResult[]> {
  const catalog = await loadSkillCatalog(opts.userSkillsDir ?? stockOnlyDir(opts.cwd));
  const defs = new Map<string, ThinkingToolDef>(catalog.skills.map((s) => [s.id, compileSkill(s)]));
  const settings = await getSettings();

  // One graph init per thoughtbase root, reused across cases that share it.
  const ctxCache = new Map<string, ProjectContext>();
  const ensureThoughtbase = async (root: string): Promise<ProjectContext> => {
    let ctx = ctxCache.get(root);
    if (!ctx) {
      ctx = projectContext(root);
      await graph.initGraph(ctx);
      await graph.indexAllNotes(ctx);
      ctxCache.set(root, ctx);
    }
    return ctx;
  };

  const results: EvalResult[] = [];
  for (const given of caseDirs) {
    const caseDir = path.resolve(opts.cwd, given);
    const manifest = await readManifest(caseDir);
    const inline = await readInlineInputs(caseDir);

    const def = defs.get(manifest.skill);
    if (!def) throw new Error(`${given}: unknown skill "${manifest.skill}"`);

    // Only cases that reference the thoughtbase need a live graph; inline cases
    // run against an uninitialized ctx (graph lookups return empty, file reads
    // use the inline bodies).
    const ctx = manifest.thoughtbase
      ? await ensureThoughtbase(path.resolve(caseDir, manifest.thoughtbase))
      : projectContext(caseDir);

    const { request, meta } = await packageCase(manifest, inline, def, ctx, settings);

    if (opts.write !== false) {
      const outDir = path.join(caseDir, 'output');
      await fs.mkdir(outDir, { recursive: true });
      await fs.writeFile(path.join(outDir, 'request.json'), `${jsonStringify(request, true)}\n`, 'utf-8');
      await fs.writeFile(path.join(outDir, 'meta.json'), `${jsonStringify(meta, true)}\n`, 'utf-8');
    }

    results.push({ caseDir: given, request, meta });
  }
  return results;
}
