export type ToolCategory = 'learning' | 'research' | 'analysis' | 'planning';

export type ContextRequirement =
  | 'selectedText'
  | 'fullNote'
  | 'relatedNotes'
  | 'taggedNotes';

export type OutputMode =
  | 'newNote'
  | 'appendToNote'
  | 'replaceSelection'
  | 'insertAtCursor'
  | 'multipleNotes'
  | 'openConversation';

export interface ToolParameter {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'select' | 'number';
  placeholder?: string;
  options?: { label: string; value: string }[];
  defaultValue?: string;
  required?: boolean;
}

export interface ToolContext {
  selectedText?: string;
  fullNoteContent?: string;
  fullNotePath?: string;
  fullNoteTitle?: string;
  relatedNotes?: { path: string; title: string; content: string }[];
  taggedNotes?: { path: string; title: string; content: string }[];
  parameterValues?: Record<string, string>;
}

export interface ToolWebHint {
  /** Whether the tool expects web access on by default when invoked. */
  defaultEnabled: boolean;
}

export interface ThinkingToolDef {
  id: string;
  name: string;
  category: ToolCategory;
  description: string;
  longDescription: string;
  context: ContextRequirement[];
  parameters?: ToolParameter[];
  outputMode: OutputMode;
  outputNotePrefix?: string;
  slashCommand?: string;
  /** Used for one-shot tools. Conversational tools use buildSystemPrompt + buildFirstMessage. */
  buildPrompt: (ctx: ToolContext) => string;
  /** Tool-specific system prompt for `outputMode: 'openConversation'`. Stays active across all sends in the conversation. */
  buildSystemPrompt?: (ctx: ToolContext) => string;
  /** User message auto-fired when the conversation opens. Optional — omit to let the user type the first thing. */
  buildFirstMessage?: (ctx: ToolContext) => string;
  /**
   * Tool author's hint at the model that suits this tool best. User-level
   * overrides (LLMSettings.toolModelOverrides) win over this; the global
   * default takes over when both are absent.
   */
  preferredModel?: string;
  /** Web-access hint for conversational tools. Global `LLMSettings.web.enabled` still gates. */
  web?: ToolWebHint;
  /** When true, the tool refuses to run without a non-empty `ctx.selectedText`. The editor right-click hides it, the menu-bar entry fails fast with a clear error. */
  requiresSelection?: boolean;
}

/** Serializable subset of ThinkingToolDef sent over IPC (no functions). */
export interface ThinkingToolInfo {
  id: string;
  name: string;
  category: ToolCategory;
  description: string;
  longDescription: string;
  context: ContextRequirement[];
  parameters?: ToolParameter[];
  outputMode: OutputMode;
  outputNotePrefix?: string;
  slashCommand?: string;
  preferredModel?: string;
  web?: ToolWebHint;
  requiresSelection?: boolean;
}

export interface ToolExecutionRequest {
  toolId: string;
  context: ToolContext;
}

export interface ToolExecutionResult {
  toolId: string;
  output: string;
  suggestedTitle?: string;
  suggestedFilename?: string;
  sections?: { title: string; content: string }[];
}

/** Payload returned by the `prepareConversationTool` path for `outputMode: 'openConversation'`. */
export interface ConversationToolPayload {
  toolId: string;
  systemPrompt: string;
  firstMessage: string;
  /** Model to pin on the created conversation. Undefined means track the global default. */
  model?: string;
  /** Whether the tool wants web access on. Actual effect also depends on global `LLMSettings.web.enabled`. */
  webEnabled: boolean;
}

export interface WebSettings {
  enabled: boolean;
  allowedDomains: string[];
  blockedDomains: string[];
}

export interface LLMSettings {
  apiKey: string;
  model: string;
  web?: WebSettings;
  /**
   * User-level overrides of each tool's preferred model. Keyed by tool id.
   * Resolution order for a tool invocation:
   *   request.modelOverride ?? toolModelOverrides[id] ?? tool.preferredModel ?? model
   */
  toolModelOverrides?: Record<string, string>;
}

export const DEFAULT_WEB_SETTINGS: WebSettings = {
  enabled: true,
  allowedDomains: [],
  blockedDomains: [],
};
