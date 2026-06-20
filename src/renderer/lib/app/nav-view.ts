/**
 * Nav-ops + source-view-ops handler cluster extracted from App.svelte (#670).
 * Position history (back/forward), file/wiki-link navigation, and the source
 * *view* handlers (open source / PDF / excerpt, show-markdown, source-deleted).
 * Bodies are verbatim from App.svelte; the only changes are the ctx getter /
 * setter substitutions for the pieces that used to be inline component refs or
 * local `$state` (editor component, pending search / preview anchor, view mode,
 * alias map). No feature-state store — this cluster has none.
 */
import { api } from '../ipc/client';
import { getEditorStore } from '../stores/editor.svelte';
import { getNotebaseStore } from '../stores/notebase.svelte';
import { getNavigationStore, type NavPosition } from '../stores/navigation.svelte';
import { flattenNoteFiles, resolveWikiLinkTarget } from '../wiki-link-resolver';
import { findAnchorOffset } from './text-helpers';
import { getPreferredSourceView, setPreferredSourceView } from '../source-view-preference';
import { tick } from 'svelte';

interface EditorRef {
  getOffset: () => number;
  gotoOffset: (offset: number) => void;
  restorePosition: (offset: number, scrollTop?: number) => void;
}

export interface NavViewCtx {
  getEditorComponent: () => EditorRef | undefined;
  setPendingSearchQuery: (s: string | null) => void;
  setPendingPreviewAnchor: (s: string | null) => void;
  getViewMode: () => 'source' | 'preview' | 'split';
  getAliasMap: () => Record<string, string>;
}

export function createNavView(ctx: NavViewCtx) {
  const editor = getEditorStore();
  const notebase = getNotebaseStore();
  const nav = getNavigationStore();

  async function handleFileSelect(relativePath: string, searchQuery?: string) {
    recordCurrentPosition();
    const existingTab = editor.tabs.find((t) => t.type === 'note' && t.relativePath === relativePath) as import('../stores/editor.svelte').NoteTab | undefined;
    const savedOffset = existingTab?.cursorOffset;
    const savedScroll = existingTab?.scrollTop;
    ctx.setPendingSearchQuery(searchQuery ?? null);
    await editor.openFile(relativePath);
    if (!searchQuery && savedOffset != null) {
      await tick();
      requestAnimationFrame(() => {
        ctx.getEditorComponent()?.restorePosition(savedOffset, savedScroll);
      });
      nav.record({ type: 'note', relativePath, offset: savedOffset });
    } else {
      nav.record({ type: 'note', relativePath, offset: 0 });
    }
  }

  async function handleNavigate(target: string) {
    recordCurrentPosition();
    const hashIdx = target.indexOf('#');
    const pathPart = hashIdx >= 0 ? target.slice(0, hashIdx) : target;
    const anchor = hashIdx >= 0 ? target.slice(hashIdx + 1) : null;
    // Resolve against the actual note tree before falling back to a
    // naive `${target}.md`. Lets short-form wiki-links like [[raft]],
    // [[Sets, Functions]], or [[journey/raft]] open the correct file
    // regardless of how deeply nested it is.
    const flat = flattenNoteFiles(notebase.files);
    const resolved = resolveWikiLinkTarget(pathPart, flat, ctx.getAliasMap());
    const notePath = resolved ?? (pathPart.endsWith('.md') ? pathPart : `${pathPart}.md`);
    await editor.openFile(notePath);
    // Route anchors: preview scrolls by element id; editor jumps by doc offset.
    if (anchor) {
      ctx.setPendingPreviewAnchor(anchor);
      if (ctx.getViewMode() === 'source' || ctx.getViewMode() === 'split') {
        const content = editor.content;
        const offset = findAnchorOffset(content, anchor);
        if (offset !== null) {
          requestAnimationFrame(() => ctx.getEditorComponent()?.gotoOffset(offset));
        }
      }
    }
    nav.record({ type: 'note', relativePath: notePath, offset: 0 });
  }

  /**
   * Open a note and jump to a stored character offset — line bookmarks
   * (#756). The offset is honored as-is; it can go stale if the text above
   * it was edited since the bookmark was made (the offset-MVP tradeoff).
   * `restorePosition` clamps an out-of-range offset.
   */
  async function handleOpenAtOffset(relativePath: string, offset: number) {
    recordCurrentPosition();
    await editor.openFile(relativePath);
    await tick();
    requestAnimationFrame(() => ctx.getEditorComponent()?.restorePosition(offset));
    nav.record({ type: 'note', relativePath, offset });
  }

  /**
   * Locate a heading (by slug) or block-id inside raw markdown and return
   * the character offset of its line. Shared between source and split modes.
   */
  function handleSourceDeleted(sourceId: string) {
    // Close every tab bound to this source — the detail view AND any PDF
    // viewer — so the user isn't left staring at a ghost viewer that then
    // fails to load the deleted original.pdf.
    editor.closeTabsForSource(sourceId);
  }

  function handleOpenSource(sourceId: string, highlightExcerptId?: string) {
    recordCurrentPosition();
    // If the user last viewed this source as a PDF (and the file is
    // still there), route them back to the PDF tab rather than the
    // extracted-text detail. An explicit excerpt highlight wins —
    // jumping to an excerpt is a markdown-view affordance until the
    // PDF viewer's highlight click-to-navigate is wired up. (#100)
    if (!highlightExcerptId && getPreferredSourceView(sourceId) === 'pdf') {
      void api.sources.hasPdf(sourceId).then((ok) => {
        if (ok) {
          editor.openPdf(sourceId);
          nav.record({ type: 'source', sourceId });
        } else {
          editor.openSource(sourceId);
          nav.record({ type: 'source', sourceId });
        }
      });
      return;
    }
    editor.openSource(sourceId, { highlightExcerptId });
    nav.record({ type: 'source', sourceId, highlightExcerptId });
  }

  /** Open the PDF view for a source; remember the choice so the next
   *  click on this source from the sidebar / search / quick-open
   *  routes here directly. */
  function handleOpenPdf(sourceId: string) {
    recordCurrentPosition();
    setPreferredSourceView(sourceId, 'pdf');
    editor.openPdf(sourceId);
    nav.record({ type: 'source', sourceId });
  }

  /** Switch back to the extracted-markdown view from a PDF tab. */
  function handleShowMarkdownFromPdf(sourceId: string) {
    setPreferredSourceView(sourceId, 'markdown');
    editor.openSource(sourceId);
  }

  async function handleOpenExcerpt(excerptId: string) {
    const result = await api.graph.excerptSource(excerptId);
    if (!result) return;
    handleOpenSource(result.sourceId, excerptId);
  }

  function recordCurrentPosition() {
    const activeTab = editor.activeTab;
    if (!activeTab) return;
    if (activeTab.type === 'note' && editor.activeFilePath) {
      nav.record({ type: 'note', relativePath: editor.activeFilePath, offset: ctx.getEditorComponent()?.getOffset() ?? 0 });
    } else if (activeTab.type === 'query') {
      nav.record({ type: 'query', tabId: activeTab.id });
    }
  }

  async function navigateToPosition(pos: NavPosition) {
    if (pos.type === 'note') {
      await editor.openFile(pos.relativePath);
      requestAnimationFrame(() => {
        ctx.getEditorComponent()?.gotoOffset(pos.offset);
        nav.doneNavigating();
      });
    } else if (pos.type === 'source') {
      editor.openSource(pos.sourceId, { highlightExcerptId: pos.highlightExcerptId });
      nav.doneNavigating();
    } else {
      const idx = editor.tabs.findIndex((t) => t.type === 'query' && t.id === pos.tabId);
      if (idx >= 0) {
        editor.switchTab(idx);
      }
      nav.doneNavigating();
    }
  }

  async function handleNavBack() {
    recordCurrentPosition();
    const pos = nav.goBack();
    if (!pos) return;
    await navigateToPosition(pos);
  }

  async function handleNavForward() {
    recordCurrentPosition();
    const pos = nav.goForward();
    if (!pos) return;
    await navigateToPosition(pos);
  }

  return {
    recordCurrentPosition, handleNavBack, handleNavForward, handleFileSelect, handleNavigate,
    handleOpenAtOffset,
    handleSourceDeleted, handleOpenSource, handleOpenPdf, handleShowMarkdownFromPdf, handleOpenExcerpt,
  };
}
