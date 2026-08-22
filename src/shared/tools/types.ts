import type { ProviderId } from './providers';

export type ToolCategory = 'learning' | 'research' | 'analysis';

export type ContextRequirement =
  | 'selectedText'
  | 'fullNote'
  | 'relatedNotes'
  | 'taggedNotes'
  /**
   * Extracts the thought:Claim URI from the editor's active selection
   * or current line, then looks up the claim's label and source-text
   * from the graph. Used by tools that operate on a specific claim
   * (Find Supporting / Opposing Arguments). When no claim is found,
   * `claimUri` is left undefined and the tool's `buildSystemPrompt`
   * is responsible for either erroring or producing a helpful message.
   */
  | 'claimUnderCursor'
  /**
   * Populates `selectionStartOffset` / `selectionEndOffset` (character
   * offsets in the active note) and `selectionStartLine` /
   * `selectionEndLine` (1-based, inclusive). Used by tools that
   * propose edits anchored at the original passage (#509). Independent
   * of `selectedText` — list both when you need verbatim text plus
   * coordinates. When the editor has no selection (cursor only), the
   * fields stay undefined; the tool decides whether to fall back or
   * error. Coordinates are valid against the note's content at gather
   * time; intervening edits between gather and apply may invalidate
   * them, and tools that round-trip should verify.
   */
  | 'selectionRange'
  /**
   * Source-scoped context (#103). Populated from the active Source viewer
   * tab, not the note editor. `sourceMetadata` fills `sourceId` /
   * `sourceTitle` / `sourceMetadata`; `sourceBody` additionally reads the
   * source's extracted `body.md`. A skill that lists either is treated as
   * source-scoped (see `scope`) and surfaces in the Source viewer rather
   * than the note menus. Undefined when no source tab is active.
   */
  | 'sourceMetadata'
  | 'sourceBody';

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
  /**
   * Input kind. `note` (#516) is a fuzzy note-picker that resolves to a
   * relativePath; the renderer additionally reads the picked note and exposes
   * its body + title to the prompt as the companion template vars
   * `{{param.<id>.content}}` and `{{param.<id>.title}}` — so a skill can
   * operate on a second note, not just the active one.
   */
  type: 'text' | 'textarea' | 'select' | 'number' | 'note';
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
  /** Populated by the `claimUnderCursor` requirement. URI of the
   *  thought:Claim node found at the editor cursor's selection or
   *  current line. Undefined when none was found. */
  claimUri?: string;
  /** thought:label of the claim above. Empty string when the URI
   *  resolved but the claim has no label. */
  claimLabel?: string;
  /** thought:sourceText of the claim — the verbatim passage the
   *  claim was extracted from. May be empty. */
  claimSourceText?: string;
  /**
   * Populated by `selectionRange`. Character offset (0-based) of the
   * selection's start in the active note's content. Undefined when
   * no selection exists (cursor only) or when the requirement was not
   * listed. Pair with `selectionEndOffset` for an inclusive-start /
   * exclusive-end range, matching CodeMirror's `state.selection.main`.
   */
  selectionStartOffset?: number;
  /** Character offset (0-based, exclusive) of the selection's end. */
  selectionEndOffset?: number;
  /** 1-based line number of the selection's start. */
  selectionStartLine?: number;
  /** 1-based line number of the selection's end (inclusive). */
  selectionEndLine?: number;
  parameterValues?: Record<string, string>;
  /** Populated by `sourceMetadata`/`sourceBody` (#103). Id of the source in
   *  the active Source viewer tab. Undefined when no source tab is active. */
  sourceId?: string;
  /** thought:title of the active source. */
  sourceTitle?: string;
  /** The source's extracted `body.md` text. Populated only by `sourceBody`
   *  (it's a file read); `sourceMetadata` alone leaves it undefined. */
  sourceBody?: string;
  /** Full source metadata (title, creators, year, doi, abstract, …) for the
   *  active source. Populated by `sourceMetadata`. */
  sourceMetadata?: import('../types').SourceMetadata;
}

export interface ToolWebHint {
  /** Whether the tool expects web access on by default when invoked. */
  defaultEnabled: boolean;
}

/**
 * Where a tool is invoked from and what it operates on (#103). `note`
 * (default) tools surface in the Learning/Research/Analysis menus + the editor
 * right-click and act on the active note. `source` tools surface in the Source
 * viewer's actions menu and receive the active source's body/metadata; they are
 * kept out of the note surfaces. Absent = `note`.
 */
export type ToolScope = 'note' | 'source';

export interface ThinkingToolDef {
  id: string;
  name: string;
  category: ToolCategory;
  /** Invocation surface + subject (#103). Absent = `note`. */
  scope?: ToolScope;
  /**
   * Optional thematic sub-grouping within a category (#525). When any tool in
   * a category declares a group, the menu renders one nested submenu per group
   * (ungrouped tools fall into a "General" bucket, last). Free-form string;
   * matched case-sensitively. Omit for a flat category.
   */
  group?: string;
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
  /**
   * Whether the tool needs a note open to be useful. Absent = derived from
   * `context` (any note/selection requirement ⇒ needs a note) OR
   * `requiresSelection`. Set it explicitly to override the derivation — e.g.
   * Create Learning Journey lists `context:[fullNote]` to use the note's topic
   * when one is open, but sets `requiresNote: false` so it stays invokable with
   * no note. Consumed via `toolRequiresNote` to gray out menu entries. */
  requiresNote?: boolean;
  /**
   * Template-scoped tools the agent should have access to in this
   * conversation, on top of the default toolset. Today the only entry
   * is `'ask_user'` — declare it when the prompt needs to collect a
   * decision the `parameters` form couldn't have collected upfront.
   * Mirrors the same field on `ConversationTemplate` (#514).
   */
  requiresTools?: import('../conversation-tools').ConversationToolKey[];
}

/** Serializable subset of ThinkingToolDef sent over IPC (no functions). */
export interface ThinkingToolInfo {
  id: string;
  name: string;
  category: ToolCategory;
  /** Invocation surface + subject (#103). Absent = `note`. See ThinkingToolDef.scope. */
  scope?: ToolScope;
  /** Thematic sub-group within the category (#525). See ThinkingToolDef.group. */
  group?: string;
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
  /** See ThinkingToolDef.requiresNote. */
  requiresNote?: boolean;
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
  /** The skill's display name ("Antithesize"), pinned on the conversation it
   *  launches so downstream provenance — note-history causes (#1158) — can name
   *  the command the user ran. */
  toolName: string;
  systemPrompt: string;
  firstMessage: string;
  /** Model to pin on the created conversation. Undefined means track the global default. */
  model?: string;
  /** Whether the tool wants web access on. Actual effect also depends on global `LLMSettings.web.enabled`. */
  webEnabled: boolean;
  /** Template-scoped tools to enable on the resulting conversation, mirroring the tool's `requiresTools` declaration (#514). */
  requiresTools?: import('../conversation-tools').ConversationToolKey[];
}

export interface WebSettings {
  enabled: boolean;
  allowedDomains: string[];
  blockedDomains: string[];
}

/**
 * At-rest storage status for the Anthropic API key (#1326), surfaced to the
 * AI settings panel so it can indicate — honestly — whether the key is
 * encrypted. Read-only; not part of the saved settings payload.
 */
export interface ApiKeyStorage {
  /** OS secure storage (Electron safeStorage) is usable on this machine. */
  available: boolean;
  /**
   * The persisted key is encrypted at rest (safeStorage-tagged form). False
   * when no key is stored yet, or it's a legacy plaintext value not re-saved
   * since encryption landed, or secure storage is unavailable.
   */
  encrypted: boolean;
}

/** Result of an active "check connection" against Anthropic (#...). Unlike the
 *  `hasApiKey` presence flag, this reflects whether Anthropic actually accepts
 *  the key. */
export interface ConnectionCheckResult {
  ok: boolean;
  /** Human-readable reason when `ok` is false. */
  error?: string;
}

/**
 * Per-provider credentials (BYOM, epic #1492). On the call path (`getSettings`)
 * `apiKey` is the decrypted key — with the provider's env var folded in as a
 * fallback — and `baseURL` is the configured endpoint (OpenAI-compatible /
 * local). Absent/empty `apiKey` means "not configured" for that provider.
 */
export interface ProviderCredentials {
  apiKey?: string;
  baseURL?: string;
}

/** Tri-state save form of `ProviderCredentials`: a string sets the field
 *  (apiKey is encrypted at rest), `''` clears it, and OMITTING it keeps the
 *  stored value untouched — so a save that doesn't touch a key never decrypts
 *  or re-encrypts it. */
export interface ProviderCredentialsUpdate {
  apiKey?: string;
  baseURL?: string;
}

/** Display-only per-provider status (no plaintext key ever crosses to the
 *  renderer). */
export interface ProviderConfigView {
  /** A usable key is configured (stored, or via the provider's env var), or the
   *  provider is keyless (local). */
  hasApiKey: boolean;
  baseURL?: string;
}

/**
 * A user-defined model served by an OpenAI-compatible / local endpoint (BYOM
 * #1497). Its `id` is the model name the endpoint expects (e.g. `llama3.1`,
 * `qwen2.5-coder`); all custom models route to the `local` provider. Unpriced
 * and effort-less by default — the pricing/effort tables tolerate ids they
 * don't know.
 */
export interface CustomModel {
  id: string;
  /** Optional display label; falls back to `id`. */
  label?: string;
}

export interface LLMSettings {
  /**
   * Per-provider credentials (BYOM #1492), keyed by provider id. Replaces the
   * former single `apiKey`; the legacy top-level key migrates into
   * `providers.anthropic` on read/save.
   */
  providers: Partial<Record<ProviderId, ProviderCredentials>>;
  /** User-defined local / OpenAI-compatible models (BYOM #1497). */
  customModels?: CustomModel[];
  model: string;
  web?: WebSettings;
  /**
   * Global default reasoning effort (#825), sent as `output_config.effort`.
   * A per-conversation `Conversation.effort` overrides this. Clamped to what
   * the active model supports at call time; `undefined` ⇒ use the built-in
   * default. See `shared/tools/effort.ts`.
   */
  effort?: import('./effort').Effort;
  /**
   * User-level overrides of each tool's preferred model. Keyed by tool id.
   * Resolution order for a tool invocation:
   *   request.modelOverride ?? toolModelOverrides[id] ?? tool.preferredModel ?? model
   */
  toolModelOverrides?: Record<string, string>;
}

/**
 * Display-only view of LLM settings, returned by the read IPC. Deliberately
 * omits the plaintext `apiKey` so reading settings for the settings panel /
 * model picker never decrypts the stored secret (which would prompt the OS
 * keychain). Callers that need set/unset use `hasApiKey`; the plaintext key is
 * only ever materialized on the main-process API-call path.
 */
export interface LLMSettingsView {
  model: string;
  web?: WebSettings;
  effort?: import('./effort').Effort;
  toolModelOverrides?: Record<string, string>;
  /**
   * Whether the ACTIVE model's provider has a usable key — the convenience flag
   * the current single-key settings UI + the "open settings" affordance read.
   * Per-provider detail is in `providers`.
   */
  hasApiKey: boolean;
  /** Per-provider configuration status (BYOM #1492), for the multi-provider UI. */
  providers: Partial<Record<ProviderId, ProviderConfigView>>;
  /** User-defined local models (BYOM #1497), echoed back for the picker/UI. */
  customModels?: CustomModel[];
}

/**
 * Settings-save payload. Same as LLMSettings minus the special apiKey handling:
 * `apiKey` is optional and tri-state — a non-empty string sets a new key, `''`
 * clears it, and **omitting it keeps the stored key untouched** (so a save that
 * doesn't touch the key neither decrypts nor re-encrypts it).
 */
export interface LLMSettingsUpdate {
  /**
   * Legacy convenience: tri-state Anthropic key, applied to
   * `providers.anthropic.apiKey`. The current single-key UI still sends this;
   * the multi-provider UI (BYOM #1498) uses `providers` instead.
   */
  apiKey?: string;
  /** Per-provider credential updates (BYOM #1492), tri-state per field. */
  providers?: Partial<Record<ProviderId, ProviderCredentialsUpdate>>;
  /** Full replacement of the user-defined local models list (BYOM #1497).
   *  Omitted ⇒ unchanged; an empty array clears them. */
  customModels?: CustomModel[];
  model: string;
  web?: WebSettings;
  effort?: import('./effort').Effort;
  toolModelOverrides?: Record<string, string>;
}

/** Source-scoped tools (#103) live in the Source viewer; everything else is
 *  note-scoped. Applied identically by the menu, the editor right-click, the
 *  command palette, and the Source viewer's actions list. */
export function isSourceScoped(tool: { scope?: ToolScope }): boolean {
  return tool.scope === 'source';
}

/** Context requirements that can only be satisfied with a note open. */
const NOTE_CONTEXTS: readonly ContextRequirement[] = [
  'fullNote',
  'selectedText',
  'selectionRange',
  'relatedNotes',
  'taggedNotes',
  'claimUnderCursor',
];

/**
 * Whether a tool needs a note open to be useful. `requiresNote` overrides when
 * set; otherwise a selection requirement or any note-reading `context` entry
 * implies it. Whole-thoughtbase tools (empty `context`, e.g. Find Correlations)
 * derive to false and stay available with no note. Shared by the native menu,
 * the editor right-click, and the command palette so all three agree. */
export function toolRequiresNote(
  tool: Pick<ThinkingToolInfo, 'context' | 'requiresSelection' | 'requiresNote'>,
): boolean {
  if (tool.requiresNote !== undefined) return tool.requiresNote;
  if (tool.requiresSelection) return true;
  return tool.context.some((c) => NOTE_CONTEXTS.includes(c));
}

/** Whether a tool needs a non-empty text selection (a stricter gate than
 *  `toolRequiresNote`). Selection ⇒ note, so a `requiresSelection` tool is also
 *  reported by `toolRequiresNote`. */
export function toolRequiresSelection(
  tool: Pick<ThinkingToolInfo, 'requiresSelection'>,
): boolean {
  return !!tool.requiresSelection;
}

export const DEFAULT_WEB_SETTINGS: WebSettings = {
  enabled: true,
  allowedDomains: [],
  blockedDomains: [],
};
