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
];

const byKey = new Map(CONFIRM_REGISTRY.map((e) => [e.key, e]));

export function confirmRegistryEntry(key: string): ConfirmRegistryEntry | null {
  return byKey.get(key as ConfirmKey) ?? null;
}
