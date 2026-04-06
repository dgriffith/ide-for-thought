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
  | 'multipleNotes';

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
  buildPrompt: (ctx: ToolContext) => string;
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

export interface LLMSettings {
  apiKey: string;
  model: string;
}
