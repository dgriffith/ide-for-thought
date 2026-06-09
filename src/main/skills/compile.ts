/**
 * Compile a loaded SkillDef into a runtime ThinkingToolDef (#625).
 *
 * The executor and the menu already speak ThinkingToolDef — compiling skills
 * into that shape means `getTool(id)` finds them and the conversation /
 * newNote pipelines run them with no changes. The build* closures render the
 * skill's templates through the engine at prepare/execute time, exactly where
 * the old hardcoded builders ran.
 */

import type { ThinkingToolDef, ToolContext } from '../../shared/tools/types';
import { menuToCategory, type SkillDef } from '../../shared/skills/types';
import type { ConversationToolKey } from '../../shared/conversation-tools';
import { renderTemplate, toRenderContext } from './template';

const CONVERSATION_TOOL_KEYS: readonly ConversationToolKey[] = ['ask_user'];

export function compileSkill(skill: SkillDef): ThinkingToolDef {
  const render = (template: string, ctx: ToolContext): string =>
    renderTemplate(template, toRenderContext(ctx));

  // `tools:` is, for now, the set of opt-in conversation tools the skill wants
  // on top of the default set (only `ask_user` exists today). Unknown entries
  // are dropped — full per-skill tool restriction is a later concern, and the
  // non-regression default (omit = full default set) holds.
  const requiresTools = skill.tools.filter(
    (t): t is ConversationToolKey => (CONVERSATION_TOOL_KEYS as readonly string[]).includes(t),
  );

  const def: ThinkingToolDef = {
    id: skill.id,
    name: skill.name,
    category: menuToCategory(skill.menu),
    description: skill.description,
    longDescription: skill.longDescription,
    context: skill.context,
    parameters: skill.parameters,
    outputMode: skill.outputMode,
    buildPrompt: (ctx) => render(skill.body, ctx),
    requiresSelection: skill.requiresSelection,
    web: { defaultEnabled: skill.web },
  };
  if (skill.outputMode === 'openConversation') {
    def.buildSystemPrompt = (ctx) => render(skill.body, ctx);
    def.buildFirstMessage = (ctx) => render(skill.firstMessage, ctx);
  }
  if (skill.model) def.preferredModel = skill.model;
  if (skill.slashCommand) def.slashCommand = skill.slashCommand;
  if (skill.outputNotePrefix) def.outputNotePrefix = skill.outputNotePrefix;
  if (requiresTools.length > 0) def.requiresTools = requiresTools;
  return def;
}
