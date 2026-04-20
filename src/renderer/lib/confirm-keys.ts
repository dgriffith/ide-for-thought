/**
 * Registry of every \`showConfirm\` key in the app. Each entry gives the
 * Behaviors settings tab a human-readable row so users can see what
 * they've muted and re-enable it.
 *
 * Call sites reference the CONFIRM_KEYS constants rather than passing
 * bare strings, so adding a new confirm requires adding its entry here.
 * A guard test (tests/renderer/confirm-keys.test.ts) checks for drift.
 */

export const CONFIRM_KEYS = {
  delete: 'confirm-delete',
  rewriteConflict: 'confirm-rewrite-conflict',
  headingRenameSuggestion: 'heading-rename-suggestion',
  moveCollision: 'move-collision',
  autoTagNoSuggestions: 'auto-tag-no-suggestions',
  autoTagFailed: 'auto-tag-failed',
  autoLinkNoSuggestions: 'auto-link-no-suggestions',
  autoLinkFailed: 'auto-link-failed',
} as const;

export type ConfirmKey = typeof CONFIRM_KEYS[keyof typeof CONFIRM_KEYS];

export interface ConfirmRegistryEntry {
  key: ConfirmKey;
  title: string;
  description: string;
}

export const CONFIRM_REGISTRY: ConfirmRegistryEntry[] = [
  {
    key: CONFIRM_KEYS.delete,
    title: 'Delete file or folder',
    description:
      'Prompt before removing a note, folder, or source from the thoughtbase.',
  },
  {
    key: CONFIRM_KEYS.rewriteConflict,
    title: 'Reload note rewritten on disk',
    description:
      'Prompt when an external link rewrite touches a file you have unsaved changes in.',
  },
  {
    key: CONFIRM_KEYS.headingRenameSuggestion,
    title: 'Update links after heading rename',
    description:
      'Offer to rewrite incoming [[note#heading]] links when a heading edit looks like a rename.',
  },
  {
    key: CONFIRM_KEYS.moveCollision,
    title: 'Move cancelled (destination exists)',
    description:
      'Shown when Move would overwrite an existing file at the chosen destination.',
  },
  {
    key: CONFIRM_KEYS.autoTagNoSuggestions,
    title: 'Auto-tag returned no new tags',
    description:
      'Shown when the LLM produced no tag suggestions for the note (usually because it is too short or already well-tagged).',
  },
  {
    key: CONFIRM_KEYS.autoTagFailed,
    title: 'Auto-tag failed',
    description:
      'Shown when Auto-tag errors out (network failure, missing API key, etc).',
  },
  {
    key: CONFIRM_KEYS.autoLinkNoSuggestions,
    title: 'Auto-link returned no suggestions',
    description:
      'Shown when the LLM produced no link candidates for the note.',
  },
  {
    key: CONFIRM_KEYS.autoLinkFailed,
    title: 'Auto-link failed',
    description:
      'Shown when Auto-link errors out or can\u2019t apply any accepted suggestions.',
  },
];

const byKey = new Map(CONFIRM_REGISTRY.map((e) => [e.key, e]));

export function confirmRegistryEntry(key: string): ConfirmRegistryEntry | null {
  return byKey.get(key as ConfirmKey) ?? null;
}
