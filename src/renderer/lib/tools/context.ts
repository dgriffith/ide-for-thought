import type { ToolContext, ContextRequirement } from '../../../shared/tools/types';
import { getEditorStore } from '../stores/editor.svelte';
import { api } from '../ipc/client';
import { extractClaimUri } from '../../../shared/refactor/find-arguments';
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

  if (requirements.includes('claimUnderCursor') && editorView) {
    // Mirror Editor.svelte's getClaimUriAtCursor: prefer the active
    // selection, fall back to the current line. Centralising the URI
    // extraction here keeps the right-click context-menu disabled
    // state and the tool invocation honest about the same source.
    const sel = editorView.state.selection.main;
    let uri: string | null = null;
    if (sel.from !== sel.to) {
      uri = extractClaimUri(editorView.state.sliceDoc(sel.from, sel.to));
    }
    if (!uri) {
      const line = editorView.state.doc.lineAt(sel.head);
      uri = extractClaimUri(line.text);
    }
    if (uri) {
      ctx.claimUri = uri;
      // Look up label + sourceText so the tool's first message can show
      // the user (and the model) the claim text without needing a
      // round-trip query_graph call. If the URI doesn't resolve to a
      // thought:Claim, the metadata stays empty — the tool can still
      // operate on the URI alone, the user just won't see the source
      // passage in the seeded message.
      try {
        const r = await api.graph.query(`
          PREFIX thought: <https://minerva.dev/ontology/thought#>
          SELECT ?label ?sourceText WHERE {
            <${uri}> a thought:Claim .
            OPTIONAL { <${uri}> thought:label ?label . }
            OPTIONAL { <${uri}> thought:sourceText ?sourceText . }
          } LIMIT 1
        `);
        const rows = r.results as Array<{ label?: string; sourceText?: string }>;
        if (rows.length > 0) {
          ctx.claimLabel = rows[0].label ?? '';
          ctx.claimSourceText = rows[0].sourceText ?? '';
        }
      } catch {
        // Graph not initialised / query error — leave metadata empty.
      }
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
