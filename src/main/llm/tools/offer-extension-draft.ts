/**
 * `offer_extension_draft` (#2652): show the user a drafted skill or plugin as
 * a card, and wait for what they do with it. Template-scoped, like
 * `ask_user`: only a skill that lists it in `tools:` gets it (the stock
 * Extend Minerva skill does).
 *
 * The tool writes nothing. It checks the draft in memory
 * (`extensions/draft-check.ts`: every path through `draftPathProblem`, the
 * manifest through the plugin checker, each skill through the parser) and
 * hands the checked copy to the card. Main writes it only when the user
 * presses Save, Install or Save to folder, from that copy; installing a
 * plugin runs none of its MCP servers. A draft that fails the check comes
 * back to the model with every problem, so it can fix and offer again.
 */
import { EXTENSION_DRAFT_LIMITS, type ExtensionDraftOutcome } from '../../../shared/extensions/drafts';
import { checkExtensionDraft } from '../../extensions/draft-check';
import { pluginsAppVersion } from '../../plugins/registry';
import { getSkillCatalog } from '../../skills/loader';
import type { NotebaseTool, ToolResult } from './types';

function describe(outcome: ExtensionDraftOutcome, kind: 'skill' | 'plugin'): string {
  switch (outcome.kind) {
    case 'saved':
      return kind === 'skill'
        ? `The user saved the skill to ${outcome.where}. It's in the menus now.`
        : `The user installed the plugin (${outcome.where}). Its contributions are live; any MCP server it ships is off until they switch it on in Settings → MCP Servers.`;
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

export const offerExtensionDraft: NotebaseTool = {
  definition: {
    name: 'offer_extension_draft',
    description:
      'Show the user a drafted skill or plugin as a card they can save, install, or save to a folder, and wait for ' +
      'their choice. You write nothing yourself: the user decides. The draft is checked first (the skill parser, the ' +
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
  async run(_ctx, input, callbacks): Promise<ToolResult> {
    if (!callbacks.offerExtensionDraft) {
      return { content: 'offer_extension_draft has no conversation window to show the draft in. Give the files in your reply instead.', isError: true };
    }
    const catalog = await getSkillCatalog();
    const checked = checkExtensionDraft(input, {
      appVersion: pluginsAppVersion(),
      takenSkillIds: new Set(catalog.skills.map((s) => s.id)),
    });
    if (!checked.ok) {
      return { content: `The draft wasn't shown; fix these and offer it again:\n- ${checked.problems.join('\n- ')}`, isError: true };
    }
    const outcome = await callbacks.offerExtensionDraft(checked.draft);
    return { content: describe(outcome, checked.draft.kind), isError: false };
  },
};
