/**
 * Tab/layout session serialization, extracted from `getEditorStore` (#1919).
 * Pure data mapping between the live `EditorGroup`/`Tab` shape and the
 * persisted `SavedGroup`/`SavedTab`/`LayoutSession` shape — no autosave, no
 * cursor/scroll tracking, no view-mode cycling, none of the store's other
 * editor behavior. The store still owns the actual `$state` (`groups`,
 * `activeGroupId`, `layout`) and the `api.tabs.save`/`load` IPC calls; this
 * module only computes what to persist and how to turn persisted data back
 * into live tabs.
 */
import type {
  TabSession, SavedTab, SavedGroup, LayoutSession,
} from '../../../shared/types';
import { type LayoutNode, leaf, collectGroupIds, isLayoutNode } from './layout-tree';
import {
  type EditorGroup, type Tab, type ViewMode,
  isNote, isQuery, isPdf, isGraph, isTypeView, isUnsupported,
} from './tab-types';
import { extensionOf } from '../../../shared/file-capability';
import { api } from '../ipc/client';

export function toSavedTab(t: Tab): SavedTab {
  if (isNote(t)) {
    return {
      type: 'note',
      relativePath: t.relativePath,
      ...(t.plainText ? { plainText: true } : {}),
      ...(t.cursorOffset !== undefined ? { cursorOffset: t.cursorOffset } : {}),
      ...(t.scrollTop !== undefined ? { scrollTop: t.scrollTop } : {}),
      ...(t.previewScrollTop !== undefined ? { previewScrollTop: t.previewScrollTop } : {}),
    };
  } else if (isUnsupported(t)) {
    return { type: 'unsupported', relativePath: t.relativePath };
  } else if (isQuery(t)) {
    return { type: 'query', title: t.title, query: t.query, language: t.language };
  } else if (isPdf(t)) {
    return { type: 'pdf', sourceId: t.sourceId, page: t.page };
  } else if (isGraph(t)) {
    return { type: 'graph', relativePath: t.relativePath, depth: t.depth };
  } else if (isTypeView(t)) {
    return { type: 'type-view', typeId: t.typeId, layout: t.layout, sortColumn: t.sortColumn, sortDir: t.sortDir, columns: t.columns };
  } else {
    return {
      type: 'source',
      sourceId: t.sourceId,
      ...(t.highlightExcerptId !== undefined ? { highlightExcerptId: t.highlightExcerptId } : {}),
    };
  }
}

/** Build the persisted session shape from the live editor-group state (#816). */
export function buildSession(groups: EditorGroup[], activeGroupId: string, layout: LayoutNode): LayoutSession {
  return {
    version: 2,
    activeGroupId,
    groups: groups.map((g): SavedGroup => ({
      id: g.id,
      activeIndex: g.activeIndex,
      viewMode: g.viewMode,
      tabs: g.tabs.map(toSavedTab),
    })),
    layout,
  };
}

/** Reconstruct a live tab from its persisted form. Notes read their file back
 *  (returning null if it was deleted since last session, so the tab is
 *  dropped); the other kinds rehydrate from saved fields. `nextQueryId`
 *  shares the store's query-id counter so a restored query tab's id can
 *  never collide with one opened fresh in the same session. */
export async function reconstructTab(saved: SavedTab, nextQueryId: () => string): Promise<Tab | null> {
  if (saved.type === 'note') {
    try {
      const text = await api.notebase.readFile(saved.relativePath);
      const fileName = saved.relativePath.split('/').pop() ?? '';
      return {
        type: 'note',
        relativePath: saved.relativePath,
        fileName,
        content: text,
        savedContent: text,
        ...(saved.plainText ? { plainText: true } : {}),
        cursorOffset: saved.cursorOffset,
        scrollTop: saved.scrollTop,
        previewScrollTop: saved.previewScrollTop,
      };
    } catch {
      return null; // file deleted since last session
    }
  } else if (saved.type === 'unsupported') {
    const fileName = saved.relativePath.split('/').pop() ?? '';
    return { type: 'unsupported', relativePath: saved.relativePath, fileName, ext: extensionOf(saved.relativePath) };
  } else if (saved.type === 'query') {
    return {
      type: 'query',
      id: nextQueryId(),
      title: saved.title,
      query: saved.query,
      language: saved.language ?? 'sparql',
      results: null,
      columns: [],
      error: null,
      executing: false,
      executionTime: null,
    };
  } else if (saved.type === 'pdf') {
    return { type: 'pdf', sourceId: saved.sourceId, page: saved.page ?? 1 };
  } else if (saved.type === 'graph') {
    return { type: 'graph', relativePath: saved.relativePath, depth: saved.depth ?? 1 };
  } else if (saved.type === 'type-view') {
    return {
      type: 'type-view',
      typeId: saved.typeId,
      layout: saved.layout ?? 'table',
      sortColumn: saved.sortColumn ?? null,
      sortDir: saved.sortDir ?? 'asc',
      columns: saved.columns ?? null,
    };
  } else {
    return { type: 'source', sourceId: saved.sourceId, highlightExcerptId: saved.highlightExcerptId };
  }
}

export function asViewMode(v: unknown): ViewMode {
  return v === 'preview' || v === 'editor-preview' || v === 'source' ? v : 'source';
}

/** Cross-pane identity of a persisted tab, for the forbid-duplicate dedup on
 *  restore (#815). Queries have no shared-buffer identity (each is its own
 *  scratch buffer), so they return null and are never deduped. */
export function savedTabIdentity(t: SavedTab): string | null {
  if (t.type === 'note') return `note:${t.relativePath}`;
  if (t.type === 'source') return `source:${t.sourceId}`;
  if (t.type === 'pdf') return `pdf:${t.sourceId}`;
  if (t.type === 'type-view') return `type-view:${t.typeId}`;
  return null;
}

/** Coerce whatever is on disk into the current multi-group shape. New
 *  sessions pass through; a legacy flat `TabSession` migrates to a single
 *  group (#816); anything else (null / empty / unrecognised) → null, so the
 *  caller keeps the start-of-session empty group. */
export function normalizeSession(raw: LayoutSession | TabSession | null, newGroupId: () => string): LayoutSession | null {
  if (!raw || typeof raw !== 'object') return null;
  if ('groups' in raw && Array.isArray(raw.groups)) {
    return raw.groups.length > 0 ? raw : null;
  }
  if ('tabs' in raw && Array.isArray(raw.tabs)) {
    if (raw.tabs.length === 0) return null;
    const id = newGroupId();
    return {
      version: 2,
      activeGroupId: id,
      groups: [{ id, activeIndex: raw.activeIndex ?? 0, viewMode: 'source', tabs: raw.tabs }],
      layout: { kind: 'leaf', groupId: id },
    };
  }
  return null;
}

/**
 * Turn a normalized session into the live groups/layout/activeGroupId to
 * commit, dropping note tabs whose files have since vanished and any
 * duplicate of a tab already restored in an earlier pane (#815) — even if
 * the on-disk session was hand-edited or written by an older build. Falls
 * back to merging every restored tab into one pane if the saved layout
 * doesn't structurally match the restored groups (corrupt tree) rather than
 * rendering a broken split or crashing. Returns null only in the defensive
 * case of an empty group list (normalizeSession already rules this out for
 * data it produces itself).
 */
export async function resolveRestoredSession(
  session: LayoutSession,
  nextQueryId: () => string,
): Promise<{ groups: EditorGroup[]; layout: LayoutNode; activeGroupId: string } | null> {
  const seen = new Set<string>();
  const restored: EditorGroup[] = [];
  for (const sg of session.groups) {
    const tabs: Tab[] = [];
    for (const saved of sg.tabs) {
      const identity = savedTabIdentity(saved);
      if (identity && seen.has(identity)) continue;
      const tab = await reconstructTab(saved, nextQueryId);
      if (tab) {
        tabs.push(tab);
        if (identity) seen.add(identity);
      }
    }
    const activeIndex =
      sg.activeIndex >= 0 && sg.activeIndex < tabs.length
        ? sg.activeIndex
        : tabs.length > 0 ? 0 : -1;
    restored.push({ id: sg.id, tabs, activeIndex, viewMode: asViewMode(sg.viewMode) });
  }
  if (restored.length === 0) return null;

  // The saved layout must structurally match the restored groups exactly
  // (every leaf ↔ a live group, no orphans). If it doesn't, we can't trust
  // the tree — recover by merging every restored tab into one pane rather
  // than rendering a broken split or crashing.
  const ids = new Set(restored.map((g) => g.id));
  // SavedLayoutNode is structurally a LayoutNode; isLayoutNode still guards
  // against a corrupt on-disk tree that doesn't match the declared shape.
  const savedLayout = session.layout;
  const layoutOk =
    isLayoutNode(savedLayout) &&
    (() => {
      const leaves = collectGroupIds(savedLayout);
      return leaves.length === ids.size && leaves.every((id) => ids.has(id));
    })();

  if (layoutOk) {
    return {
      groups: restored,
      layout: savedLayout,
      activeGroupId: ids.has(session.activeGroupId) ? session.activeGroupId : restored[0]!.id,
    };
  }
  const merged: EditorGroup = {
    id: restored[0]!.id,
    tabs: restored.flatMap((g) => g.tabs),
    activeIndex: -1,
    viewMode: restored[0]!.viewMode,
  };
  merged.activeIndex = merged.tabs.length > 0 ? 0 : -1;
  return { groups: [merged], layout: leaf(merged.id), activeGroupId: merged.id };
}
