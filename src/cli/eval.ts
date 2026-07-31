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
import {
  complete,
  completeWithTools,
  type CompleteOptions,
  type CompleteWithToolsOptions,
  type CompleteWithToolsResult,
  type StreamCallbacks,
} from '../main/llm/index';
import type { ThinkingToolDef } from '../shared/tools/types';
import type { ConversationToolKey } from '../shared/conversation-tools';
import type { TurnUsage } from '../shared/types';
import { jsonStringify } from './json';
import {
  buildEvalContext,
  applyParamDefaults,
  resolveNoteParamCompanions,
  type CaseContextRefs,
  type InlineInputs,
} from './eval-context';

// Injected by the CLI build (vite.cli.config.ts); absent under vitest — the
// `typeof` guard at the use site falls back to 'unknown', matching register-app.ts.
declare const __APP_COMMIT__: string;

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
  /** Live-run fields (#1522 PR 2) — present only when `--live` made a real call. */
  usage?: TurnUsage;
  usageModel?: string;
  /** Wall-clock duration of the model call, milliseconds. */
  timingMs?: number;
  /** Number of proposal drafts the model produced (mirrors drafts.json length). */
  draftCount?: number;
  /** Short git commit of the CLI build that produced this run. */
  harnessVersion?: string;
  /** Set when the live call failed for this case (the batch still continues). */
  error?: string;
}

/** A proposal draft captured from the live agentic loop via a `StreamCallbacks`
 *  callback (propose_notes → `onDraft`, etc.). `kind` names the callback so the
 *  reviewer can tell note vs claim vs source drafts apart. */
export interface CapturedDraft {
  kind: string;
  draft: unknown;
}

/** The non-deterministic half of a case — only produced by a `--live` run. */
export interface LiveOutput {
  response: string;
  drafts: CapturedDraft[];
  usage?: TurnUsage;
  usageModel?: string;
  timingMs: number;
  /** Present when the model call threw — the batch records it and moves on. */
  error?: string;
}

export interface EvalResult {
  /** The case dir, as passed in. */
  caseDir: string;
  request: PackagedRequest;
  meta: EvalMeta;
  /** Present only when `opts.live` made a real model call. */
  live?: LiveOutput;
}

/** The two model-call entry points the harness drives, injectable so the live
 *  path is testable without a real provider / API key. Defaults to the real
 *  `complete` / `completeWithTools`. */
export interface LlmSeam {
  complete(prompt: string, opts?: CompleteOptions): Promise<string>;
  completeWithTools(opts: CompleteWithToolsOptions): Promise<CompleteWithToolsResult>;
}

const REAL_LLM: LlmSeam = { complete, completeWithTools };

export interface RunEvalOptions {
  cwd: string;
  /** Write each case's `output/` (overwriting). Default true; the snapshot test
   *  passes false to compare against the committed files without mutating them. */
  write?: boolean;
  /** Make a real model call and capture `response.md` + `drafts.json` (#1522 PR
   *  2). Opt-in, off by default; needs a provider API key in the environment. */
  live?: boolean;
  /** Injectable LLM seam for the live path. Defaults to the real provider calls;
   *  tests pass a fake to exercise capture without spending tokens. */
  llm?: LlmSeam;
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
  // Pre-fill param defaults (as the invocation dialog does), then resolve any
  // `note`-type param's companion vars (`{{param.<id>.content/title}}`) from the
  // thoughtbase — so the rendered prompt matches what Minerva would send.
  const paramValues = applyParamDefaults(def, manifest.parameters ?? {});
  if (Object.keys(paramValues).length > 0) {
    context.parameterValues = await resolveNoteParamCompanions(ctx, def, paramValues);
  }

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
 * Drive a real model call for a packaged case and capture the non-deterministic
 * half — the response text and any proposal drafts (#1522 PR 2). Reuses the exact
 * runtime call: `complete` for one-shot skills, `completeWithTools` for
 * conversation skills, with a notebase `toolContext` and the same draft callbacks
 * `register-conversation.ts` wires — so `propose_notes` etc. surface as captured
 * drafts (they fire the callback and only touch the graph on human approval, so
 * nothing is written to the thoughtbase here).
 */
async function runLive(
  request: PackagedRequest,
  rootPath: string,
  caseName: string,
  llm: LlmSeam,
): Promise<LiveOutput> {
  const drafts: CapturedDraft[] = [];
  const capture = (kind: string) => (draft: unknown) => {
    drafts.push({ kind, draft });
  };
  const start = Date.now();

  try {
    // A one-shot skill (no system prompt) is a plain completion — no tools, no
    // drafts.
    if (request.system === undefined) {
      let usage: TurnUsage | undefined;
      let usageModel: string | undefined;
      const text = await llm.complete(request.messages[0]!.content, {
        ...(request.model ? { model: request.model } : {}),
        onUsage: (u, m) => {
          usage = u;
          usageModel = m;
        },
      });
      return {
        response: text,
        drafts,
        ...(usage ? { usage } : {}),
        ...(usageModel ? { usageModel } : {}),
        timingMs: Date.now() - start,
      };
    }

    const callbacks: StreamCallbacks = {
      onChunk: () => {},
      onDraft: capture('notes'),
      onSourceDraft: capture('sources'),
      onPropertyDraft: capture('properties'),
      onSourcePropertyDraft: capture('source_properties'),
      onClaimsDraft: capture('claims'),
      onComputeDraft: capture('compute'),
      onRefactorDraft: capture('refactor'),
      onReorgDraft: capture('reorg'),
      onDeleteDraft: capture('delete'),
      onNoteBodyDraft: capture('note_body'),
    };
    const result = await completeWithContainerRetry(llm, {
      system: request.system,
      messages: request.messages,
      toolContext: { rootPath, conversationId: `eval:${caseName}` },
      ...(request.model ? { model: request.model } : {}),
      ...(request.requiresTools ? { extraTools: request.requiresTools } : {}),
      // Honor the skill's declared web setting: a `web: false` skill runs without
      // web tools (the global default is on headless, and per-skill web isn't yet
      // wired in the app — so the harness enforces the declaration itself).
      ...(request.webEnabled === false ? { web: { enabled: false } } : {}),
      callbacks,
    });
    return {
      response: result.text,
      drafts,
      usage: result.usage,
      usageModel: result.usageModel,
      timingMs: Date.now() - start,
    };
  } catch (err) {
    // A live batch must not die because one case errored (e.g. a provider 400) —
    // capture it, write it as this case's response, and let the batch continue.
    const msg = err instanceof Error ? err.message : String(err);
    return { response: `[eval error] ${msg}`, drafts, error: msg, timingMs: Date.now() - start };
  }
}

/** Marker for the API 400 raised when a `server_tool_use` (web_search / code
 *  execution) block is pending but no sandbox id was echoed back. */
const CONTAINER_REQUIRED_MARKER = 'container_id is required';

/**
 * `completeWithTools` with the same one-shot recovery `register-conversation.ts`
 * applies: web-grounded turns produce a code-execution container the API then
 * demands back, and a headless run can trip its "container_id is required" 400.
 * Retry once — for a fresh eval call there's no prior history to strip, so this
 * is a plain re-attempt; a persistent failure propagates to the per-case handler.
 */
async function completeWithContainerRetry(
  llm: LlmSeam,
  opts: CompleteWithToolsOptions,
): Promise<CompleteWithToolsResult> {
  try {
    return await llm.completeWithTools(opts);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes(CONTAINER_REQUIRED_MARKER)) throw err;
    return await llm.completeWithTools(opts);
  }
}

/**
 * Run one or more eval cases. Packages each case's prompt as Minerva would and,
 * unless `write` is false, overwrites the case's `output/`. Writes `request.json`
 * + `meta.json` always; a `--live` run additionally makes a real model call and
 * writes `response.md` + `drafts.json` (and enriches `meta.json` with usage +
 * timing).
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

    let live: LiveOutput | undefined;
    if (opts.live) {
      live = await runLive(request, ctx.rootPath, path.basename(caseDir), opts.llm ?? REAL_LLM);
      meta.timingMs = live.timingMs;
      meta.draftCount = live.drafts.length;
      meta.harnessVersion = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'unknown';
      if (live.usage) meta.usage = live.usage;
      if (live.usageModel) meta.usageModel = live.usageModel;
      if (live.error) meta.error = live.error;
    }

    if (opts.write !== false) {
      const outDir = path.join(caseDir, 'output');
      await fs.mkdir(outDir, { recursive: true });
      await fs.writeFile(path.join(outDir, 'request.json'), `${jsonStringify(request, true)}\n`, 'utf-8');
      await fs.writeFile(path.join(outDir, 'meta.json'), `${jsonStringify(meta, true)}\n`, 'utf-8');
      if (live) {
        await fs.writeFile(path.join(outDir, 'response.md'), `${live.response.replace(/\n*$/, '')}\n`, 'utf-8');
        await fs.writeFile(path.join(outDir, 'drafts.json'), `${jsonStringify(live.drafts, true)}\n`, 'utf-8');
      }
    }

    results.push({ caseDir: given, request, meta, ...(live ? { live } : {}) });
  }
  return results;
}
