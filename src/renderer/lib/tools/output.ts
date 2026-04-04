import type { ToolExecutionResult, OutputMode } from '../../../shared/tools/types';
import { getEditorStore } from '../stores/editor.svelte';
import { api } from '../ipc/client';
import { getNotebaseStore } from '../stores/notebase.svelte';

export async function handleToolOutput(
  result: ToolExecutionResult,
  outputMode: OutputMode,
): Promise<void> {
  const editor = getEditorStore();
  const notebase = getNotebaseStore();

  switch (outputMode) {
    case 'newNote': {
      const filename = result.suggestedFilename ?? `tool-output-${Date.now()}.md`;
      const content = result.suggestedTitle
        ? `# ${result.suggestedTitle}\n\n${result.output}`
        : result.output;
      await api.notebase.createFile(filename);
      await api.notebase.writeFile(filename, content);
      await notebase.refresh();
      await editor.openFile(filename);
      break;
    }
    case 'appendToNote': {
      const tab = editor.activeNoteTab;
      if (tab) {
        editor.setContent(tab.content + '\n\n---\n\n' + result.output);
      }
      break;
    }
    case 'replaceSelection':
    case 'insertAtCursor':
    case 'multipleNotes':
      // These modes will be implemented in Phase 2+
      // For now, fall back to creating a new note
      {
        const filename = result.suggestedFilename ?? `tool-output-${Date.now()}.md`;
        const content = result.suggestedTitle
          ? `# ${result.suggestedTitle}\n\n${result.output}`
          : result.output;
        await api.notebase.createFile(filename);
        await api.notebase.writeFile(filename, content);
        await notebase.refresh();
        await editor.openFile(filename);
      }
      break;
  }
}
