/**
 * Template / note-creation handler cluster extracted from App.svelte (#670).
 * New-note-from-conversation (#475), Insert / Save-as Template (#475),
 * new-note-about-source (#474), and the excerpt → note / append flows (#101).
 * Bodies are verbatim from App.svelte; the only changes are the ctx getter
 * substitutions for the pieces that used to be inline component refs (editor
 * component, sidebar) or local `$state` (lastNotePath). No feature-state store —
 * this cluster has none.
 */
import { api } from '../ipc/client';
import { getNotebaseStore } from '../stores/notebase.svelte';
import { getEditorStore } from '../stores/editor.svelte';
import { getDialogStore } from '../stores/dialogs.svelte';
import { substituteTemplate } from '../../../shared/templates';
import { buildExcerptNoteContent, buildExcerptAppendBlock } from '../../../shared/excerpt-note';
import {
  suggestConversationNoteTitle,
  planCreateFromConversation,
} from '../refactor/create-from-conversation';
import { getRefactorSettings } from '../refactor/settings';
import { CONFIRM_KEYS } from '../confirm-keys';
import type { Conversation, SourceExcerpt } from '../../../shared/types';

interface EditorRef {
  getSelectedText: () => string;
  insertText: (s: string, offset?: number | null) => void;
}
interface SidebarRef {
  refreshTags: () => void;
}

export interface TemplateOpsCtx {
  getSidebar: () => SidebarRef | undefined;
  getEditorComponent: () => EditorRef | undefined;
  getLastNotePath: () => string | null;
}

export function createTemplateOps(ctx: TemplateOpsCtx) {
  const notebase = getNotebaseStore();
  const editor = getEditorStore();
  const dialogs = getDialogStore();
  const { showPrompt, showConfirm, showSnippetPicker } = dialogs;

  async function handleCreateNoteFromConversation(args: {
    conversation: Conversation;
    selectionText: string;
    fallbackText: string;
  }): Promise<void> {
    if (!notebase.meta) return;
    const body = args.selectionText.trim() || args.fallbackText.trim();
    if (!body) {
      await showConfirm(
        'Nothing to create from — the conversation has no assistant text yet.',
        CONFIRM_KEYS.createNoteFromConvEmpty,
        'OK',
      );
      return;
    }
    const suggested = suggestConversationNoteTitle(body);
    const title = suggested ?? await showPrompt('New note name:');
    if (!title) return;

    const sourceRelativePath = args.conversation.contextBundle.notePath ?? null;
    const plan = planCreateFromConversation({
      title,
      body,
      sourceRelativePath,
      conversationId: args.conversation.id,
      today: new Date().toISOString().slice(0, 10),
      settings: getRefactorSettings(),
    });

    try {
      // Loop on collision so the second-of-the-same-title doesn't
      // clobber the first. Existing extract / split-here paths
      // accept clobbers, but conversation-source notes are likely
      // to land repeatedly off the same prompts.
      let path = plan.newNotePath;
      for (let attempt = 2; attempt < 20; attempt++) {
        if (!(await api.notebase.fileExists(path))) break;
        const dot = plan.newNotePath.lastIndexOf('.md');
        path = dot > 0
          ? `${plan.newNotePath.slice(0, dot)}-${attempt}.md`
          : `${plan.newNotePath}-${attempt}`;
      }
      await api.notebase.writeFile(path, plan.newNoteContent);
      await notebase.refresh();
      await editor.openFile(path);
      ctx.getSidebar()?.refreshTags();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Couldn't create note: ${msg}`, CONFIRM_KEYS.createNoteFromConvFailed, 'OK');
    }
  }

  /** Insert a template's substituted body at the editor caret
   *  (replacing the current selection if any). `{{selection}}`
   *  picks up the selected text; `{{cursor}}` becomes the post-
   *  insert caret position; `{{prompt:Label}}` pauses for input
   *  via the existing showPrompt dialog. (#475) */
  async function handleInsertTemplate(): Promise<void> {
    if (!notebase.meta) return;
    if (editor.activeTab?.type !== 'note') return;
    const list = await api.templates.list();
    if (list.length === 0) return;
    const picked = await showSnippetPicker(list);
    if (!picked) return;
    const body = await api.templates.get(picked.filename);
    if (body === null) return;
    const selection = ctx.getEditorComponent()?.getSelectedText() ?? '';
    const titleFromPath = (editor.activeFilePath?.split('/').pop() ?? '')
      .replace(/\.(md|ttl|csv|py)$/i, '');
    const sub = await substituteTemplate(body, {
      title: titleFromPath,
      selection,
      prompt: (label: string) => showPrompt(`${label}:`),
    });
    if (sub.cancelled) return;
    ctx.getEditorComponent()?.insertText(sub.content, sub.cursorOffset);
  }

  /** Save the active note's body as a template under
   *  `.minerva/templates/<name>.md` (#475). The body is copied
   *  verbatim — placeholders the user typed (`{{title}}` etc.) live
   *  in the source and get resolved when the template is *used*.
   *  Existing template files at the same name are overwritten;
   *  showPrompt is light-weight enough that the user can just retype
   *  if they meant a different name. */
  async function handleSaveAsTemplate(): Promise<void> {
    if (!notebase.meta) return;
    const tab = editor.activeTab;
    if (!tab || tab.type !== 'note') return;
    const suggested = (tab.relativePath.split('/').pop() ?? '')
      .replace(/\.(md|ttl|csv|py)$/i, '');
    const name = await showPrompt('Template name:', suggested);
    if (!name) return;
    try {
      await api.templates.saveAs(name, tab.content);
    } catch (err) {
      console.error('[templates] saveAs failed', err);
    }
  }

  /** Zotero-style "New note about this source" (#474). Creates a note
   *  pre-populated with `about: [[sources/<id>]]` frontmatter so it
   *  immediately surfaces under the source's Notes section. */
  async function handleNewAboutSourceNote(sourceId: string): Promise<string | null> {
    if (!notebase.meta) return null;
    const name = await showPrompt('Note name:');
    if (!name) return null;
    const filename = name.endsWith('.md') ? name : `${name}.md`;
    const relativePath = filename;
    const titleStem = name.replace(/\.md$/, '');
    const initialContent = `---\nabout: [[sources/${sourceId}]]\n---\n\n# ${titleStem}\n\n`;
    await api.notebase.writeFile(relativePath, initialContent);
    await notebase.refresh();
    await editor.openFile(relativePath);
    ctx.getSidebar()?.refreshTags();
    return relativePath;
  }

  /** Create a new note seeded from an excerpt (#101). Prompts for
   *  the title with a sensible default ("Note on <displayTitle>"),
   *  builds the markdown via `buildExcerptNoteContent`, writes to
   *  the configured excerpt-note folder (project-config), and
   *  opens the result. Returns the new note's relative path so
   *  callers can highlight or further-navigate. */
  async function handleCreateNoteFromExcerpt(
    sourceId: string,
    excerpt: SourceExcerpt,
  ): Promise<string | null> {
    if (!notebase.meta) return null;
    const detail = await api.graph.sourceDetail(sourceId);
    const built = buildExcerptNoteContent({
      sourceId,
      excerpt,
      source: detail?.metadata,
    });
    const name = await showPrompt('Note name:', built.suggestedTitle);
    if (!name) return null;
    const folder = await api.sources.getExcerptNoteFolder();
    const stem = name.replace(/\.md$/, '');
    const filename = `${stem}.md`;
    const relativePath = folder ? `${folder}/${filename}` : filename;
    // Re-build with the user's chosen title so the H1 matches.
    const finalContent = buildExcerptNoteContent({
      sourceId,
      excerpt,
      source: detail?.metadata,
      titleOverride: stem,
    }).content;
    await api.notebase.writeFile(relativePath, finalContent);
    await notebase.refresh();
    await editor.openFile(relativePath);
    ctx.getSidebar()?.refreshTags();
    return relativePath;
  }

  /** Append an excerpt's quote (with a [[quote::id]] link) to the
   *  user's "current" note (#101). When the user is on the
   *  source-detail tab, "current" is the most-recent note tab —
   *  tracked via `lastNotePath`. Returns true when the append
   *  happened so the SourceDetail can flash a brief "Appended ✓"
   *  affordance. */
  function handleAppendExcerptToCurrent(
    excerpt: SourceExcerpt,
  ): boolean {
    const block = buildExcerptAppendBlock(excerpt);
    const active = editor.activeNoteTab;
    if (active) {
      editor.setContent(active.content + block);
      return true;
    }
    const lastNotePath = ctx.getLastNotePath();
    if (!lastNotePath) return false;
    const idx = editor.tabs.findIndex(
      (t) => t.type === 'note' && t.relativePath === lastNotePath,
    );
    if (idx === -1) return false;
    editor.switchTab(idx);
    // setContent operates on the active tab — switchTab already
    // flipped activeIndex so this targets the right buffer.
    const target = editor.tabs[idx];
    if (target.type !== 'note') return false;
    editor.setContent(target.content + block);
    return true;
  }

  return {
    handleCreateNoteFromConversation,
    handleInsertTemplate,
    handleSaveAsTemplate,
    handleNewAboutSourceNote,
    handleCreateNoteFromExcerpt,
    handleAppendExcerptToCurrent,
  };
}
