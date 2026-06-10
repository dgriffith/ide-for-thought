/**
 * Skill file format (#624, part of #622).
 *
 * A skill is a markdown file (or a folder with SKILL.md) whose YAML
 * frontmatter declares metadata and whose body is the prompt template (system
 * prompt for `openConversation` skills; the one-shot prompt for `newNote`).
 * `firstMessage` lives in frontmatter. These types are the parsed/compiled
 * shapes shared across processes; rendering of the templates happens in main.
 */

import type {
  ContextRequirement,
  OutputMode,
  ToolCategory,
  ToolParameter,
  ToolScope,
} from '../tools/types';
import type { MenuConfig } from './menu-config';

export type SkillMenu = 'Learning' | 'Research' | 'Analysis';

export const SKILL_MENUS: readonly SkillMenu[] = ['Learning', 'Research', 'Analysis'];

/** Skill `menu:` (display-cased) ↔ the registry's lowercase ToolCategory. */
export function menuToCategory(menu: SkillMenu): ToolCategory {
  return menu.toLowerCase() as ToolCategory;
}

export function categoryToMenu(category: ToolCategory): SkillMenu {
  return (category.charAt(0).toUpperCase() + category.slice(1)) as SkillMenu;
}

/** Where a skill was loaded from. User skills can only add, never shadow stock. */
export type SkillSource = 'stock' | 'user';

/**
 * A validated, loaded skill. `body` and `firstMessage` are template strings
 * (see src/main/skills/template.ts) rendered in main at prepare/execute time.
 */
export interface SkillDef {
  id: string;
  name: string;
  description: string;
  longDescription: string;
  menu: SkillMenu;
  /** Optional thematic sub-group within the menu (#525). Omit for a flat menu. */
  group?: string;
  /** Invocation surface + subject (#103). `source` skills live in the Source
   *  viewer and get source context; absent/`note` is the default. */
  scope: ToolScope;
  outputMode: OutputMode;
  context: ContextRequirement[];
  parameters: ToolParameter[];
  /** Conversation tools the skill advertises. Empty/omitted = default set. */
  tools: string[];
  /** Web access default for conversational skills. */
  web: boolean;
  /** Tool author's preferred model; falls back to the global default. */
  model?: string;
  slashCommand?: string;
  outputNotePrefix?: string;
  requiresSelection: boolean;
  /** Auto-fired first user message (template). Empty = let the user start. */
  firstMessage: string;
  /** Prompt body (template) — system prompt or one-shot prompt. */
  body: string;
  source: SkillSource;
  /** Absolute path for user skills; the glob key for stock skills. */
  filePath: string;
}

/** Serializable metadata sent to the renderer over IPC — no template bodies. */
export interface SkillInfo {
  id: string;
  name: string;
  description: string;
  longDescription: string;
  menu: SkillMenu;
  group?: string;
  scope: ToolScope;
  outputMode: OutputMode;
  context: ContextRequirement[];
  parameters: ToolParameter[];
  model?: string;
  web: boolean;
  slashCommand?: string;
  outputNotePrefix?: string;
  requiresSelection: boolean;
  source: SkillSource;
}

export interface SkillLoadError {
  source: SkillSource;
  /** File path or glob key the error came from. */
  filePath: string;
  /** Best-effort skill name/id if it parsed far enough; else the filename. */
  label: string;
  message: string;
}

export interface SkillCatalog {
  skills: SkillDef[];
  errors: SkillLoadError[];
}

export interface SkillCatalogInfo {
  skills: SkillInfo[];
  errors: SkillLoadError[];
  /** The per-machine menu config (#630) the renderer applies + edits. */
  config: MenuConfig;
}

export function toSkillInfo(s: SkillDef): SkillInfo {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    longDescription: s.longDescription,
    menu: s.menu,
    group: s.group,
    scope: s.scope,
    outputMode: s.outputMode,
    context: s.context,
    parameters: s.parameters,
    model: s.model,
    web: s.web,
    slashCommand: s.slashCommand,
    outputNotePrefix: s.outputNotePrefix,
    requiresSelection: s.requiresSelection,
    source: s.source,
  };
}
