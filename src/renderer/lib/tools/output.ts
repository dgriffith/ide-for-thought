import type { ToolExecutionResult, OutputMode, ToolContext } from '../../../shared/tools/types';
import { getEditorStore } from '../stores/editor.svelte';
import { api } from '../ipc/client';
import { getNotebaseStore } from '../stores/notebase.svelte';

export async function handleToolOutput(
  result: ToolExecutionResult,
  outputMode: OutputMode,
  context: ToolContext = {},
): Promise<void> {
  const editor = getEditorStore();
  const notebase = getNotebaseStore();

  switch (outputMode) {
    case 'newNote':
    case 'replaceSelection':
    case 'insertAtCursor':
    case 'multipleNotes': {
      // replaceSelection / insertAtCursor / multipleNotes aren't implemented
      // yet — they share the newNote path for now.
      const sourcePath = context.fullNotePath ?? editor.activeFilePath ?? null;
      const { filename, content } = buildNoteFile(result, sourcePath);
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
  }
}

function buildNoteFile(
  result: ToolExecutionResult,
  sourcePath: string | null,
): { filename: string; content: string } {
  const baseName = result.suggestedFilename ?? `tool-output-${Date.now()}.md`;
  const dir = sourcePath ? dirOf(sourcePath) : '';
  const filename = dir ? `${dir}/${baseName}` : baseName;

  const frontmatter = buildFrontmatter(result, sourcePath);
  const body = buildBody(result, sourcePath);

  return { filename, content: frontmatter + body };
}

function buildFrontmatter(
  result: ToolExecutionResult,
  sourcePath: string | null,
): string {
  const lines: string[] = ['---'];
  if (result.suggestedTitle) {
    lines.push(`title: ${yamlQuote(result.suggestedTitle)}`);
  }
  lines.push(`created: ${todayIso()}`);
  lines.push(`tool: ${result.toolId}`);
  if (sourcePath) lines.push(`source: ${sourcePath}`);
  lines.push('---', '');
  return lines.join('\n');
}

function buildBody(result: ToolExecutionResult, sourcePath: string | null): string {
  const lines: string[] = [];
  if (result.suggestedTitle) {
    lines.push(`# ${result.suggestedTitle}`, '');
  }
  if (sourcePath) {
    const linkTarget = sourcePath.replace(/\.md$/, '');
    lines.push(`*Analysis of [[${linkTarget}]]*`, '');
  }
  lines.push(result.output);
  return lines.join('\n');
}

function dirOf(relativePath: string): string {
  const idx = relativePath.lastIndexOf('/');
  return idx < 0 ? '' : relativePath.slice(0, idx);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function yamlQuote(s: string): string {
  // The project's frontmatter parser strips a single leading/trailing quote,
  // so we quote values that contain a colon to keep the value intact for
  // any YAML-aware consumer.
  if (!/[:#]/.test(s)) return s;
  return `"${s.replace(/"/g, '\\"')}"`;
}
