/**
 * @vitest-environment happy-dom
 *
 * Accessibility smoke for the app's modal surfaces (#681 / QA Q-M4). Minerva is
 * a keyboard-first tool, but svelte-check's a11y warnings are non-fatal and
 * nothing gated ARIA / role / label correctness. These render each dialog and
 * run axe-core, so a focus-trap / mislabelled-control / nameless-dialog
 * regression fails CI instead of shipping silently.
 */

import { describe, it, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/svelte';
import { expectNoA11yViolations } from '../../helpers/axe';
import ConfirmDialog from '../../../src/renderer/lib/components/ConfirmDialog.svelte';
import PromptDialog from '../../../src/renderer/lib/components/PromptDialog.svelte';

// Keep the command palette's recent-list deterministic (localStorage-backed).
vi.mock('../../../src/renderer/lib/command-palette/recent', () => ({
  loadRecent: () => [] as string[],
  recordRecent: vi.fn(),
}));
import CommandPaletteDialog from '../../../src/renderer/lib/components/CommandPaletteDialog.svelte';

afterEach(cleanup);

describe('dialog accessibility smoke (#681)', () => {
  it('ConfirmDialog is axe-clean (with and without the don\'t-ask-again checkbox)', async () => {
    render(ConfirmDialog, {
      message: 'Delete this note?',
      confirmLabel: 'Delete',
      onConfirm: () => {},
      onCancel: () => {},
    });
    await expectNoA11yViolations();
  });

  it('ConfirmDialog is axe-clean when the checkbox is hidden', async () => {
    render(ConfirmDialog, {
      message: 'Apply changes?',
      hideDontAskAgain: true,
      onConfirm: () => {},
      onCancel: () => {},
    });
    await expectNoA11yViolations();
  });

  it('PromptDialog is axe-clean', async () => {
    render(PromptDialog, {
      message: 'Name the new note',
      onConfirm: () => {},
      onCancel: () => {},
    });
    await expectNoA11yViolations();
  });

  it('PromptDialog with suggestions is axe-clean', async () => {
    render(PromptDialog, {
      message: 'Move to folder',
      suggestions: ['notes/', 'notes/sources/'],
      initial: 'notes/',
      onConfirm: () => {},
      onCancel: () => {},
    });
    await expectNoA11yViolations();
  });

  it('CommandPaletteDialog is axe-clean', async () => {
    render(CommandPaletteDialog, {
      commands: [
        { id: 'settings', title: 'Open Settings', category: 'App', enabled: true, run: () => {} },
        { id: 'note', title: 'New Note', category: 'File', enabled: true, run: () => {} },
      ],
      onClose: () => {},
    });
    await expectNoA11yViolations();
  });
});
