/**
 * @vitest-environment happy-dom
 *
 * Editor render/smoke test (#1600 baseline). Editor.svelte is the CodeMirror
 * host — the largest renderer component and previously at 0% coverage of its
 * own file. This mounts the REAL component (real CodeMirror + real editor/*
 * extensions) against a mocked IPC surface + the couple of rune stores it
 * reads, and asserts the visible wiring: it mounts a CodeMirror view for the
 * given group, renders the doc, opens the right-click context menu, routes a
 * menu action back through the host callback, and reflects an external
 * content-prop change into the buffer.
 *
 * The goal is a green, non-flaky smoke that actually executes the component
 * script (onMount, the extensions array, the context-menu template, the
 * content-sync $effect) rather than exhaustive assertions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  api: {
    shell: {
      openExternal: vi.fn(),
      revealFile: vi.fn(),
      openInDefault: vi.fn(),
      openInTerminal: vi.fn(),
    },
    notebase: { readFile: vi.fn() },
    compute: { runCell: vi.fn() },
    tags: { allNames: vi.fn() },
    types: { list: vi.fn() },
  },
  voiceSettings: { enabled: false },
  getToolInfosByCategory: vi.fn(() => []),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/voice/voice-settings.svelte', () => ({
  voiceSettings: h.voiceSettings,
}));
// Keep the Tools-for-Thought submenu empty and deterministic — the registry
// contents aren't what this test exercises.
vi.mock('../../../src/renderer/lib/tools/tool-registry', () => ({
  getToolInfosByCategory: h.getToolInfosByCategory,
}));

import Editor from '../../../src/renderer/lib/components/Editor.svelte';

function props(over: Record<string, unknown> = {}) {
  return {
    groupId: 'group-1',
    filePath: 'notes/hello.md',
    content: '# Hello World\n\nsome body text\n',
    onContentChange: vi.fn(),
    onSave: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  // happy-dom's localStorage isn't wired for a functional getItem here; the
  // editor reads/writes the font-size key at mount. In-memory stand-in.
  const ls: Record<string, string> = {};
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => ls[k] ?? null,
    setItem: (k: string, v: string) => { ls[k] = v; },
    removeItem: (k: string) => { delete ls[k]; },
    clear: () => { for (const k of Object.keys(ls)) delete ls[k]; },
  });
  h.api.notebase.readFile.mockResolvedValue('');
  h.api.tags.allNames.mockResolvedValue([]);
  h.api.types.list.mockResolvedValue({ types: [] });
  h.getToolInfosByCategory.mockReturnValue([]);
  h.voiceSettings.enabled = false;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('Editor (#1600)', () => {
  it('mounts a CodeMirror view for the group and renders the document', async () => {
    const { container } = render(Editor, props());
    const wrapper = container.querySelector('.editor-wrapper');
    expect(wrapper).toBeTruthy();
    expect(wrapper?.getAttribute('data-group-id')).toBe('group-1');
    // CodeMirror actually mounted inside the wrapper.
    await waitFor(() => expect(container.querySelector('.cm-editor')).toBeTruthy());
    await waitFor(() =>
      expect(container.querySelector('.cm-content')?.textContent).toContain('Hello World'),
    );
  });

  it('opens the right-click context menu and routes a menu action to the host', async () => {
    const onOpenConversation = vi.fn();
    const { container } = render(Editor, props({ onOpenConversation }));
    await waitFor(() => expect(container.querySelector('.cm-content')).toBeTruthy());

    const content = container.querySelector('.cm-content')!;
    await fireEvent.contextMenu(content);

    // The context menu (with the standard clipboard entries) is now open.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Paste' })).toBeTruthy();

    // Clicking a host-callback action fires it and dismisses the menu.
    await fireEvent.click(screen.getByRole('button', { name: 'Ask About This...' }));
    expect(onOpenConversation).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull());
  });

  it('shows the Dictate entry only when voice is enabled', async () => {
    h.voiceSettings.enabled = true;
    const { container } = render(Editor, props());
    await waitFor(() => expect(container.querySelector('.cm-content')).toBeTruthy());
    await fireEvent.contextMenu(container.querySelector('.cm-content')!);
    await waitFor(() => expect(screen.getByRole('button', { name: /Dictate/ })).toBeTruthy());
  });

  it('syncs an external content-prop change into the editor buffer', async () => {
    const { container, rerender } = render(Editor, props());
    await waitFor(() =>
      expect(container.querySelector('.cm-content')?.textContent).toContain('Hello World'),
    );
    await rerender(props({ content: 'replaced from disk\n' }));
    await waitFor(() =>
      expect(container.querySelector('.cm-content')?.textContent).toContain('replaced from disk'),
    );
  });

  it('mounts a plain-text editor without the markdown layers', async () => {
    const { container } = render(Editor, props({ plainText: true, filePath: 'notes/plain.txt' }));
    await waitFor(() => expect(container.querySelector('.cm-editor')).toBeTruthy());
    // The plain-text buffer advertises itself for the drag-link opt-out.
    await waitFor(() =>
      expect(container.querySelector('.cm-editor[data-plaintext="true"]')).toBeTruthy(),
    );
  });
});
