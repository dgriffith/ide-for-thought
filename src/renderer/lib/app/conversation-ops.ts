/**
 * Conversation / tool-invocation handler cluster extracted from App.svelte
 * (#670). Save-cell-output (#244), decompose / crystallize (#515), the
 * freeform / message / from-tool conversation openers, and generic tool
 * invocation. Bodies are verbatim from App.svelte; the only changes are the
 * ctx getter substitutions for the pieces that used to be inline component
 * refs (editor view, tool-panel component) or a sibling App function
 * (handleFileSelect, from the nav-view cluster).
 */
import { api } from '../ipc/client';
import { getNotebaseStore } from '../stores/notebase.svelte';
import { getEditorStore } from '../stores/editor.svelte';
import { getDialogStore } from '../stores/dialogs.svelte';
import { getConversationsStore } from '../stores/conversations.svelte';
import { getToolPanelStore } from '../stores/tool-panel.svelte';
import { gatherContext } from '../tools/context';
import { getAllToolInfos } from '../tools/tool-registry';
import { CONFIRM_KEYS } from '../confirm-keys';
import type { ToolContext } from '../../../shared/tools/types';

export interface ConversationOpsCtx {
  getEditorView: () => Parameters<typeof gatherContext>[1];
  getToolPanelComponent: () => { startExecution: () => void } | undefined;
  openFileSelect: (relativePath: string) => void;
}

export function createConversationOps(ctx: ConversationOpsCtx) {
  const notebase = getNotebaseStore();
  const editor = getEditorStore();
  const dialogs = getDialogStore();
  const conversationsStore = getConversationsStore();
  const toolPanel = getToolPanelStore();
  const { showPrompt, showConfirm } = dialogs;

  async function handleSaveCellOutput(payload: {
    cellLanguage: string;
    cellCode: string;
    output: import('../../../shared/compute/types').CellOutput;
    /** Pin to notebook (#244). When true, the saver looks up an
     *  existing derived note for this cell and overwrites it rather
     *  than prompting for a new destination; sets `pin=true` on the
     *  source cell's fence on first pin so subsequent saves reuse
     *  the same destination automatically. */
    pin?: boolean;
  }): Promise<void> {
    if (!notebase.meta) return;
    const sourcePath = editor.activeFilePath;
    if (!sourcePath) return;
    // For a non-pinned "Save as note", prompt for a destination. Pin
    // saves skip the prompt — the backend resolves the destination
    // from the graph (existing derived note for this cell). When the
    // cell is being pinned for the first time AND no derived note
    // exists yet, the backend falls back to the default path.
    let destPath: string | undefined;
    if (!payload.pin) {
      const dest = await showPrompt(
        `Save cell output as note. Path (default: notes/derived/):`,
      );
      if (dest === null) return; // user cancelled
      let trimmed = dest.trim();
      // Add `.md` if the user typed a bare path. The pipeline writes a
      // markdown note unconditionally, so a missing extension would
      // produce a file that `Open` doesn't recognise as a note.
      if (trimmed.length > 0 && !/\.md$/i.test(trimmed)) {
        trimmed += '.md';
      }
      destPath = trimmed.length > 0 ? trimmed : undefined;
    }
    try {
      let result = await api.compute.saveCellOutput({
        sourcePath,
        cellLanguage: payload.cellLanguage,
        cellCode: payload.cellCode,
        output: payload.output,
        destPath,
        pin: payload.pin,
      });
      // Confirm-on-diff (#244): the destination exists with different
      // content. Ask the user before overwriting; on yes, retry with
      // `forceOverwrite: true`. The dialog is intentionally compact
      // — a full diff view is a future polish item.
      if (result.status === 'needs-confirm') {
        const ok = await showConfirm(
          `"${result.derivedPath}" already exists with different content. Overwrite it?`,
          CONFIRM_KEYS.saveCellOutputFailed,
          'Overwrite',
        );
        if (!ok) return;
        result = await api.compute.saveCellOutput({
          sourcePath,
          cellLanguage: payload.cellLanguage,
          cellCode: payload.cellCode,
          output: payload.output,
          destPath: result.derivedPath,
          pin: payload.pin,
          forceOverwrite: true,
        });
        if (result.status !== 'written') return;
      }
      // Refresh the file tree so the new note is selectable, then open it.
      await notebase.refresh();
      setTimeout(() => ctx.openFileSelect(result.derivedPath), 100);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Save cell output failed: ${msg}`, CONFIRM_KEYS.saveCellOutputFailed, 'OK');
    }
  }

  async function handleDecompose(_relativePath: string) {
    if (!notebase.meta) return;
    // Both decompose and crystallize are ThinkingTools (#515), so the
    // editor right-click menu routes through the same tool-prep flow
    // the ToolPanel uses. The `_relativePath` arg is preserved for
    // API symmetry with the other right-click handlers, but the tool
    // gathers its own `fullNote` context against the active editor.
    const toolCtx = await gatherContext(['fullNote'], ctx.getEditorView());
    await handleOpenConversationFromTool({ toolId: 'research.decompose', context: toolCtx });
  }

  async function handleCrystallize(_relativePath: string) {
    if (!notebase.meta) return;
    const toolCtx = await gatherContext(['fullNote'], ctx.getEditorView());
    await handleOpenConversationFromTool({ toolId: 'research.crystallize', context: toolCtx });
  }

  async function openConversationWithMessage(message: string) {
    await conversationsStore.openConversationTab({
      notePath: editor.activeFilePath ?? undefined,
      initialMessage: message,
    });
  }

  async function openConversation() {
    await conversationsStore.openFreeform(editor.activeFilePath ?? undefined);
  }

  /**
   * Start a blank conversation with no note context and reveal the panel
   * (openFreeform calls show()). This is the "just open the panel and start
   * talking" entry point — distinct from openConversation(), which seeds the
   * active note so the "Ask about this note" buttons stay note-scoped (#768).
   */
  async function newConversation() {
    await conversationsStore.openFreeform();
  }

  async function handleOpenConversationFromTool(invocation: { toolId: string; context: ToolContext }) {
    let prep;
    try {
      prep = await api.tools.prepareConversation({
        toolId: invocation.toolId,
        context: invocation.context,
      });
    } catch (err) {
      // The tool's `buildSystemPrompt` may throw with a user-facing
      // explanation (e.g. find-arguments throws "right-click on a
      // claim line first" when no URI was extracted from the cursor).
      // Surface that message as a dialog rather than logging it
      // silently to console.
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[tool] prepareConversation failed:', err);
      await showConfirm(msg, CONFIRM_KEYS.toolPrepareFailed, 'OK');
      return;
    }

    const notePath = invocation.context.fullNotePath ?? editor.activeFilePath ?? undefined;
    await conversationsStore.openConversationTab({
      notePath,
      systemPrompt: prep.systemPrompt,
      ...(prep.model ? { model: prep.model } : {}),
      ...(prep.firstMessage ? { initialMessage: prep.firstMessage } : {}),
      ...(prep.requiresTools && prep.requiresTools.length > 0
        ? { extraTools: prep.requiresTools }
        : {}),
    });
  }

  async function handleToolInvoke(toolId: string) {
    const allTools = getAllToolInfos();
    const toolInfo = allTools.find(t => t.id === toolId);
    if (!toolInfo) return;
    const toolCtx = await gatherContext(toolInfo.context, ctx.getEditorView());
    toolPanel.open(toolInfo, toolCtx);
    if (!toolInfo.parameters || toolInfo.parameters.length === 0) {
      requestAnimationFrame(() => ctx.getToolPanelComponent()?.startExecution());
    }
  }

  return {
    handleSaveCellOutput,
    handleDecompose,
    handleCrystallize,
    openConversation,
    newConversation,
    openConversationWithMessage,
    handleOpenConversationFromTool,
    handleToolInvoke,
  };
}
