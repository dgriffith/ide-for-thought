/**
 * Canonical list of Anthropic models surfaced in the UI.
 *
 * Kept in `shared/` so both the Settings dialog and the per-conversation
 * picker read from the same source of truth. Callers that need the
 * current default read it from LLMSettings.model, which is validated
 * against this list.
 */

export interface ModelOption {
  value: string;
  label: string;
}

export const MODEL_OPTIONS: ModelOption[] = [
  // Opus 4.8 and Sonnet 4.6 ship with a 1M-token context window by default —
  // there is no separate "1M context" model ID at the Anthropic API, so we
  // don't list duplicate entries for it.
  { value: 'claude-opus-4-8', label: 'Claude Opus 4.8' },
  { value: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6' },
  { value: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
];

export function modelLabel(value: string): string {
  return MODEL_OPTIONS.find((m) => m.value === value)?.label ?? value;
}
