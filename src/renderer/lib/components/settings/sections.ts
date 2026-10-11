/**
 * The Settings dialog's sections (#2626, epic #2622): one registry the dialog
 * iterates — its grouped tab list, the header over the active section, and
 * the body — instead of `SETTINGS_GROUPS` plus an `{#if activeTab}` chain over
 * every panel.
 *
 * Each entry gives its component and `props(host)`, typed against the
 * component. A section that edits state the dialog saves on Done (`bind:`)
 * goes through a small adapter here that binds into `SettingsHost`'s
 * getters/setters. A plugin's settings section (schema-rendered, #2615) will
 * register here.
 */
import type { Component, ComponentProps } from 'svelte';
import type { EditorSettings } from '../../editor/settings';
import type { Effort } from '../../../../shared/tools/effort';
import type { ProviderId } from '../../../../shared/tools/providers';
import type { CustomModel, ProviderConfigView } from '../../../../shared/tools/types';
import type { SecretStorageStatus } from '../../../../shared/secret-storage-status';
import BehaviorsSettings from '../BehaviorsSettings.svelte';
import InspectionsSettings from '../InspectionsSettings.svelte';
import AppearanceSettings from '../AppearanceSettings.svelte';
import FormatterSettings from '../FormatterSettings.svelte';
import ClipperSettings from '../ClipperSettings.svelte';
import NotesSettings from '../NotesSettings.svelte';
import ComputeSettings from '../ComputeSettings.svelte';
import VersioningSettings from '../VersioningSettings.svelte';
import McpServersSettings from '../McpServersSettings.svelte';
import ObjectTypesSettings from '../ObjectTypesSettings.svelte';
import BibliographySettings from '../BibliographySettings.svelte';
import EditorSection from './EditorSection.svelte';
import WebSection from './WebSection.svelte';
import SourcesSection from './SourcesSection.svelte';
import SkillsSection from './SkillsSection.svelte';
import AiSection from './AiSection.svelte';

/** Per-provider credential input (BYOM #1498); matches AiSettings's shape. */
export interface ProviderInput { key: string; baseURL: string; clear: boolean }

/**
 * What the dialog hands its sections: the state it saves on Done (read and
 * written through these properties) and its callbacks.
 */
export interface SettingsHost {
  editor: EditorSettings;
  webEnabled: boolean;
  allowedDomainsText: string;
  blockedDomainsText: string;
  importUpstreamTags: boolean;
  toolModelOverrides: Record<string, string>;
  model: string;
  effort: Effort | undefined;
  autoTitle: boolean;
  providerInputs: Record<ProviderId, ProviderInput>;
  customModels: CustomModel[];
  readonly providerViews: Partial<Record<ProviderId, ProviderConfigView>>;
  readonly secureStorageAvailable: boolean;
  readonly secureStorageReason: SecretStorageStatus['reason'];
  readonly onApplyFontSize: (px: number) => void;
  readonly onThemeChanged: () => void;
}

export const SETTINGS_GROUPS = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'authoring', label: 'Authoring' },
  { id: 'ingest', label: 'Ingest & compute' },
  { id: 'ai', label: 'AI' },
] as const;
export type SettingsGroupId = (typeof SETTINGS_GROUPS)[number]['id'];

export interface SettingsSection {
  id: string;
  label: string;
  /** The line under the label: what the section covers. */
  sub: string;
  group: SettingsGroupId;
  component: Component<any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- typed per entry by `section()`
  props: (host: SettingsHost) => Record<string, unknown>;
}

/** An entry whose `props` is checked against its component's own props. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the constraint any Svelte component satisfies
function section<C extends Component<any>, const Id extends string>(
  def: Omit<SettingsSection, 'id' | 'component' | 'props'> & { id: Id; component: C; props: (host: SettingsHost) => ComponentProps<C> },
): SettingsSection & { id: Id } {
  return def;
}

const none = () => ({});
const withHost = (host: SettingsHost) => ({ host });

export const SETTINGS_SECTIONS = [
  section({ id: 'editor', label: 'Editor', sub: 'Tab size · word wrap · line numbers', group: 'workspace', component: EditorSection, props: withHost }),
  section({ id: 'appearance', label: 'Appearance', sub: 'Theme · font · density', group: 'workspace', component: AppearanceSettings,
    props: (h) => ({ onApplyFontSize: h.onApplyFontSize, onThemeChanged: h.onThemeChanged }) }),
  section({ id: 'behaviors', label: 'Behaviors', sub: 'Confirm dialogs · sidebar', group: 'workspace', component: BehaviorsSettings, props: none }),
  section({ id: 'notes', label: 'Notes', sub: 'Refactoring · excerpt destinations', group: 'authoring', component: NotesSettings, props: none }),
  section({ id: 'versioning', label: 'Versioning', sub: 'History retention · size limits', group: 'authoring', component: VersioningSettings, props: none }),
  section({ id: 'formatter', label: 'Formatter', sub: 'House style · format rules', group: 'authoring', component: FormatterSettings, props: none }),
  section({ id: 'objectTypes', label: 'Object Types', sub: 'Create · delete · duplicate types', group: 'authoring', component: ObjectTypesSettings, props: none }),
  section({ id: 'inspections', label: 'Inspections', sub: 'Which health checks run · thresholds', group: 'authoring', component: InspectionsSettings, props: none }),
  section({ id: 'bibliography', label: 'Bibliography', sub: 'Citation style · locale', group: 'authoring', component: BibliographySettings, props: none }),
  section({ id: 'web', label: 'Web', sub: 'Default ingest rules', group: 'ingest', component: WebSection, props: withHost }),
  section({ id: 'sources', label: 'Sources', sub: 'Identifier lookups · privileged logins', group: 'ingest', component: SourcesSection, props: withHost }),
  section({ id: 'clipper', label: 'Browser Clipper', sub: 'Enable · pairing code · status', group: 'ingest', component: ClipperSettings, props: none }),
  section({ id: 'compute', label: 'Compute', sub: 'Python interpreter · trust', group: 'ingest', component: ComputeSettings, props: none }),
  section({ id: 'ai', label: 'AI', sub: 'Models · provider keys · voice', group: 'ai', component: AiSection, props: withHost }),
  section({ id: 'skills', label: 'Skills', sub: 'Conversation skills · import', group: 'ai', component: SkillsSection, props: withHost }),
  section({ id: 'mcpServers', label: 'MCP Servers', sub: 'Connect external tool servers', group: 'ai', component: McpServersSettings, props: none }),
];

export type SettingsTabId = (typeof SETTINGS_SECTIONS)[number]['id'];
