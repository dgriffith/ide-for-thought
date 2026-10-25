/**
 * The right sidebar's panels (#2626, epic #2622): one registry the shell
 * iterates — its group chips, its tabs, its header and its body — instead of
 * a `GROUPS` table plus an `{#if activePanel}` chain naming every panel.
 *
 * Each entry gives its component and `props(host)`: what it takes from the
 * sidebar's own props (`RightPanelHost`). The helper types `props` against the
 * component, so a panel handed the wrong props doesn't compile. A plugin's
 * plugin's global view (#2640) registers here through `pluginRightPanels`, in
 * the Plugins group.
 */
import type { Component, ComponentProps } from 'svelte';
import type { IconName } from '../icons/registry';
import type { InspectionFix } from '../../../../shared/types';
import OutlinePanel from './OutlinePanel.svelte';
import HeadingGraphPanel from './HeadingGraphPanel.svelte';
import FootnotesPanel from './FootnotesPanel.svelte';
import PropertiesPanel from './PropertiesPanel.svelte';
import HistoryPanel from './HistoryPanel.svelte';
import LinkListPanel from './LinkListPanel.svelte';
import RelatedPanel from './RelatedPanel.svelte';
import TagsPanel from './TagsPanel.svelte';
import BookmarksPanel from './BookmarksPanel.svelte';
import InspectionsPanel from './InspectionsPanel.svelte';
import TablesPanel from './TablesPanel.svelte';
import CitationsPanel from './CitationsPanel.svelte';
import PluginPanel from '../plugins/PluginPanel.svelte';
import { pluginPanelIcon, pluginPanelId, pluginPanelProps, type PluginPanelId } from '../plugins/plugin-panels';
import type { ActivePluginView } from '../../stores/code-plugins.svelte';

/** What the sidebar hands its panels: the active note and the host's callbacks. */
export interface RightPanelHost {
  activeFilePath: string | null;
  content: string;
  /** Bumped by the host on save so panels re-read. */
  revision: number;
  /** The active note's filename stem — the Heading Map's root label. */
  noteTitle: string;
  indexing: boolean;
  onFileSelect: (relativePath: string) => void;
  onNavigate: ((target: string) => void | Promise<void>) | undefined;
  onOpenAtOffset: ((relativePath: string, offset: number) => void | Promise<void>) | undefined;
  onScrollToLine: (line: number) => void;
  onOpenConversation: ((message: string, context?: string) => void) | undefined;
  onApplyInspectionFix: ((fix: InspectionFix) => void | Promise<void>) | undefined;
  onOpenQuery: (sql: string) => void;
  onOpenSource: (sourceId: string) => void;
  onOpenExcerpt: (excerptId: string) => void;
  onContentChange: ((next: string) => void) | undefined;
  onOpenGraph: ((relativePath: string) => void) | undefined;
}

export const RIGHT_PANEL_GROUPS = [
  { id: 'note', label: 'Note' },
  { id: 'links', label: 'Links' },
  { id: 'activity', label: 'Activity' },
  // Plugins' global views (#2640); shown only while one is on.
  { id: 'plugins', label: 'Plugins' },
] as const;
export type RightPanelGroupId = (typeof RIGHT_PANEL_GROUPS)[number]['id'];

export interface RightPanel {
  id: string;
  label: string;
  icon: IconName;
  group: RightPanelGroupId;
  component: Component<any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- typed per entry by `panel()`
  props: (host: RightPanelHost) => Record<string, unknown>;
  /** When false the body says `unavailableText` instead of mounting the panel. */
  available?: (host: RightPanelHost) => boolean;
  unavailableText?: string;
}

/** An entry whose `props` is checked against its component's own props. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the constraint any Svelte component satisfies
function panel<C extends Component<any>, const Id extends string>(
  def: Omit<RightPanel, 'id' | 'component' | 'props'> & { id: Id; component: C; props: (host: RightPanelHost) => ComponentProps<C> },
): RightPanel & { id: Id } {
  return def;
}

/** An optional callback as a prop: present only when the host has one. */
function opt<K extends string, V>(key: K, value: V | undefined): { [P in K]?: V } {
  return (value !== undefined ? { [key]: value } : {}) as { [P in K]?: V };
}

export const RIGHT_PANELS = [
  // ── Note: what's inside the active note ──
  panel({ id: 'outline', label: 'Outline', icon: 'outline', group: 'note', component: OutlinePanel,
    props: (h) => ({ content: h.content, onScrollToLine: h.onScrollToLine }) }),
  panel({ id: 'headingGraph', label: 'Heading Map', icon: 'graph', group: 'note', component: HeadingGraphPanel,
    props: (h) => ({ content: h.content, title: h.noteTitle, onScrollToLine: h.onScrollToLine }) }),
  panel({ id: 'properties', label: 'Properties', icon: 'properties', group: 'note', component: PropertiesPanel,
    available: (h) => h.onContentChange !== undefined, unavailableText: 'No active note.',
    props: (h) => ({ content: h.content, onContentChange: h.onContentChange!, activeFilePath: h.activeFilePath, revision: h.revision, ...opt('onNavigate', h.onNavigate) }) }),
  panel({ id: 'footnotes', label: 'Footnotes', icon: 'footnotes', group: 'note', component: FootnotesPanel,
    props: (h) => ({ content: h.content, onScrollToLine: h.onScrollToLine }) }),
  // No `revision` and no mutation callbacks: the panel reads the history
  // store, which owns the `history:changed` subscription.
  panel({ id: 'history', label: 'History', icon: 'history', group: 'note', component: HistoryPanel,
    props: (h) => ({ activeFilePath: h.activeFilePath, content: h.content }) }),
  // Tags and Tables describe what's *inside* the active note, not how it
  // connects to other notes — so they're under Note, not Links.
  panel({ id: 'tags', label: 'Tags', icon: 'tags', group: 'note', component: TagsPanel,
    props: (h) => ({ content: h.content, onFileSelect: h.onFileSelect, onSourceSelect: h.onOpenSource }) }),
  panel({ id: 'tables', label: 'Tables', icon: 'tables', group: 'note', component: TablesPanel,
    props: (h) => ({ activeFilePath: h.activeFilePath, content: h.content, revision: h.revision, onOpenQuery: h.onOpenQuery }) }),
  // ── Links: how it connects ──
  panel({ id: 'outgoing', label: 'Outgoing', icon: 'outgoing', group: 'links', component: LinkListPanel,
    props: (h) => ({ direction: 'outgoing' as const, activeFilePath: h.activeFilePath, revision: h.revision, onFileSelect: h.onFileSelect, ...opt('onOpenGraph', h.onOpenGraph) }) }),
  panel({ id: 'backlinks', label: 'Backlinks', icon: 'backlinks', group: 'links', component: LinkListPanel,
    props: (h) => ({ direction: 'backlinks' as const, activeFilePath: h.activeFilePath, revision: h.revision, onFileSelect: h.onFileSelect, ...opt('onOpenGraph', h.onOpenGraph) }) }),
  panel({ id: 'related', label: 'Related', icon: 'sparkle', group: 'links', component: RelatedPanel,
    props: (h) => ({ activeFilePath: h.activeFilePath, revision: h.revision, indexing: h.indexing, onFileSelect: h.onFileSelect, ...opt('onNavigate', h.onNavigate), onOpenSource: h.onOpenSource, onOpenExcerpt: h.onOpenExcerpt }) }),
  panel({ id: 'citations', label: 'Citations', icon: 'citations', group: 'links', component: CitationsPanel,
    props: (h) => ({ activeFilePath: h.activeFilePath, content: h.content, revision: h.revision, onOpenSource: h.onOpenSource, onOpenExcerpt: h.onOpenExcerpt }) }),
  panel({ id: 'bookmarks', label: 'Bookmarks', icon: 'bookmark', group: 'links', component: BookmarksPanel,
    props: (h) => ({ activeFilePath: h.activeFilePath, onFileSelect: h.onFileSelect, ...opt('onNavigate', h.onNavigate), ...opt('onOpenAtOffset', h.onOpenAtOffset) }) }),
  // ── Activity ──
  panel({ id: 'inspections', label: 'Inspections', icon: 'inspections', group: 'activity', component: InspectionsPanel,
    props: (h) => ({ revision: h.revision, activeFilePath: h.activeFilePath, ...opt('onOpenConversation', h.onOpenConversation), ...opt('onApplyFix', h.onApplyInspectionFix) }) }),
];

export type RightPanelId = (typeof RIGHT_PANELS)[number]['id'];

/** The panels plugins' global views add, in the Plugins group (#2640). */
export function pluginRightPanels(views: readonly ActivePluginView[]): Array<RightPanel & { id: PluginPanelId }> {
  return views.map((v) => panel({ id: pluginPanelId(v.pluginId, v.view.id), label: v.view.title, icon: pluginPanelIcon(v.view.icon), group: 'plugins', component: PluginPanel,
    props: () => pluginPanelProps(v) }));
}
