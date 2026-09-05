/**
 * @vitest-environment node
 *
 * `ui/Dialog.svelte` adoption ratchet (#1888 consolidation, #2047).
 *
 * #1888 introduced `ui/Dialog.svelte` as the shared dialog shell (backdrop,
 * escape-to-close, focus trap, …) so individual dialogs stop hand-rolling
 * their own. 18 of the 32 `*Dialog.svelte` components have adopted it; the
 * other 14 predate the consolidation or haven't been migrated yet. Unlike
 * the config-loader, IPC-registrar, and anti-pattern conventions elsewhere
 * in this repo (all of which got a fitness function), this migration
 * shipped with none — nothing flags a NEW dialog component that skips
 * `ui/Dialog`, so the two shapes can drift apart indefinitely instead of
 * the holdout count shrinking toward zero.
 *
 * Same budget-not-verdict shape as `pattern-ratchets.test.ts`: the baseline
 * is today's 14 holdouts, named individually so a reviewer re-affirms each
 * one is still unmigrated rather than the count silently growing. The list
 * may shrink (a dialog gets migrated) but not grow without a new entry
 * argued for in the diff.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { filesUnder } from '../helpers/renderer-api-surface';

const COMPONENTS_DIR = 'src/renderer/lib/components';
const UI_DIALOG_SHELL = `${COMPONENTS_DIR}/ui/Dialog.svelte`;

/**
 * `*Dialog.svelte` components that do not import `ui/Dialog.svelte`, as of
 * #2047. Not a claim that every one of these is wrong to leave as-is — some
 * may have a real reason to stay custom-shelled — but each holdout should be
 * a decision someone can point to, not silence.
 */
const UNMIGRATED_BASELINE = [
  'AboutDialog.svelte',
  'AttachEvidenceDialog.svelte',
  'AutoLinkInboundDialog.svelte',
  'CollectionPickerDialog.svelte',
  'CommandPaletteDialog.svelte',
  'EditSavedQueriesDialog.svelte',
  'EditSavedViewsDialog.svelte',
  'FindInNotesDialog.svelte',
  'GotoLineDialog.svelte',
  'GotoNoteDialog.svelte',
  'OcrProgressDialog.svelte',
  'OnboardingDialog.svelte',
  'SettingsDialog.svelte',
  'SmartCollectionEditorDialog.svelte',
  'SourcePickerDialog.svelte',
  'TypeEditorDialog.svelte',
].sort();

/** Whether `file` imports the shared dialog shell. */
function importsUiDialogShell(file: string): boolean {
  return /['"][^'"]*ui\/Dialog(\.svelte)?['"]/.test(readFileSync(file, 'utf8'));
}

const dialogFiles = filesUnder(COMPONENTS_DIR, 'Dialog.svelte')
  .filter((f) => f !== UI_DIALOG_SHELL)
  .sort();

describe('ui/Dialog.svelte adoption ratchet (#2047)', () => {
  it('finds a non-trivial set of dialog components — a broken scan would pass vacuously', () => {
    expect(dialogFiles.length, 'no *Dialog.svelte components found').toBeGreaterThan(20);
    expect(
      dialogFiles.filter(importsUiDialogShell).length,
      'no dialog component imports ui/Dialog — the migration itself would look reverted',
    ).toBeGreaterThan(10);
  });

  it('names every *Dialog.svelte component that has not adopted ui/Dialog', () => {
    const unmigrated = dialogFiles
      .filter((f) => !importsUiDialogShell(f))
      .map((f) => f.slice(`${COMPONENTS_DIR}/`.length))
      .sort();

    const added = unmigrated.filter((f) => !UNMIGRATED_BASELINE.includes(f));
    expect(
      added,
      'New *Dialog.svelte component(s) that skip the shared ui/Dialog.svelte shell.\n\n' +
        `${added.join('\n')}\n\n` +
        'A new dialog should adopt ui/Dialog.svelte (backdrop, escape-to-close, focus trap) rather than ' +
        'hand-roll its own — that is the whole point of the #1888 consolidation. If this one genuinely ' +
        'needs to be custom-shelled, add it to UNMIGRATED_BASELINE in this test with a reason.',
    ).toEqual([]);
  });

  it('keeps the baseline live (no stale entries)', () => {
    const stillUnmigrated = new Set(
      dialogFiles.filter((f) => !importsUiDialogShell(f)).map((f) => f.slice(`${COMPONENTS_DIR}/`.length)),
    );
    const stale = UNMIGRATED_BASELINE.filter((f) => !stillUnmigrated.has(f));
    expect(
      stale,
      `UNMIGRATED_BASELINE entries that are now migrated (or gone) — nice, remove them: ${stale.join(', ')}`,
    ).toEqual([]);
  });
});
