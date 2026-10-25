/**
 * The left sidebar's panels (#2626, epic #2622): one registry the shell
 * iterates — its icon rail, its header, its body — instead of a `PANELS` table
 * plus an `{#if activePanel}` chain naming every panel.
 *
 * Each entry gives its component and `props(host)`, typed against the
 * component; `available` (some panels need a host callback to mount),
 * `count` (the header's number) and `badge` (the rail's cue) are optional.
 * A plugin's global view (#2640) registers here through `pluginLeftPanels`.
 */
import type { Component, ComponentProps } from 'svelte';
import type { IconName } from '../icons/registry';
import type { SourceMetadata } from '../../../../shared/types';
import type { getDialogStore } from '../../stores/dialogs.svelte';

type DialogStore = ReturnType<typeof getDialogStore>;
import NotesPanel from './NotesPanel.svelte';
import TagPanel from '../TagPanel.svelte';
import SourcesPanel from '../SourcesPanel.svelte';
import TablesPanel from '../TablesPanel.svelte';
import ObjectsPanel from '../ObjectsPanel.svelte';
import BookmarksPanel from '../BookmarksPanel.svelte';
import ProposalsPanel from '../ProposalsPanel.svelte';
import PluginPanel from '../plugins/PluginPanel.svelte';
import { pluginPanelIcon, pluginPanelId, pluginPanelProps, type PluginPanelId } from '../plugins/plugin-panels';
import type { ActivePluginView } from '../../stores/code-plugins.svelte';

export interface SidebarFileOps {
  onNewNote: (directory: string) => void;
  onNewFolder: (directory: string) => void;
  onDelete: (relativePath: string, isDirectory: boolean) => void;
  onAddTag?: (relativePath: string, isDirectory: boolean) => void;
  /** `targetOnly` acts on the given path even when the sidebar has a
   *  selection — the root menu passes it, since the root is never selected. */
  onLabelVersion?: (relativePath: string, isDirectory: boolean, opts?: { targetOnly?: boolean }) => void;
  onViewHistory?: (relativePath: string, isDirectory: boolean, opts?: { targetOnly?: boolean }) => void;
  onRemoveTag?: (relativePath: string, isDirectory: boolean) => void;
  onAddProperty?: (relativePath: string, isDirectory: boolean) => void;
  onRemoveProperty?: (relativePath: string, isDirectory: boolean) => void;
  onFormat?: (relativePath: string, isDirectory: boolean) => void;
  onRename: (relativePath: string) => void;
  onMerge?: (relativePath: string) => void;
  onCut: (relativePath: string, isDirectory: boolean) => void;
  onCopy: (relativePath: string, isDirectory: boolean) => void;
  onPaste: (destDirectory: string) => void;
  onMove: (srcPath: string, destDirectory: string) => void;
  onToggleEntrypoint?: (relativePath: string, currentlyEntrypoint: boolean) => void;
  onExternalDrop?: (destDirectory: string, dataTransfer: DataTransfer) => void;
}

export interface SidebarPanelOps {
  onNavigate?: (target: string) => void | Promise<void>;
  onOpenAtOffset?: (relativePath: string, offset: number) => void | Promise<void>;
  onSourceSelect?: (sourceId: string) => void;
  onOpenExcerpt?: (excerptId: string) => void;
  onOpenType?: (typeId: string) => void;
  onSourceDeleted?: (sourceId: string) => void;
  onMineReferences?: (source: SourceMetadata) => Promise<void>;
  onTableClick?: (tableName: string) => void;
  onOpenCsv?: (relativePath: string) => void;
  onOpenNote?: (relativePath: string) => void;
}

/** What the sidebar hands its panels. */
export interface LeftPanelHost {
  onFileSelect: (relativePath: string, searchQuery?: string) => void;
  fileOps: SidebarFileOps;
  panelOps: SidebarPanelOps | undefined;
  showConfirm: DialogStore['showConfirm'];
  showPrompt: DialogStore['showPrompt'];
  /** Files in the Notes tree — the Notes header's count. */
  notesCount: number;
  /** Pending proposals — the Proposals tab's cue (#1541 follow-up). */
  pendingProposals: number;
}

export interface LeftPanel {
  id: string;
  label: string;
  icon: IconName;
  component: Component<any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- typed per entry by `panel()`
  props: (host: LeftPanelHost) => Record<string, unknown>;
  /** When false the panel isn't mounted (a host without the callback it needs). */
  available?: (host: LeftPanelHost) => boolean;
  /** A number beside the panel's title, in the header, and its tooltip. */
  count?: (host: LeftPanelHost) => { value: number; title: string };
  /** A count on the panel's tab in the rail; shown when above zero. */
  badge?: (host: LeftPanelHost) => { count: number; label: string };
}

/** An entry whose `props` is checked against its component's own props. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the constraint any Svelte component satisfies
function panel<C extends Component<any>, const Id extends string>(
  def: Omit<LeftPanel, 'id' | 'component' | 'props'> & { id: Id; component: C; props: (host: LeftPanelHost) => ComponentProps<C> },
): LeftPanel & { id: Id } {
  return def;
}

/** An optional callback as a prop: present only when the host has one. */
function opt<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value !== undefined ? { [key]: value } : {}) as { [P in K]?: V };
}

export const LEFT_PANELS = [
  panel({ id: 'notes', label: 'Notes', icon: 'notes', component: NotesPanel,
    count: (h) => ({ value: h.notesCount, title: `${h.notesCount} notes` }),
    props: (h) => ({ onFileSelect: h.onFileSelect, fileOps: h.fileOps }) }),
  panel({ id: 'sites', label: 'Sources', icon: 'sites', component: SourcesPanel,
    available: (h) => !!h.panelOps?.onSourceSelect,
    props: (h) => ({
      onSourceSelect: h.panelOps!.onSourceSelect!, ...opt('onSourceDeleted', h.panelOps?.onSourceDeleted),
      onShowConfirm: h.showConfirm, onShowPrompt: h.showPrompt,
      ...opt('onMineReferences', h.panelOps?.onMineReferences), onSourceOpened: h.panelOps!.onSourceSelect!,
    }) }),
  panel({ id: 'tags', label: 'Tags', icon: 'tags', component: TagPanel,
    props: (h) => ({ onFileSelect: h.onFileSelect, ...opt('onSourceSelect', h.panelOps?.onSourceSelect) }) }),
  panel({ id: 'tables', label: 'Tables', icon: 'tables', component: TablesPanel,
    available: (h) => !!(h.panelOps?.onTableClick && h.panelOps.onOpenCsv && h.panelOps.onOpenNote),
    props: (h) => ({ onTableClick: h.panelOps!.onTableClick!, onOpenCsv: h.panelOps!.onOpenCsv!, onOpenNote: h.panelOps!.onOpenNote! }) }),
  panel({ id: 'objects', label: 'Objects', icon: 'objects', component: ObjectsPanel,
    props: (h) => ({ onFileSelect: h.onFileSelect, ...opt('onOpenExcerpt', h.panelOps?.onOpenExcerpt), ...opt('onOpenType', h.panelOps?.onOpenType) }) }),
  panel({ id: 'bookmarks', label: 'Bookmarks', icon: 'bookmark', component: BookmarksPanel,
    props: (h) => ({ onFileSelect: h.onFileSelect, ...opt('onNavigate', h.panelOps?.onNavigate), ...opt('onOpenAtOffset', h.panelOps?.onOpenAtOffset), onShowPrompt: h.showPrompt }) }),
  panel({ id: 'proposals', label: 'Proposals', icon: 'proposals', component: ProposalsPanel,
    badge: (h) => ({ count: h.pendingProposals, label: `${h.pendingProposals} pending proposals` }),
    props: () => ({}) }),
];

export type LeftPanelId = (typeof LEFT_PANELS)[number]['id'];

/** The panels plugins' global views add after the core ones (#2640). */
export function pluginLeftPanels(views: readonly ActivePluginView[]): Array<LeftPanel & { id: PluginPanelId }> {
  return views.map((v) => panel({ id: pluginPanelId(v.pluginId, v.view.id), label: v.view.title, icon: pluginPanelIcon(v.view.icon), component: PluginPanel,
    props: () => pluginPanelProps(v) }));
}
