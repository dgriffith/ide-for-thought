import type { ToolContext, ContextRequirement } from '../../../shared/tools/types';
import { getEditorStore } from '../stores/editor.svelte';
import { api } from '../ipc/client';
import type { EditorView } from '@codemirror/view';

export async function gatherContext(
  requirements: ContextRequirement[],
  editorView?: EditorView,
): Promise<ToolContext> {
  const editor = getEditorStore();
  const ctx: ToolContext = {};

  if (requirements.includes('selectedText') && editorView) {
    const { from, to } = editorView.state.selection.main;
    if (from !== to) {
      ctx.selectedText = editorView.state.sliceDoc(from, to);
    }
  }

  if (requirements.includes('fullNote')) {
    const tab = editor.activeNoteTab;
    if (tab) {
      ctx.fullNoteContent = tab.content;
      ctx.fullNotePath = tab.relativePath;
      ctx.fullNoteTitle = tab.fileName.replace(/\.md$/, '');
    }
  }

  if (requirements.includes('relatedNotes') && editor.activeFilePath) {
    try {
      const [outgoing, backlinked] = await Promise.all([
        api.links.outgoing(editor.activeFilePath),
        api.links.backlinks(editor.activeFilePath),
      ]);
      const paths = new Set<string>();
      for (const l of outgoing) if (l.target) paths.add(l.target);
      for (const l of backlinked) if (l.source) paths.add(l.source);

      ctx.relatedNotes = await Promise.all(
        [...paths].map(async (p) => {
          const content = await api.notebase.readFile(p);
          return { path: p, title: p.replace(/\.md$/, ''), content };
        }),
      );
    } catch {
      ctx.relatedNotes = [];
    }
  }

  if (requirements.includes('taggedNotes') && editor.activeFilePath) {
    try {
      const tags = await api.tags.list();
      // Find tags associated with the current note by checking if this note appears in each tag's notes
      const noteTags: string[] = [];
      for (const t of tags) {
        const notes = await api.tags.notesByTag(t.tag);
        if (notes.some(n => n.relativePath === editor.activeFilePath)) {
          noteTags.push(t.tag);
        }
      }

      const pathSet = new Set<string>();
      for (const tag of noteTags) {
        const notes = await api.tags.notesByTag(tag);
        for (const n of notes) {
          if (n.relativePath !== editor.activeFilePath) pathSet.add(n.relativePath);
        }
      }

      ctx.taggedNotes = await Promise.all(
        [...pathSet].map(async (p) => {
          const content = await api.notebase.readFile(p);
          return { path: p, title: p.replace(/\.md$/, ''), content };
        }),
      );
    } catch {
      ctx.taggedNotes = [];
    }
  }

  return ctx;
}
