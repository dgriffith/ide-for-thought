/**
 * `offer_extension_draft` (#2652): show the user a drafted skill or plugin as
 * a card, and wait for what they do with it. Template-scoped, like
 * `ask_user`: only a skill that lists it in `tools:` gets it (the stock
 * Extend Minerva skill does).
 *
 * The tool writes nothing. It checks the draft in memory
 * (`extensions/draft-check.ts`: every path through `draftPathProblem`, the
 * manifest through the plugin checker, each skill through the parser). A
 * skill goes to the card, and main writes it only when the user presses Save
 * or Save to folder, from that copy. A plugin is LLM output that can carry
 * code, so it's filed as a proposal instead (#2890, `llm/plugin-proposals.ts`):
 * `plugin_install`, or `plugin_update` diffed against the installed files,
 * reviewed in the Proposals panel. A draft that fails the check comes back to
 * the model with every problem, so it can fix and offer again.
 */
import { EXTENSION_DRAFT_LIMITS, type ExtensionDraftOutcome } from '../../../shared/extensions/drafts';
import { checkExtensionDraft } from '../../extensions/draft-check';
import { pluginsAppVersion } from '../../plugins/registry';
import { getSkillCatalog } from '../../skills/loader';
import type { NotebaseTool, ToolResult } from './types';
import path from 'node:path';
import fs from 'node:fs';
import { fileDraftedPlugin } from '../plugin-proposals';
import { readDraftFiles } from '../../plugins/draft-files';
import { activePluginsDir } from '../../plugins/registry';
import { isCorePluginId } from '../../plugins/core';
import * as conversation from '../conversation';
import { logger } from '../../../shared/logger';
import type { CheckedExtensionDraft } from '../../extensions/draft-check';

/** What the user did with a skill's card. */
function describe(outcome: ExtensionDraftOutcome): string {
  switch (outcome.kind) {
    case 'saved':
      return `The user saved the skill to ${outcome.where}. It's in the menus now.`;
    case 'saved-folder':
      return `The user saved the draft to ${outcome.where}. Nothing is installed.`;
    case 'dismissed':
      return 'The user dismissed the draft. Nothing was saved.';
    case 'cancelled':
      return 'The turn ended before the user chose. Nothing was saved.';
    case 'no-ui':
      return 'There was no window to show the draft in. Nothing was saved.';
  }
}

/** File a drafted plugin as a proposal (#2890): an install, or an update of the one installed. */
async function proposePlugin(rootPath: string, conversationId: string, draft: CheckedExtensionDraft): Promise<ToolResult> {
  if (isCorePluginId(draft.id)) {
    return { content: `"${draft.id}" is one of Minerva's built-in plugins; give the plugin another id.`, isError: true };
  }
  const folder = path.join(activePluginsDir(), draft.id);
  let installed: { path: string; content: string }[] | null = null;
  if (fs.existsSync(folder)) {
    installed = await readDraftFiles(folder);
    if (!installed) {
      return { content: `The installed ${draft.id} plugin isn't one a draft can change (it holds binary files, links, or more than a draft may). Give it another id, or tell the user what to change.`, isError: true };
    }
  }
  // The model, for the proposal's provenance; a transcript that won't load leaves it out.
  const model = (await conversation.load(rootPath, conversationId).catch((err: unknown) => {
    logger('conversation').warn(`couldn't read ${conversationId} for its model:`, err);
    return null;
  }))?.model;
  let filed: 'install' | 'update';
  try {
    filed = await fileDraftedPlugin(rootPath, conversationId, draft, installed, model);
  } catch (err) {
    // Already pending, or the approval engine refused it: the model reads why.
    return { content: err instanceof Error ? err.message : String(err), isError: true };
  }
  return {
    content: filed === 'update'
      ? `Filed as a PENDING proposal to change the installed ${draft.name} plugin. Nothing is written yet: the user reviews the diff in the Proposals panel, and approving writes it${draft.files.some((f) => f.path === 'plugin.json' && f.content.includes('"code"')) ? ', then Minerva asks them natively to allow its code' : ''}. Don't file it again.`
      : `Filed as a PENDING proposal to install the ${draft.name} plugin. Nothing is installed yet: the user reviews its manifest, capabilities and files in the Proposals panel, and approving installs it${draft.files.some((f) => f.path === 'plugin.json' && f.content.includes('"code"')) ? ', then Minerva asks them natively to allow its code' : ''}. Any MCP server it ships stays off until they switch it on. Don't file it again.`,
    isError: false,
  };
}

export const offerExtensionDraft: NotebaseTool = {
  definition: {
    name: 'offer_extension_draft',
    description:
      'Offer the user a drafted skill or plugin. A skill is shown as a card they can save or save to a folder, and ' +
      'this waits for their choice. A plugin is filed as a pending proposal in the Proposals panel (an install, or a ' +
      'change to the installed plugin of that id, shown as a diff); nothing is installed until they approve it there. ' +
      'You write nothing yourself: the user decides. The draft is checked first (the skill parser, the ' +
      'plugin manifest checker); if it fails, you get every problem back and nothing is shown, so fix it and call ' +
      'again. A skill is ONE file, "<name>.md" or "<name>/SKILL.md". A plugin is its folder\'s files, plugin.json ' +
      'at the top, each listed contribution present. Call it once per draft, after the user has agreed what it should do.',
    input_schema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['skill', 'plugin'], description: 'What the files are.' },
        summary: {
          type: 'string',
          description: `One or two sentences the card shows: what this adds and why this rung. At most ${EXTENSION_DRAFT_LIMITS.summary} characters.`,
        },
        files: {
          type: 'array',
          maxItems: EXTENSION_DRAFT_LIMITS.files,
          description: 'Every file, by its path inside the skill or plugin folder ("plugin.json", "skills/x.md").',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Relative, "/"-separated, plain names only (no "..", no leading ".").' },
              content: { type: 'string', description: 'The whole file.' },
            },
            required: ['path', 'content'],
          },
        },
      },
      required: ['kind', 'summary', 'files'],
    },
  },
  async run(ctx, input, callbacks): Promise<ToolResult> {
    const catalog = await getSkillCatalog();
    const checked = checkExtensionDraft(input, {
      appVersion: pluginsAppVersion(),
      takenSkillIds: new Set(catalog.skills.map((s) => s.id)),
    });
    if (!checked.ok) {
      return { content: `The draft wasn't shown; fix these and offer it again:\n- ${checked.problems.join('\n- ')}`, isError: true };
    }
    if (checked.draft.kind === 'plugin') {
      if (!ctx.conversationId) return { content: 'offer_extension_draft needs a conversation to file a plugin from.', isError: true };
      return proposePlugin(ctx.rootPath, ctx.conversationId, checked.draft);
    }
    if (!callbacks.offerExtensionDraft) {
      return { content: 'offer_extension_draft has no conversation window to show the draft in. Give the files in your reply instead.', isError: true };
    }
    const outcome = await callbacks.offerExtensionDraft(checked.draft);
    return { content: describe(outcome), isError: false };
  },
};
