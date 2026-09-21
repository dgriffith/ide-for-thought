import * as fs from '../../notebase/fs';
import { getAllTools, getToolDef } from '../../../shared/tools/registry';
import {
  isSourceScoped,
  toolRequiresNote,
  type ContextRequirement,
  type OutputMode,
  type ThinkingToolMeta,
  type ToolContext as SkillToolContext,
} from '../../../shared/tools/types';
import type { NotebaseTool, ToolContext, ToolResult } from './types';

/**
 * run_skill (#2165) — lets the model reach for one of the thoughtbase's
 * authored skills (the same prompts behind the Learning/Research/Analysis
 * menus) on its own judgment, instead of requiring the user to have already
 * picked it from a menu.
 *
 * Deliberately does NOT execute the skill itself: doing so would mean either
 * (a) writing the result to disk directly, like the menu-driven path
 * (`renderer/lib/tools/output.ts`) does — which is fine there because a
 * human's menu click is itself the confirmation, but would bypass the trust
 * principle for a model-initiated run — or (b) firing a nested `complete()`
 * call from inside a tool, which would both duplicate the review-gating this
 * tool would then have to reinvent AND import back into `llm/index.ts` from
 * a tool `llm/index.ts` itself registers (an import cycle; see
 * `tests/architecture/no-cycles.test.ts`).
 *
 * Instead, this tool renders the skill's prompt template with the requested
 * context and hands the TEXT back as the tool result — the same shape Claude
 * Code's own Skill tool uses (load instructions into context; the same agent
 * carries them out). The model then follows those instructions itself, using
 * its existing `propose_notes` / `propose_note_body` tools to file whatever
 * the skill produces — so the result goes through the exact same review card
 * and approval path any other conversational note creation does, with no new
 * drafting code here.
 */

const RUNNABLE_OUTPUT_MODES = new Set<OutputMode>([
  'newNote',
  'multipleNotes',
  'insertAtCursor',
  'appendToNote',
]);

// Context this tool has no way to gather mid-conversation (no live editor
// selection/cursor, no active Source viewer tab) or hasn't been wired up for
// yet (source metadata/body — left as a follow-up, see #2165).
const UNSUPPORTED_CONTEXT = new Set<ContextRequirement>([
  'relatedNotes',
  'taggedNotes',
  'claimUnderCursor',
  'selectionRange',
  'sourceMetadata',
  'sourceBody',
]);

function isSkillRunnable(tool: ThinkingToolMeta): boolean {
  if (!RUNNABLE_OUTPUT_MODES.has(tool.outputMode)) return false;
  if (isSourceScoped(tool)) return false;
  if (tool.requiresSelection) return false;
  if (tool.context.some((c) => UNSUPPORTED_CONTEXT.has(c))) return false;
  // A `note`-type parameter resolves to `{{param.<id>.content}}` /
  // `{{param.<id>.title}}` via a note picker in the menu-driven dialog
  // (ToolParamsDialog.svelte) — there's no equivalent resolution here yet.
  if ((tool.parameters ?? []).some((p) => p.type === 'note')) return false;
  return true;
}

/** The live catalog of skills `run_skill` can run, rendered into the tool's
 *  description per-conversation — same pattern as `describeMcpCatalog`. */
export function describeSkillCatalog(): string {
  const skills = getAllTools().filter(isSkillRunnable);
  if (skills.length === 0) return '';
  const lines = skills.map((s) => {
    const params = (s.parameters ?? [])
      .map((p) => (p.required ? `${p.id}*` : p.id))
      .join(', ') || 'none';
    const noteHint = toolRequiresNote(s) ? ' [needs notePath]' : '';
    const outputHint = s.outputMode === 'appendToNote' ? ' [appends to notePath]' : ' [produces a new note]';
    return `- ${s.id} (${s.name}): ${s.description}${noteHint}${outputHint} (params: ${params})`;
  });
  return `\n\nAvailable skills (* = required param):\n${lines.join('\n')}`;
}

interface RunSkillInput {
  skillId: string;
  notePath?: string;
  parameterValues?: Record<string, string>;
}

function parseInput(input: unknown): RunSkillInput | { error: string } {
  if (!input || typeof input !== 'object') return { error: 'run_skill input must be an object.' };
  const obj = input as Record<string, unknown>;
  const skillId = typeof obj.skillId === 'string' ? obj.skillId.trim() : '';
  if (!skillId) {
    return { error: 'run_skill requires a non-empty `skillId` — see the catalog in this tool\'s description.' };
  }
  const result: RunSkillInput = { skillId };
  const notePath = typeof obj.notePath === 'string' ? obj.notePath.trim() : '';
  if (notePath) result.notePath = notePath;
  if (obj.parameterValues && typeof obj.parameterValues === 'object') {
    const parameterValues: Record<string, string> = {};
    for (const [k, v] of Object.entries(obj.parameterValues as Record<string, unknown>)) {
      if (typeof v === 'string') parameterValues[k] = v;
    }
    result.parameterValues = parameterValues;
  }
  return result;
}

function titleFromPath(relativePath: string): string {
  const base = relativePath.split('/').pop() ?? relativePath;
  return base.replace(/\.md$/, '');
}

/** Fill in any declared parameter the model omitted with its authored
 *  default — mirrors what `ToolParamsDialog.svelte` pre-fills into the form
 *  before a menu-driven run, so a skill behaves the same either way. */
function withParamDefaults(
  tool: ThinkingToolMeta,
  values: Record<string, string> | undefined,
): Record<string, string> {
  const merged = { ...values };
  for (const p of tool.parameters ?? []) {
    if (merged[p.id] === undefined) merged[p.id] = p.defaultValue ?? '';
  }
  return merged;
}

async function runRunSkill(ctx: ToolContext, input: unknown): Promise<ToolResult> {
  const parsed = parseInput(input);
  if ('error' in parsed) return { content: parsed.error, isError: true };

  // `getToolDef`, not `getTool`: this path renders the prompt body, so it needs
  // the runnable definition rather than the metadata half (#2235).
  const tool = getToolDef(parsed.skillId);
  if (!tool || !isSkillRunnable(tool)) {
    return {
      content: `Unknown or unsupported skill "${parsed.skillId}". See the catalog in this tool's description for skills run_skill can run.`,
      isError: true,
    };
  }

  if (toolRequiresNote(tool) && !parsed.notePath) {
    return { content: `Skill "${tool.id}" needs a note — pass \`notePath\`.`, isError: true };
  }

  const skillContext: SkillToolContext = {};
  if (parsed.notePath) {
    if (!(await fs.fileExists(ctx.rootPath, parsed.notePath))) {
      return { content: `No such note: ${parsed.notePath}`, isError: true };
    }
    skillContext.fullNoteContent = await fs.readFile(ctx.rootPath, parsed.notePath);
    skillContext.fullNotePath = parsed.notePath;
    skillContext.fullNoteTitle = titleFromPath(parsed.notePath);
  }
  skillContext.parameterValues = withParamDefaults(tool, parsed.parameterValues);

  let rendered: string;
  try {
    rendered = tool.buildPrompt(skillContext);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { content: `run_skill failed to render "${tool.id}": ${message}`, isError: true };
  }

  const filingHint = tool.outputMode === 'appendToNote'
    ? `Then call propose_note_body to append the result onto ${parsed.notePath} — that is the ONLY way to file it.`
    : 'Then call propose_notes to file the result as a new note — that is the ONLY way to file it.';

  return {
    content:
      `--- Skill: ${tool.name} ---\n${rendered}\n\n` +
      `(These are the skill's instructions, not a finished result — nothing has been ` +
      `generated or filed yet. Carry them out yourself now, in this conversation. ${filingHint})`,
    isError: false,
  };
}

export const runSkill: NotebaseTool = {
  definition: {
    name: 'run_skill',
    description:
      'Load one of the thoughtbase\'s authored skills — the same prompts available from ' +
      'the Learning/Research/Analysis menus — as instructions for you to carry out ' +
      'yourself, right now, in this conversation. Pass `skillId` from the catalog below, ' +
      'plus `notePath` when the catalog marks a skill [needs notePath], plus any ' +
      '`parameterValues` it declares (a param you omit uses its authored default). The ' +
      'tool result is the skill\'s rendered prompt, NOT a finished artifact — after ' +
      'reading it, follow its instructions and then file the outcome with your own ' +
      'propose_notes / propose_note_body call (the catalog entry says which). Do not ' +
      'write the result any other way.',
    input_schema: {
      type: 'object',
      properties: {
        skillId: { type: 'string', description: 'Skill id from the catalog below.' },
        notePath: {
          type: 'string',
          description: 'Thoughtbase-relative path of the note to run the skill on. Required when the catalog marks the skill [needs notePath].',
        },
        parameterValues: {
          type: 'object',
          description: 'Values for the skill\'s declared parameters, keyed by parameter id (see catalog). Omit a parameter to use its authored default.',
          additionalProperties: { type: 'string' },
        },
      },
      required: ['skillId'],
    },
  },
  run: (ctx, input) => runRunSkill(ctx, input),
};
