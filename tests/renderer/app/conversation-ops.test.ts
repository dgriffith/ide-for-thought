/**
 * Behavioral net for the conversation / tool-invocation handlers extracted from
 * App.svelte (#670). Mocks the api client + notebase / editor / dialog /
 * conversations / tool-panel stores, plus the tool registry + context gatherer.
 * Verifies the moved handler bodies (open conversation, from-tool prep,
 * generic tool invoke, save-cell-output), not just that menus reach them.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => {
  const api = {
    tools: { prepareConversation: vi.fn() },
    compute: { saveCellOutput: vi.fn() },
  };
  const notebase = {
    meta: { rootPath: '/p', name: 'p' } as unknown,
    refresh: vi.fn().mockResolvedValue(undefined),
  };
  const editor = {
    activeFilePath: null as string | null,
    activeTab: undefined as unknown,
  };
  const dialog = { showPrompt: vi.fn(), showConfirm: vi.fn() };
  const conversationsStore = { openFreeform: vi.fn(), openConversationTab: vi.fn() };
  const toolPanel = { open: vi.fn() };
  const registry = { getAllToolInfos: vi.fn(() => [] as unknown[]) };
  const tools = { gatherContext: vi.fn().mockResolvedValue({}) };
  return { api, notebase, editor, dialog, conversationsStore, toolPanel, registry, tools };
});

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/notebase.svelte', () => ({ getNotebaseStore: () => h.notebase }));
vi.mock('../../../src/renderer/lib/stores/editor.svelte', () => ({ getEditorStore: () => h.editor }));
vi.mock('../../../src/renderer/lib/stores/dialogs.svelte', () => ({ getDialogStore: () => h.dialog }));
vi.mock('../../../src/renderer/lib/stores/conversations.svelte', () => ({ getConversationsStore: () => h.conversationsStore }));
vi.mock('../../../src/renderer/lib/stores/tool-panel.svelte', () => ({ getToolPanelStore: () => h.toolPanel }));
vi.mock('../../../src/renderer/lib/tools/tool-registry', () => ({ getAllToolInfos: h.registry.getAllToolInfos }));
vi.mock('../../../src/renderer/lib/tools/context', () => ({ gatherContext: h.tools.gatherContext }));

import { createConversationOps, type ConversationOpsCtx } from '../../../src/renderer/lib/app/conversation-ops';

const toolPanelComponent = { startExecution: vi.fn() };
const openFileSelect = vi.fn();
let ctx: ConversationOpsCtx;
let ops: ReturnType<typeof createConversationOps>;

beforeEach(() => {
  vi.clearAllMocks();
  h.notebase.meta = { rootPath: '/p', name: 'p' };
  h.editor.activeFilePath = null;
  h.editor.activeTab = undefined;
  h.registry.getAllToolInfos.mockReturnValue([]);
  h.tools.gatherContext.mockResolvedValue({});
  ctx = {
    getEditorView: () => undefined,
    getToolPanelComponent: () => toolPanelComponent,
    openFileSelect,
  };
  ops = createConversationOps(ctx);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('openConversation', () => {
  it('opens a freeform conversation rooted at the active note', async () => {
    h.editor.activeFilePath = 'a.md';
    await ops.openConversation();
    expect(h.conversationsStore.openFreeform).toHaveBeenCalledWith('a.md');
  });
});

describe('openConversationWithMessage', () => {
  it('opens a conversation tab seeded with the message', async () => {
    h.editor.activeFilePath = 'a.md';
    await ops.openConversationWithMessage('hello');
    expect(h.conversationsStore.openConversationTab).toHaveBeenCalledWith({
      notePath: 'a.md',
      initialMessage: 'hello',
    });
  });
});

describe('handleOpenConversationFromTool', () => {
  it('opens a tab with the prepared system prompt on success', async () => {
    h.api.tools.prepareConversation.mockResolvedValue({
      systemPrompt: 'SYS', firstMessage: 'FIRST', requiresTools: [],
    });
    await ops.handleOpenConversationFromTool({ toolId: 't.x', context: { fullNotePath: 'n.md' } });
    expect(h.conversationsStore.openConversationTab).toHaveBeenCalledWith(
      expect.objectContaining({ notePath: 'n.md', systemPrompt: 'SYS', initialMessage: 'FIRST' }),
    );
  });

  it('surfaces a confirm dialog (and opens nothing) when prep throws', async () => {
    h.api.tools.prepareConversation.mockRejectedValue(new Error('right-click a claim first'));
    await ops.handleOpenConversationFromTool({ toolId: 't.y', context: {} });
    expect(h.dialog.showConfirm).toHaveBeenCalled();
    expect(h.conversationsStore.openConversationTab).not.toHaveBeenCalled();
  });
});

describe('handleToolInvoke', () => {
  it('does nothing for an unknown tool id', async () => {
    h.registry.getAllToolInfos.mockReturnValue([{ id: 'known', context: [], parameters: [] }]);
    await ops.handleToolInvoke('unknown');
    expect(h.toolPanel.open).not.toHaveBeenCalled();
  });

  it('opens the panel and auto-starts a no-parameter tool via rAF', async () => {
    // The auto-start defers through requestAnimationFrame — run the callback
    // synchronously so we can assert startExecution fired on the ctx component.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => { cb(0); return 0; });
    const toolInfo = { id: 'go', context: ['fullNote'], parameters: [] };
    h.registry.getAllToolInfos.mockReturnValue([toolInfo]);
    await ops.handleToolInvoke('go');
    expect(h.toolPanel.open).toHaveBeenCalledWith(toolInfo, expect.anything());
    expect(toolPanelComponent.startExecution).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

describe('handleSaveCellOutput', () => {
  const payload = {
    cellLanguage: 'python',
    cellCode: 'print(1)',
    output: { kind: 'text', text: '1' } as never,
  };

  it('does not save when the destination prompt is cancelled', async () => {
    h.editor.activeFilePath = 'nb.md';
    h.dialog.showPrompt.mockResolvedValue(null);
    await ops.handleSaveCellOutput(payload);
    expect(h.api.compute.saveCellOutput).not.toHaveBeenCalled();
  });

  it('saves the cell output and opens the derived note via ctx', async () => {
    vi.useFakeTimers();
    h.editor.activeFilePath = 'nb.md';
    h.dialog.showPrompt.mockResolvedValue('derived/out');
    h.api.compute.saveCellOutput.mockResolvedValue({ status: 'written', derivedPath: 'derived/out.md' });
    await ops.handleSaveCellOutput(payload);
    expect(h.api.compute.saveCellOutput).toHaveBeenCalledWith(
      expect.objectContaining({ sourcePath: 'nb.md', destPath: 'derived/out.md' }),
    );
    expect(h.notebase.refresh).toHaveBeenCalled();
    // The open is deferred behind a setTimeout — advance fake timers to fire it.
    vi.advanceTimersByTime(200);
    expect(openFileSelect).toHaveBeenCalledWith('derived/out.md');
  });
});
