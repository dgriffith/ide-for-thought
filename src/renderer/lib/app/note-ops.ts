/**
 * Note-ops handler cluster extracted from App.svelte (#670). New note /
 * folder, delete (+ safe-delete pre-flight), the multi-path clipboard
 * (cut / copy / move / paste), merge, rename, and the prompt-driven copy /
 * move variants. Bodies are verbatim from App.svelte; the only changes are
 * the store / ctx substitutions for the few pieces that used to be inline
 * component refs or local `$state`.
 */
import { api } from '../ipc/client';
import { getNotebaseStore } from '../stores/notebase.svelte';
import { getEditorStore } from '../stores/editor.svelte';
import { getDialogStore } from '../stores/dialogs.svelte';
import { getBusyStore } from '../stores/busy.svelte';
import { getClipboardStore } from '../stores/clipboard.svelte';
import { resolveSelectionTargets, expandSelectionToNoteFiles, pathExistsInTree } from '../sidebar-tree-utils';
import { describeDeleteNoun, describeDeleteMessage, offsetToLineCol, flattenNotePaths } from './text-helpers';
import { resolveWikiLinkTarget } from '../../../shared/wiki-link-resolver';
import type { TypeInfo } from '../../../shared/objects/type-def';
import { substituteTemplate } from '../../../shared/templates';
import { buildTypedNoteScaffold } from '../../../shared/objects/scaffold';
import { CONFIRM_KEYS } from '../confirm-keys';
import type { SafeDeleteBlocker } from '../../../shared/types';

/** Minimal structural views of the bind:this component refs the note-ops touch. */
interface EditorRef { restorePosition(offset: number, scrollTop: number): void; gotoLineColumn(line: number, col: number): void; }
interface SidebarRef { getSelectionPaths(): string[]; refreshTags(): void; clearSelection(): void; }
interface SafeDeleteState { selectionCount: number; targets: string[]; blockers: SafeDeleteBlocker[]; proceed: () => void | Promise<void>; }

export interface NoteOpsCtx {
  getSidebar: () => SidebarRef | undefined;
  getEditorComponent: () => EditorRef | undefined;
  setSafeDeleteState: (s: SafeDeleteState | null) => void;
  setMergePickerSource: (s: string | null) => void;
}

export function createNoteOps(ctx: NoteOpsCtx) {
  const notebase = getNotebaseStore();
  const editor = getEditorStore();
  const dialogs = getDialogStore();
  const busy = getBusyStore();
  const clipboard = getClipboardStore();
  const { showPrompt, showConfirm, showNewNoteDialog } = dialogs;

  async function handleNewNote(directory: string = '') {
    if (!notebase.meta) return;
    const result = await showNewNoteDialog();
    if (!result) return;
    const filename = `${result.name}${result.ext}`;
    const relativePath = directory ? `${directory}/${filename}` : filename;

    // Apply a template if one was chosen — substitution runs in the
    // renderer with `showPrompt` as the interactive resolver so a
    // `{{prompt:Label}}` template can pause for input. A null prompt
    // return cancels: the file isn't written and the flow ends.
    let initialContent = '';
    let caretOffset: number | null = null;
    if (result.type) {
      // Created *as* a type (#1064): frontmatter `type:` + a scaffold of the
      // type's declared property keys, then its (substituted) template body.
      let body = '';
      if (result.type.template) {
        const sub = await substituteTemplate(result.type.template, {
          title: result.name,
          prompt: (label: string) => showPrompt(`${label}:`),
        });
        if (sub.cancelled) return;
        body = sub.content;
      }
      const scaffold = buildTypedNoteScaffold(result.type, body);
      initialContent = scaffold.content;
      caretOffset = scaffold.caretOffset;
    } else if (result.templateFilename) {
      const body = await api.templates.get(result.templateFilename);
      if (body !== null) {
        const sub = await substituteTemplate(body, {
          title: result.name,
          prompt: (label: string) => showPrompt(`${label}:`),
        });
        if (sub.cancelled) return;
        initialContent = sub.content;
        caretOffset = sub.cursorOffset;
      }
    }

    if (initialContent) {
      await api.notebase.writeFile(relativePath, initialContent);
    } else {
      await api.notebase.createFile(relativePath);
    }
    await notebase.refresh();
    await editor.openFile(relativePath);
    if (caretOffset !== null) {
      // Wait one frame so the editor has mounted the file before we
      // restore the position — restorePosition is a no-op against an
      // empty doc otherwise. Capture in a const so TS keeps the
      // narrowing past the closure boundary.
      const offset = caretOffset;
      requestAnimationFrame(() => ctx.getEditorComponent()?.restorePosition(offset, 0));
    }
    ctx.getSidebar()?.refreshTags();
  }

  /**
   * Inline `/book` typed creation (#1065). Prompts for a title, then EITHER
   * links an existing note that already resolves for it (link-don't-duplicate)
   * OR creates a fresh typed note (`type:` + scaffold + template, the #1064
   * path — no dialog, no open). Returns the wiki-link target for the editor to
   * insert, or null if cancelled. The editor owns the doc edits.
   */
  async function handleInlineTypeCreate(type: TypeInfo): Promise<string | null> {
    if (!notebase.meta) return null;
    const title = (await showPrompt(`New ${type.label} — title:`))?.trim();
    if (!title) return null;

    // If a note already resolves for this title, link it instead of duplicating.
    const files = flattenNotePaths(notebase.files).map((relativePath) => ({ relativePath, isDirectory: false }));
    if (resolveWikiLinkTarget(title, files)) return title;

    let body = '';
    if (type.template) {
      const sub = await substituteTemplate(type.template, {
        title,
        prompt: (label: string) => showPrompt(`${label}:`),
      });
      if (sub.cancelled) return null;
      body = sub.content;
    }
    const { content } = buildTypedNoteScaffold(type, body);
    await api.notebase.writeFile(`${title}.md`, content);
    await notebase.refresh();
    ctx.getSidebar()?.refreshTags();
    return title;
  }

  async function handleNewFolder(directory: string = '') {
    if (!notebase.meta) return;
    const name = await showPrompt('Folder name:');
    if (!name) return;
    const relativePath = directory ? `${directory}/${name}` : name;
    await api.notebase.createFolder(relativePath);
    await notebase.refresh();
  }

  /**
   * Selection-driven Delete. Same model as Format: the sidebar's
   * multi-selection is the source of truth, and the right-click menu
   * has already promoted single-clicks to single-selections. The
   * (relativePath, isDirectory) args are kept for the legacy callback
   * signature but ignored when a selection exists.
   *
   * Safe by default (#429): before the standard confirm, expand the
   * selection to its set of .md descendants and query the graph for
   * inbound links from notes outside that set. If any exist, show
   * the blocker dialog instead — the user can Cancel, Open the first
   * reference to fix it, or Delete anyway. The "Delete anyway" path
   * skips the second confirm; the blocker dialog already established
   * intent.
   *
   * Best-effort across all targets: failures are collected and
   * reported in one summary dialog rather than aborting the batch.
   * `closeTabsForDeletedPath` runs per successful target so a folder
   * delete also closes any open tabs for files inside it.
   */
  async function handleDelete(relativePath: string, isDirectory: boolean) {
    if (!notebase.meta) return;

    const selectionPaths = ctx.getSidebar()?.getSelectionPaths() ?? [];
    const targets = selectionPaths.length > 0
      ? resolveSelectionTargets(new Set(selectionPaths), notebase.files)
      : [{ relativePath, isDirectory }];
    if (targets.length === 0) return;

    // Build the .md set S that the pre-flight reference check needs.
    // expandSelectionToNoteFiles takes whatever paths the user picked
    // (folders or files) and yields the .md leaves underneath.
    const inputPaths = new Set(targets.map((t) => t.relativePath));
    const mdSet = expandSelectionToNoteFiles(inputPaths, notebase.files);

    let blockers: SafeDeleteBlocker[] = [];
    if (mdSet.length > 0) {
      try {
        blockers = await api.links.externalInbound(mdSet);
      } catch {
        // Graph unreachable or transient: fail open (preserve old
        // behaviour rather than block deletes on an indexing hiccup).
        blockers = [];
      }
    }

    if (blockers.length > 0) {
      ctx.setSafeDeleteState({
        selectionCount: targets.length,
        targets: mdSet,
        blockers,
        proceed: () => executeDeletes(targets),
      });
      return;
    }

    const noun = describeDeleteNoun(targets);
    const confirmed = await showConfirm(
      describeDeleteMessage(targets, noun),
      CONFIRM_KEYS.delete,
      'Delete',
    );
    if (!confirmed) return;
    await executeDeletes(targets);
  }


  async function executeDeletes(
    targets: Array<{ relativePath: string; isDirectory: boolean }>,
  ): Promise<void> {
    const failures: Array<{ path: string; error: string }> = [];
    for (const t of targets) {
      try {
        if (t.isDirectory) {
          await api.notebase.deleteFolder(t.relativePath);
        } else {
          await api.notebase.deleteFile(t.relativePath);
        }
        editor.closeTabsForDeletedPath(t.relativePath);
      } catch (err) {
        failures.push({
          path: t.relativePath,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await notebase.refresh();
    ctx.getSidebar()?.refreshTags();
    ctx.getSidebar()?.clearSelection();

    if (failures.length > 0) {
      const head = failures.slice(0, 5).map((f) => `• ${f.path}: ${f.error}`).join('\n');
      const tail = failures.length > 5 ? `\n…and ${failures.length - 5} more` : '';
      await showConfirm(
        `Failed to delete ${failures.length} of ${targets.length} item${targets.length === 1 ? '' : 's'}:\n${head}${tail}`,
        CONFIRM_KEYS.deletePartialFailure,
        'OK',
      );
    }
  }

  /**
   * Open the first linking note from the safe-delete blocker dialog
   * and jump to the link site. We scan the source's content for the
   * first `[[…<basename>…]]` occurrence — typed and untyped wiki-link
   * forms both start with `[[`, and the target basename is enough to
   * disambiguate within a single source. On no match we still open
   * the note (offset 0) so the user lands somewhere useful.
   */
  async function openFirstReferenceFromSafeDelete(source: string, target: string): Promise<void> {
    ctx.setSafeDeleteState(null);
    await editor.openFile(source);
    try {
      const content = await api.notebase.readFile(source);
      const basename = target.replace(/\.md$/, '').split('/').pop() ?? '';
      // Match `[[…basename]]`, `[[…basename|alias]]`, `[[…basename#anchor]]`
      // — anchor allowed since #140's broken-link inspection considers anchor
      // links as references too.
      const escaped = basename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`\\[\\[[^\\]]*${escaped}[^\\]]*\\]\\]`);
      const m = re.exec(content);
      const offset = m?.index ?? 0;
      const { line, col } = offsetToLineCol(content, offset);
      requestAnimationFrame(() => ctx.getEditorComponent()?.gotoLineColumn(line, col + 1));
    } catch {
      // File may have been deleted/moved between the dialog popping
      // and the click — opening alone is enough.
    }
  }

  function collectClipboardTargets(
    fallbackPath: string,
    fallbackIsDir: boolean,
  ): Array<{ relativePath: string; isDirectory: boolean }> {
    const sel = ctx.getSidebar()?.getSelectionPaths() ?? [];
    if (sel.length > 0) return resolveSelectionTargets(new Set(sel), notebase.files);
    return [{ relativePath: fallbackPath, isDirectory: fallbackIsDir }];
  }

  function handleCut(relativePath: string, isDirectory: boolean) {
    clipboard.set({ items: collectClipboardTargets(relativePath, isDirectory), mode: 'cut' });
  }

  function handleCopy(relativePath: string, isDirectory: boolean) {
    clipboard.set({ items: collectClipboardTargets(relativePath, isDirectory), mode: 'copy' });
  }

  /**
   * Drag-move. When the dragged path is itself part of the sidebar
   * selection, every selected item moves to `destDirectory` (Finder /
   * VS Code convention). Otherwise we move just the dragged item —
   * dragging a non-selected row should not silently drag the
   * selection elsewhere on screen.
   *
   * Per-item: skip same-dir no-ops, skip collisions (collected for the
   * summary), retarget any open tab whose path was the source.
   */
  async function handleMove(srcPath: string, destDirectory: string) {
    if (!notebase.meta) return;

    const sel = ctx.getSidebar()?.getSelectionPaths() ?? [];
    const targets =
      sel.includes(srcPath) && sel.length > 1
        ? resolveSelectionTargets(new Set(sel), notebase.files)
        : (() => {
            // Look up isDirectory from the tree so a folder drag still
            // round-trips correctly (rename works for both, but resolving
            // here keeps the shape consistent for the summary dialog).
            const exists = pathExistsInTree(srcPath, notebase.files);
            if (!exists) return [];
            const stack = [...notebase.files];
            while (stack.length) {
              const n = stack.pop()!;
              if (n.relativePath === srcPath) return [{ relativePath: srcPath, isDirectory: !!n.isDirectory }];
              if (n.children) stack.push(...n.children);
            }
            return [];
          })();
    if (targets.length === 0) return;

    const collisions: string[] = [];
    const failures: Array<{ path: string; error: string }> = [];
    for (const t of targets) {
      const name = t.relativePath.split('/').pop()!;
      const destPath = destDirectory ? `${destDirectory}/${name}` : name;
      if (destPath === t.relativePath) continue;
      if (pathExistsInTree(destPath, notebase.files)) {
        collisions.push(destPath);
        continue;
      }
      try {
        await api.notebase.rename(t.relativePath, destPath);
        const tabIdx = editor.tabs.findIndex((tab) => tab.type === 'note' && tab.relativePath === t.relativePath);
        if (tabIdx !== -1) {
          const tab = editor.tabs[tabIdx]!;
          if (tab.type === 'note') {
            tab.relativePath = destPath;
            tab.fileName = name;
          }
        }
      } catch (err) {
        failures.push({ path: t.relativePath, error: err instanceof Error ? err.message : String(err) });
      }
    }
    await notebase.refresh();
    ctx.getSidebar()?.clearSelection();
    if (collisions.length > 0 || failures.length > 0) {
      await reportClipboardSummary('Move', targets.length, collisions, failures);
    }
  }

  /**
   * Paste handler for the multi-path clipboard. Cut+Paste renames
   * each item into `destDirectory` and clears the clipboard +
   * selection on success; Copy+Paste leaves both alone (the user may
   * want to paste again somewhere else). Collisions and failures are
   * collected per-item and reported in a single summary dialog rather
   * than aborting the batch.
   */
  async function handlePaste(destDirectory: string) {
    const entry = clipboard.current;
    if (!entry || !notebase.meta) return;
    const { items, mode } = entry;

    const collisions: string[] = [];
    const failures: Array<{ path: string; error: string }> = [];
    for (const item of items) {
      const name = item.relativePath.split('/').pop()!;
      const destPath = destDirectory ? `${destDirectory}/${name}` : name;
      if (destPath === item.relativePath) continue;
      if (pathExistsInTree(destPath, notebase.files)) {
        collisions.push(destPath);
        continue;
      }
      try {
        if (mode === 'cut') {
          await api.notebase.rename(item.relativePath, destPath);
          const tabIdx = editor.tabs.findIndex((t) => t.type === 'note' && t.relativePath === item.relativePath);
          if (tabIdx !== -1) {
            const tab = editor.tabs[tabIdx]!;
            if (tab.type === 'note') {
              tab.relativePath = destPath;
              tab.fileName = name;
            }
          }
        } else {
          await api.notebase.copy(item.relativePath, destPath);
        }
      } catch (err) {
        failures.push({ path: item.relativePath, error: err instanceof Error ? err.message : String(err) });
      }
    }
    if (mode === 'cut') {
      clipboard.clear();
      ctx.getSidebar()?.clearSelection();
    }
    await notebase.refresh();
    if (collisions.length > 0 || failures.length > 0) {
      await reportClipboardSummary(mode === 'cut' ? 'Move' : 'Copy', items.length, collisions, failures);
    }
  }

  async function reportClipboardSummary(
    label: 'Move' | 'Copy',
    total: number,
    collisions: string[],
    failures: Array<{ path: string; error: string }>,
  ): Promise<void> {
    const lines: string[] = [];
    if (collisions.length > 0) {
      const head = collisions.slice(0, 5).map((p) => `• ${p}`).join('\n');
      const tail = collisions.length > 5 ? `\n…and ${collisions.length - 5} more` : '';
      lines.push(`Skipped ${collisions.length} (destination already exists):\n${head}${tail}`);
    }
    if (failures.length > 0) {
      const head = failures.slice(0, 5).map((f) => `• ${f.path}: ${f.error}`).join('\n');
      const tail = failures.length > 5 ? `\n…and ${failures.length - 5} more` : '';
      lines.push(`Failed (${failures.length}):\n${head}${tail}`);
    }
    const skipped = collisions.length + failures.length;
    const completed = total - skipped;
    const key = label === 'Move' ? CONFIRM_KEYS.moveCollision : CONFIRM_KEYS.copyCollision;
    await showConfirm(
      `${label} complete: ${completed} of ${total}.\n\n${lines.join('\n\n')}`,
      key,
      'OK',
    );
  }

  /**
   * Merge note (#464). Two-step: open a target picker (a filtered
   * GotoNoteDialog), then run `performMerge` against the chosen target.
   * Flushes any unsaved buffer for the source so the merge sees the
   * latest content rather than a stale on-disk copy.
   */
  function handleMerge(sourceRelPath: string) {
    if (!notebase.meta) return;
    editor.flushAutoSave();
    ctx.setMergePickerSource(sourceRelPath);
  }

  async function performMerge(sourceRelPath: string, targetRelPath: string) {
    if (sourceRelPath === targetRelPath) return;
    const sourceName = sourceRelPath.split('/').pop()?.replace(/\.md$/i, '') ?? sourceRelPath;
    const targetName = targetRelPath.split('/').pop()?.replace(/\.md$/i, '') ?? targetRelPath;
    try {
      const preview = await busy.withBusy('Counting incoming links…', () =>
        api.notebase.mergePreview(sourceRelPath, targetRelPath),
      );
      const linkLine = preview.linkOccurrences > 0
        ? `${preview.linkOccurrences} link${preview.linkOccurrences === 1 ? '' : 's'} across ${preview.affectedFiles} file${preview.affectedFiles === 1 ? '' : 's'} will be updated.`
        : 'No incoming links — only the source content will move.';
      const ok = await showConfirm(
        `Merge "${sourceName}" into "${targetName}"?\n\n${linkLine}\n\nThe source note's content is appended to the target; its frontmatter is dropped; the source note is then deleted.`,
        CONFIRM_KEYS.mergeNote,
        'Merge',
      );
      if (!ok) return;
      const result = await busy.withBusy('Merging…', () =>
        api.notebase.merge(sourceRelPath, targetRelPath),
      );
      // Open the target and scroll to the merge point. The
      // NOTEBASE_RENAMED / NOTEBASE_REWRITTEN broadcasts handle tab
      // cleanup for the source and any open referrers.
      await editor.openFile(result.targetPath);
      requestAnimationFrame(() => {
        ctx.getEditorComponent()?.gotoLineColumn(result.mergeLine, 1);
      });
      await notebase.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await showConfirm(`Merge failed: ${msg}`, CONFIRM_KEYS.mergeFailed, 'OK');
    }
  }

  async function handleRename(relativePath: string) {
    if (!notebase.meta) return;
    const oldName = relativePath.split('/').pop()!;
    // Seed the field with the current name so the user can tweak it instead
    // of retyping from scratch; pre-select just the stem so typing replaces
    // the name while the extension stays visible (#1143).
    const rawNewName = await showPrompt('New name:', { initial: oldName, selectStem: true });
    if (!rawNewName || rawNewName === oldName) return;
    // Preserve the old extension when the user didn't include one. A file
    // that drops its .md / .ttl suffix falls out of the indexed set and
    // effectively disappears from the sidebar; almost always a mistake.
    const oldDotIdx = oldName.lastIndexOf('.');
    const oldExt = oldDotIdx > 0 ? oldName.slice(oldDotIdx) : '';
    const newName = !rawNewName.includes('.') && oldExt ? `${rawNewName}${oldExt}` : rawNewName;
    const dir = relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '';
    const newPath = dir ? `${dir}/${newName}` : newName;
    // Tab path + content refresh is handled by the NOTEBASE_RENAMED /
    // NOTEBASE_REWRITTEN listeners registered in onMount — don't duplicate.
    await api.notebase.rename(relativePath, newPath);
    await notebase.refresh();
  }

  async function handleCopyWithPrompt(relativePath: string) {
    if (!notebase.meta) return;
    const oldName = relativePath.split('/').pop()!;
    const dir = relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '';
    const rawNewName = await showPrompt('Copy to (new name, or dir/name):');
    if (!rawNewName) return;
    const oldDotIdx = oldName.lastIndexOf('.');
    const oldExt = oldDotIdx > 0 ? oldName.slice(oldDotIdx) : '';
    // Preserve extension when the user didn't type one — mirror handleRename
    // so a copy doesn't silently fall out of the indexed set.
    const trimmed = rawNewName.trim().replace(/^\/+/, '');
    const lastSeg = trimmed.split('/').pop()!;
    const needsExt = !lastSeg.includes('.') && oldExt;
    const finalLast = needsExt ? `${lastSeg}${oldExt}` : lastSeg;
    const segs = trimmed.split('/');
    segs[segs.length - 1] = finalLast;
    const userPath = segs.join('/');
    // If the user typed a path-like value (contains `/`), treat it as
    // project-root relative; otherwise keep it in the source directory.
    const destPath = trimmed.includes('/') ? userPath : (dir ? `${dir}/${userPath}` : userPath);
    if (destPath === relativePath) return;

    let collision = false;
    try {
      await api.notebase.readFile(destPath);
      collision = true;
    } catch { /* expected: dest doesn't exist */ }
    if (collision) {
      await showConfirm(
        `A file already exists at "${destPath}". Copy cancelled.`,
        CONFIRM_KEYS.copyCollision,
        'OK',
      );
      return;
    }

    await api.notebase.copy(relativePath, destPath);
    await notebase.refresh();
  }

  async function handleMoveWithPrompt(relativePath: string) {
    if (!notebase.meta) return;
    const fileName = relativePath.split('/').pop()!;
    const currentDir = relativePath.includes('/') ? relativePath.substring(0, relativePath.lastIndexOf('/')) : '';
    const raw = await showPrompt(`Move "${fileName}" to folder (leave empty for root):`);
    if (raw === null) return;
    const destDir = raw.trim().replace(/^\/+|\/+$/g, '');
    if (destDir === currentDir) return;
    const newPath = destDir ? `${destDir}/${fileName}` : fileName;

    let collision = false;
    try {
      await api.notebase.readFile(newPath);
      collision = true;
    } catch { /* expected: dest doesn't exist */ }
    if (collision) {
      await showConfirm(
        `A file already exists at "${newPath}". Move cancelled.`,
        CONFIRM_KEYS.moveCollision,
        'OK',
      );
      return;
    }

    await handleMove(relativePath, destDir);
  }

  return { handleNewNote, handleInlineTypeCreate, handleNewFolder, handleDelete, executeDeletes, openFirstReferenceFromSafeDelete, handleCut, handleCopy, handleMove, handlePaste, handleMerge, performMerge, handleRename, handleCopyWithPrompt, handleMoveWithPrompt };
}
