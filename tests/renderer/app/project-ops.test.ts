/**
 * Behavioral net for the project / thoughtbase-lifecycle handlers extracted
 * from App.svelte (#1084). Mocks the api client + notebase / editor /
 * conversations / dialog stores. Verifies the moved handler bodies — the
 * onboarding modal trigger, entrypoint auto-open, onboarding accept/decline
 * (dismiss persistence + welcome-note seed), the thoughtbase-guide opener, and
 * the this-window / new-window / cancel branching of open / new / open-recent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => {
  const api = {
    notebase: {
      setOnboardingDismissed: vi.fn().mockResolvedValue(undefined),
      getOnboardingDismissed: vi.fn().mockResolvedValue(false),
      fileExists: vi.fn().mockResolvedValue(false),
      writeFile: vi.fn().mockResolvedValue(undefined),
      open: vi.fn(),
      openInNewWindow: vi.fn().mockResolvedValue(undefined),
      newProjectInNewWindow: vi.fn().mockResolvedValue(undefined),
      openPathInNewWindow: vi.fn().mockResolvedValue(undefined),
    },
    tags: { notesByTag: vi.fn().mockResolvedValue([]) },
  };
  const notebase = {
    meta: { rootPath: '/p', name: 'p' } as unknown,
    files: [] as unknown[],
    refresh: vi.fn().mockResolvedValue(undefined),
    open: vi.fn().mockResolvedValue({ rootPath: '/p2' }),
    newProject: vi.fn().mockResolvedValue({ rootPath: '/p2' }),
    openPath: vi.fn().mockResolvedValue({ rootPath: '/p2' }),
  };
  const editor = {
    openFile: vi.fn().mockResolvedValue(undefined),
    switchTab: vi.fn(),
    clear: vi.fn(),
    tabs: [] as unknown[],
  };
  const conversations = { openConversationTab: vi.fn().mockResolvedValue(undefined) };
  const dialog = { askOpenTarget: vi.fn() };
  return { api, notebase, editor, conversations, dialog };
});

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({ getNotebaseStore: () => h.notebase }));
vi.mock('../../../src/renderer/lib/stores/editor.svelte', () => ({ getEditorStore: () => h.editor }));
vi.mock('../../../src/renderer/lib/stores/conversations.svelte', () => ({ getConversationsStore: () => h.conversations }));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({ getDialogStore: () => h.dialog }));

import { createProjectOps, type ProjectOpsCtx } from '../../../src/renderer/lib/app/project-ops';
import type { OnboardingAnswers } from '../../../src/shared/onboarding';

// A single .md leaf so countNotes() reports a non-empty thoughtbase.
const oneNote = [{ name: 'a.md', relativePath: 'a.md', isDirectory: false }];

let shown: boolean | null;
let ctx: ProjectOpsCtx;
let ops: ReturnType<typeof createProjectOps>;

beforeEach(() => {
  vi.clearAllMocks();
  h.notebase.meta = { rootPath: '/p', name: 'p' };
  h.notebase.files = [];
  h.editor.tabs = [];
  h.api.notebase.getOnboardingDismissed.mockResolvedValue(false);
  h.api.notebase.fileExists.mockResolvedValue(false);
  h.api.tags.notesByTag.mockResolvedValue([]);
  h.dialog.askOpenTarget.mockReset();
  shown = null;
  ctx = { setShowOnboarding: (v) => { shown = v; } };
  ops = createProjectOps(ctx);
});

const answers: OnboardingAnswers = {
  subject: 'Raft consensus',
  expertise: 'familiar',
  use: 'study',
  depth: 'moderate',
};

describe('maybeShowOnboarding', () => {
  it('opens the modal on an empty, not-yet-dismissed thoughtbase', async () => {
    await ops.maybeShowOnboarding();
    expect(shown).toBe(true);
  });

  it('is a no-op when the thoughtbase already has notes', async () => {
    h.notebase.files = oneNote;
    await ops.maybeShowOnboarding();
    expect(shown).toBeNull();
    expect(h.api.notebase.getOnboardingDismissed).not.toHaveBeenCalled();
  });

  it('does not open when onboarding was dismissed for this project', async () => {
    h.api.notebase.getOnboardingDismissed.mockResolvedValue(true);
    await ops.maybeShowOnboarding();
    expect(shown).toBeNull();
  });
});

describe('maybeOpenEntrypoints', () => {
  it('returns early when a note tab is already open', async () => {
    h.editor.tabs = [{ type: 'note', relativePath: 'x.md' }];
    await ops.maybeOpenEntrypoints();
    expect(h.api.tags.notesByTag).not.toHaveBeenCalled();
  });

  it('opens entrypoint notes sorted by title, then selects the first', async () => {
    h.api.tags.notesByTag.mockResolvedValue([
      { title: 'Beta', relativePath: 'beta.md' },
      { title: 'Alpha', relativePath: 'alpha.md' },
    ]);
    // openFile appends a tab so the final switchTab(0) guard passes.
    h.editor.openFile.mockImplementation(async () => { h.editor.tabs = [{ type: 'note' }]; });
    await ops.maybeOpenEntrypoints();
    expect(h.editor.openFile.mock.calls.map((c) => c[0])).toEqual(['alpha.md', 'beta.md']);
    expect(h.editor.switchTab).toHaveBeenCalledWith(0);
  });
});

describe('handleOnboardingAccept', () => {
  it('closes the modal, persists the dismiss, and opens a seeded conversation', async () => {
    await ops.handleOnboardingAccept(answers, true);
    expect(shown).toBe(false);
    expect(h.api.notebase.setOnboardingDismissed).toHaveBeenCalledWith(true);
    const arg = h.conversations.openConversationTab.mock.calls[0][0];
    expect(arg.systemPrompt).toContain('Raft consensus');
    expect(arg.extraTools).toEqual(['ask_user']);
  });

  it('skips the dismiss persistence when not asked to', async () => {
    await ops.handleOnboardingAccept(answers, false);
    expect(h.api.notebase.setOnboardingDismissed).not.toHaveBeenCalled();
  });
});

describe('handleOnboardingDecline', () => {
  it('seeds + opens a welcome note when the thoughtbase is still empty', async () => {
    await ops.handleOnboardingDecline(false);
    expect(shown).toBe(false);
    expect(h.api.notebase.writeFile).toHaveBeenCalledTimes(1);
    const [path] = h.api.notebase.writeFile.mock.calls[0];
    expect(h.editor.openFile).toHaveBeenCalledWith(path);
  });

  it('does not seed a welcome note when notes already exist', async () => {
    h.notebase.files = oneNote;
    await ops.handleOnboardingDecline(true);
    expect(h.api.notebase.setOnboardingDismissed).toHaveBeenCalledWith(true);
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
  });
});

describe('handleEditThoughtbaseDoc', () => {
  it('creates the guide from the template when missing, then opens it', async () => {
    h.api.notebase.fileExists.mockResolvedValue(false);
    await ops.handleEditThoughtbaseDoc();
    expect(h.api.notebase.writeFile).toHaveBeenCalledTimes(1);
    expect(h.editor.openFile).toHaveBeenCalledTimes(1);
  });

  it('opens the existing guide without rewriting it', async () => {
    h.api.notebase.fileExists.mockResolvedValue(true);
    await ops.handleEditThoughtbaseDoc();
    expect(h.api.notebase.writeFile).not.toHaveBeenCalled();
    expect(h.editor.openFile).toHaveBeenCalledTimes(1);
  });
});

describe('open-target branching', () => {
  it('handleOpenThoughtbase → "new" opens a new window and leaves this one alone', async () => {
    h.dialog.askOpenTarget.mockResolvedValue('new');
    await ops.handleOpenThoughtbase();
    expect(h.api.notebase.openInNewWindow).toHaveBeenCalled();
    expect(h.editor.clear).not.toHaveBeenCalled();
    expect(h.notebase.open).not.toHaveBeenCalled();
  });

  it('handleOpenThoughtbase → "cancel" is a no-op', async () => {
    h.dialog.askOpenTarget.mockResolvedValue('cancel');
    await ops.handleOpenThoughtbase();
    expect(h.notebase.open).not.toHaveBeenCalled();
    expect(h.api.notebase.openInNewWindow).not.toHaveBeenCalled();
  });

  it('handleOpenThoughtbase → "this" clears the editor and opens in place', async () => {
    h.dialog.askOpenTarget.mockResolvedValue('this');
    await ops.handleOpenThoughtbase();
    expect(h.editor.clear).toHaveBeenCalled();
    expect(h.notebase.open).toHaveBeenCalled();
  });

  it('handleNewThoughtbase skips the prompt entirely when no project is open', async () => {
    h.notebase.meta = null;
    await ops.handleNewThoughtbase();
    expect(h.dialog.askOpenTarget).not.toHaveBeenCalled();
    expect(h.notebase.newProject).toHaveBeenCalled();
  });

  it('handleOpenRecentThoughtbase → "new" routes the path to a new window', async () => {
    h.dialog.askOpenTarget.mockResolvedValue('new');
    await ops.handleOpenRecentThoughtbase('/recent');
    expect(h.api.notebase.openPathInNewWindow).toHaveBeenCalledWith('/recent');
    expect(h.notebase.openPath).not.toHaveBeenCalled();
  });
});
