/**
 * Typed IPC contract for the notebase domain (#981).
 *
 * ONE source of truth linking channel ↔ handler ↔ preload ↔ client
 * signatures. Keys are the channel string literals (matching the
 * `Channels.*` values in `./channels`); values are the renderer-facing
 * signature `(...args) => ReturnValue`, where `ReturnValue` is the
 * RESOLVED value (Promises are unwrapped — the wrappers re-wrap).
 *
 * Pure type module: no runtime, no electron import. The typed
 * `handle`/`invoke` wrappers derive their arg + return types from here,
 * so a wrong param/return type fails `tsc` instead of silently
 * corrupting renderer state.
 */
import type {
  NotebaseMeta,
  NoteFile,
  SearchInNotesOptions,
  SearchInNotesFileResult,
  ReplaceInNotesOptions,
  ReplaceInNotesResult,
  HeadingRenameCandidate,
  TagInfo,
  TaggedNote,
  TaggedSource,
  PrivilegedSite,
  BookmarkNode,
  LayoutSession,
  TabSession,
  SavedQuery,
  SavedView,
  SavedViewInput,
  SearchResult,
  OutgoingLink,
  Backlink,
  CitationGroup,
  SafeDeleteBlocker,
  NeighborhoodOptions,
  NeighborhoodResult,
  NeighborhoodHop,
  RelatedNotesResult,
  SourceDetail,
} from './types';
import type { ClipperState } from './clipper-pairing';
import type { CellResult, CellOutput, ComputeConsentSummary } from './compute/types';
import type { AutoLinkSuggestion } from './refactor/auto-link';
import type { AutoLinkInboundSuggestion } from './refactor/auto-link-inbound';
import type { FormatSettings } from './formatter/engine';
import type { FormatFileResult } from './formatter/types';
import type {
  ToolExecutionRequest,
  ToolExecutionResult,
  ConversationToolPayload,
  LLMSettingsView,
  LLMSettingsUpdate,
  ApiKeyStorage,
  ConnectionCheckResult,
} from './tools/types';
import type { SkillCatalogInfo } from './skills/types';
import type { TypeCatalogInfo, NoteTypedProperties, TypeInstancesResult, PropertyDef } from './objects/type-def';
import type { ProviderId } from './tools/providers';
import type { MenuConfig } from './skills/menu-config';
import type {
  SourceMetadata,
  CollectionsFile,
  Collection,
  SmartCollection,
  SmartCollectionPredicate,
  ReadStatus,
} from './types';
import type { ParsedReference } from './mine-references';
import type { ResolveCandidate } from './resolve-stub';
import type { Conversation, ConversationMessage, ContextBundle, ConversationsUIState, CompactResult } from './types';
import type { ConversationToolKey } from './conversation-tools';
import type { Effort } from './tools/effort';
import type { ConversationDraft, FileDraftResult } from './conversation-drafts';
import type { ConversationSourceDraft, FileSourceDraftResult } from './conversation-source-drafts';
import type { ConversationPropertyDraft, FilePropertyDraftResult } from './conversation-property-drafts';
import type { ConversationSourcePropertyDraft, FileSourcePropertyDraftResult } from './conversation-source-property-drafts';
import type { ConversationClaimsDraft, FileClaimsDraftResult } from './conversation-claims-drafts';
import type { RunComputeDraftInput, RunComputeDraftResult, InsertComputeDraftInput, InsertComputeDraftResult } from './conversation-compute-drafts';
import type { ConversationRefactorDraft, ConversationReorgDraft, ConversationDeleteDraft } from './conversation-refactor-drafts';
import type { ConversationNoteBodyDraft, FileNoteBodyDraftResult } from './conversation-note-body-drafts';

// `HeadingRenameCandidate` is part of the notebase wire contract (the
// NOTEBASE_HEADING_RENAME_SUGGESTED event payload) but isn't an
// invoke channel, so it isn't a ChannelMap key — reference it here to
// keep the import meaningful for the domain's type surface.
export type { HeadingRenameCandidate };

export interface ChannelMap {
  'notebase:open': () => NotebaseMeta | null;
  'notebase:openPath': (rootPath: string) => NotebaseMeta;
  'notebase:newProject': () => NotebaseMeta | null;
  'notebase:openInNewWindow': () => NotebaseMeta | null;
  'notebase:newProjectInNewWindow': () => NotebaseMeta | null;
  'notebase:openPathInNewWindow': (rootPath: string) => NotebaseMeta;
  'notebase:installTutorial': () => NotebaseMeta | null;
  'notebase:installTutorialInNewWindow': () => NotebaseMeta | null;
  'notebase:close': () => null;
  'recent:clear': () => void;
  'notebase:listFiles': () => NoteFile[];
  'notebase:readFile': (relativePath: string) => string;
  'notebase:readBinary': (relativePath: string) => Uint8Array;
  'notebase:writeBinary': (relativePath: string, bytes: Uint8Array) => void;
  'images:cacheExternal': (url: string) => { bytes: Uint8Array; mime: string } | null;
  'youtube:thumbnail': (id: string) => Uint8Array | null;
  'notebase:fileExists': (relativePath: string) => boolean;
  'notebase:writeFile': (relativePath: string, content: string) => void;
  'notebase:createFile': (relativePath: string) => void;
  'notebase:deleteFile': (relativePath: string) => void;
  'notebase:createFolder': (relativePath: string) => void;
  'notebase:deleteFolder': (relativePath: string) => void;
  'notebase:rename': (oldRelPath: string, newRelPath: string) => void;
  'notebase:mergePreview': (sourceRelPath: string, targetRelPath: string) => { linkOccurrences: number; affectedFiles: number };
  'notebase:merge': (sourceRelPath: string, targetRelPath: string, separator?: string) => { targetPath: string; mergeOffset: number; mergeLine: number; rewrittenLinks: number; rewrittenPaths: string[]; deletedSource: string };
  'notebase:copy': (srcRelPath: string, destRelPath: string) => void;
  'notebase:searchInNotes': (opts: SearchInNotesOptions) => SearchInNotesFileResult[];
  'notebase:replaceInNotes': (opts: ReplaceInNotesOptions) => ReplaceInNotesResult;
  'notebase:renameAnchor': (targetRelativePath: string, oldSlug: string, newSlug: string) => { rewrittenPaths: string[] };
  'notebase:renameSource': (oldId: string, newId: string) => { rewrittenPaths: string[] };
  'notebase:renameExcerpt': (oldId: string, newId: string) => { rewrittenPaths: string[] };
  'notebase:getOnboardingDismissed': () => boolean;
  'notebase:setOnboardingDismissed': (dismissed: boolean) => void;
  /** Thoughtbase Properties (#1443): display name, folder basename, base IRI. */
  'notebase:getProperties': () => { displayName: string; folderName: string; baseUri: string };
  /** Set the display name ('' clears → folder basename); returns fresh meta. */
  'notebase:setDisplayName': (name: string) => NotebaseMeta;

  // Tags
  'tags:list': () => TagInfo[];
  'tags:notesByTag': (tag: string) => TaggedNote[];
  'tags:notesByTagPrefix': (prefix: string) => TaggedNote[];
  'tags:sourcesByTag': (tag: string) => TaggedSource[];
  'tags:allNames': () => string[];

  // Templates
  'templates:list': () => { name: string; filename: string }[];
  'templates:get': (filename: string) => string | null;
  'templates:saveAs': (name: string, content: string) => { name: string; filename: string };

  // Git (stubs)
  'git:status': () => { isRepo: boolean; branch: string | null; files: unknown[] };
  'git:commit': (message: string) => { success: boolean; sha: string };

  // Privileged sites
  'sites:list': () => PrivilegedSite[];
  'sites:add': (domain: string, label?: string) => PrivilegedSite;
  'sites:remove': (id: string) => void;
  'sites:login': (id: string) => void;
  'sites:logout': (id: string) => void;

  // Browser clipper
  'clipper:getState': () => ClipperState;
  'clipper:setEnabled': (enabled: boolean) => ClipperState;
  'clipper:regenerateSecret': () => ClipperState;

  // Export
  'export:csv': (csv: string) => void;

  // Shell
  'shell:revealFile': (relativePath?: string) => void;
  'shell:openInDefault': (relativePath: string) => void;
  'shell:openInTerminal': (relativePath?: string) => void;
  'shell:openExternal': (url: string) => void;

  // Bookmarks
  'bookmarks:load': () => BookmarkNode[];
  'bookmarks:save': (tree: BookmarkNode[]) => void;

  // Tab session
  'tabs:save': (session: LayoutSession) => void;
  'tabs:load': () => LayoutSession | TabSession | null;

  // Saved queries
  'queries:list': () => SavedQuery[];
  'queries:save': (scope: string, name: string, description: string, query: string, language: 'sparql' | 'sql', group?: string | null) => SavedQuery;
  'queries:delete': (filePath: string) => void;
  'queries:rename': (filePath: string, newName: string) => string;
  'queries:move': (filePath: string, newScope: 'project' | 'global') => string;
  'queries:setGroup': (filePath: string, group: string | null) => void;
  'queries:setOrder': (entries: Array<{ filePath: string; order: number | null }>) => void;

  // Saved views (typed-object multi-view presets — #1072)
  'views:list': () => SavedView[];
  'views:save': (scope: 'project' | 'global', input: SavedViewInput) => SavedView;
  'views:delete': (filePath: string) => void;
  'views:rename': (filePath: string, newName: string) => string;
  'views:setOrder': (entries: Array<{ filePath: string; order: number | null }>) => void;

  // Search
  'search:query': (query: string) => SearchResult[];

  // Links
  'links:outgoing': (relativePath: string) => OutgoingLink[];
  'links:backlinks': (relativePath: string) => Backlink[];
  'links:bundle': (relativePath: string) => { outgoing: OutgoingLink[]; backlinks: Backlink[] };
  'links:citationsForNote': (relativePath: string, content?: string) => CitationGroup[];
  'links:externalInbound': (paths: string[]) => SafeDeleteBlocker[];
  'links:neighborhood': (relativePath: string, opts?: NeighborhoodOptions) => NeighborhoodResult;
  'links:expandNode': (relativePath: string) => NeighborhoodHop;

  // Embeddings (semantic search)
  'embeddings:related': (relativePath: string, limit?: number) => RelatedNotesResult;
  'embeddings:unlinkedMentions': (relativePath: string, limit?: number) => RelatedNotesResult;
  'embeddings:searchText': (query: string, opts?: { limit?: number; kinds?: readonly ('note' | 'source' | 'excerpt')[]; excludePath?: string }) => RelatedNotesResult;

  // Graph
  'graph:query': (sparql: string) => { results: unknown[]; columns: string[]; error?: string };
  /** Rebase to a new base IRI + rebuild indexes (#1443 Part B); refuses when the
   *  review queue is non-empty. */
  'graph:setBaseUri': (uri: string) => { ok: true } | { ok: false; error: string };
  'graph:groundCheck': (claimText: string) => { node: string; label: string; type: string }[];
  'graph:export': () => void;
  'graph:sourceDetail': (sourceId: string) => SourceDetail | null;
  'graph:excerptSource': (excerptId: string) => { sourceId: string } | null;
  'graph:attachExcerptEvidence': (excerptId: string, claimPath: string, role: 'grounds' | 'supports' | 'rebuts') => { ok: boolean; error?: string; proposalUri?: string };
  'graph:schemaForCompletion': () =>
    | { prefixes: Array<{ prefix: string; iri: string }>; predicates: Array<{ iri: string; prefixed?: string }>; classes: Array<{ iri: string; prefixed?: string }> }
    | null;
  'graph:aliasMap': () => Record<string, string>;
  'graph:aliasEntries': () => Array<{ alias: string; relativePath: string }>;
  'graph:frontmatterKeys': () => string[];

  // Inspections (graph health checks)
  'inspections:list': () => { id: string; type: string; severity: string; nodeUri: string; nodeLabel: string; message: string; suggestedAction?: string }[];
  'inspections:run': () => { id: string; type: string; severity: string; nodeUri: string; nodeLabel: string; message: string; suggestedAction?: string }[];

  // Tables (DuckDB)
  'tables:query': (sql: string) =>
    | { ok: true; columns: string[]; rows: Record<string, unknown>[] }
    | { ok: false; error: string };
  'tables:list': () => Array<{
    name: string;
    relativePath: string;
    columns: string[];
    rowCount: number;
    source: 'csv' | 'note';
    caption?: string;
    tableIndex?: number;
  }>;

  // App / build metadata
  'app:getInfo': () => { name: string; version: string; commit: string; buildDate: string; electron: string; chrome: string; node: string };
  'app:getShortcuts': () => Array<{ menu: string; items: Array<{ label: string; keys: string }> }>;

  // External-file drag-drop import
  'files:dropImport': (targetFolder: string, localPaths: string[]) => {
    copied: Array<{ localPath: string; relativePath: string }>;
    ingestedPdfs: Array<{ localPath: string; sourceId: string; duplicate: boolean; title: string }>;
    rejected: Array<{ localPath: string; reason: string }>;
  };

  // Publication (export + git publish)
  'publish:listExporters': () => Array<{
    id: string;
    label: string;
    acceptedKinds: Array<'single-note' | 'folder' | 'project' | 'tree' | 'source'>;
    group: { id: string; label: string; category: 'document' | 'publication' | 'citation'; order: number };
    variantLabel?: string | undefined;
    variantOrder: number;
  }>;
  'publish:resolvePlan': (
    input: { kind: 'single-note' | 'folder' | 'project' | 'tree' | 'source'; relativePath?: string; maxDepth?: number },
    opts?: {
      exporterId?: string;
      linkPolicy?: 'drop' | 'inline-title' | 'follow-to-file';
      citationStyle?: string;
      citationLocale?: string;
      forceInclude?: string[];
      forceExclude?: string[];
    },
  ) => {
    exporterId: string;
    exporterLabel: string;
    inputs: Array<{ relativePath: string; kind: 'note' | 'source' | 'excerpt'; title: string; overridden: boolean }>;
    excluded: Array<{ relativePath: string; reason: string }>;
    citations: {
      styleId: string;
      localeId: string;
      availableStyles: Array<{ id: string; label: string }>;
      availableLocales: Array<{ id: string; label: string }>;
      bySource: Array<{ sourceId: string; title: string; refCount: number }>;
      missing: Array<{ id: string; kind: 'cite' | 'quote'; refCount: number }>;
    };
  };
  'publish:runExport': (args: {
    exporterId: string;
    input: { kind: 'single-note' | 'folder' | 'project' | 'tree' | 'source'; relativePath?: string; maxDepth?: number };
    outputDir?: string;
    linkPolicy?: 'drop' | 'inline-title' | 'follow-to-file';
    citationStyle?: string;
    citationLocale?: string;
    forceInclude?: string[];
    forceExclude?: string[];
  }) => { filesWritten: number; summary: string; outputDir: string; writtenPaths: string[] } | null;
  'publish:listTargets': () => PublishTarget[];
  'publish:upsertTarget': (target: PublishTarget) => PublishTarget[];
  'publish:removeTarget': (id: string) => PublishTarget[];
  'publish:toGit': (targetId: string, opts?: { dryRun?: boolean }) =>
    | { ok: true; result: {
        targetId: string;
        dryRun: boolean;
        branch: string;
        branchCreated: boolean;
        changes: Array<{ path: string; status: 'added' | 'modified' | 'deleted' }>;
        committed: boolean;
        pushed: boolean;
        sha?: string;
        commitMessage?: string;
      } }
    | { ok: false; error: string };
  /** Validate S3 credentials + endpoint against the bucket, before saving (#1444). */
  'publish:checkS3': (config: {
    bucket: string;
    endpoint?: string;
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
  }) => ConnectionCheckResult;
  /** Validate a GitHub token (GET /user); blank tests the gh CLI / env fallback (#1508). */
  'publish:checkGitHub': (config: { token?: string }) => ConnectionCheckResult;

  // Compute (notebook cells)
  'compute:runCell': (language: string, code: string, notePath?: string) => CellResult;
  'compute:languages': () => string[];
  'compute:restartPythonKernel': () => void;
  'compute:interruptPython': () =>
    | { ok: true }
    | { ok: false; reason: 'no-kernel' | 'unsupported-platform' | 'signal-failed' };
  'compute:getPythonSettings': () => { pythonPath: string; allowNetwork: boolean };
  'compute:setPythonSettings': (settings: { pythonPath: string; allowNetwork: boolean }) => void;
  'compute:probePython': (candidate?: string) => { ok: boolean; path: string; version?: string; error?: string };
  'compute:browsePython': () => string | null;
  'compute:consentStatus': (language: string, code: string) => 'cell' | 'blanket' | 'none';
  'compute:grantConsent': (language: string, code: string, scope: 'cell' | 'project') => void;
  'compute:listConsent': () => ComputeConsentSummary[];
  'compute:revokeConsent': (rootPath: string) => void;
  'compute:revealAuditLog': () => void;
  'compute:saveCellOutput': (input: {
    sourcePath: string;
    cellLanguage: string;
    cellCode: string;
    output: CellOutput;
    destPath?: string;
    title?: string;
    pin?: boolean;
    forceOverwrite?: boolean;
  }) =>
    | { status: 'written'; derivedPath: string; cellId: string; injectedId: boolean; pinned: boolean }
    | { status: 'needs-confirm'; derivedPath: string; cellId: string; existingContent: string; pendingContent: string };

  // Bibliography (#113)
  'bibliography:listStyles': () => Array<{ id: string; label: string; isUser?: boolean }>;
  'bibliography:getStyle': () => string;
  'bibliography:setStyle': (styleId: string) => void;
  'bibliography:generate': (relativePath: string) => { entriesCount: number; missingIds: string[]; changed: boolean; styleId: string };

  // User-imported CSL assets (#302)
  'csl:listUserStyles': () => Array<{ id: string; label: string; filePath: string }>;
  'csl:listUserLocales': () => Array<{ id: string; filePath: string }>;
  'csl:importStyle': () => { id: string; label: string; filePath: string } | null;
  'csl:importLocale': () => { id: string; filePath: string } | null;
  'csl:removeStyle': (id: string) => void;
  'csl:removeLocale': (id: string) => void;

  // Inline citation rendering
  'citation:renderInline': (refs: Array<{ kind: 'cite' | 'quote'; id: string }>) => { markers: string[]; bibliography: string[] | null; missing: string[]; styleId: string };

  // Refactor (LLM auto-tag / auto-link)
  'refactor:autoTagSuggest': (relativePath: string) => { added: string[] };
  'refactor:autoTagApply': (relativePath: string, acceptedTags: string[]) => { applied: string[] };
  'refactor:autoLinkSuggest': (relativePath: string) => { suggestions: AutoLinkSuggestion[]; candidateCount: number };
  'refactor:autoLinkApply': (relativePath: string, accepted: AutoLinkSuggestion[]) => { applied: AutoLinkSuggestion[]; skipped: AutoLinkSuggestion[] };
  'refactor:applySuggestedLink': (activeRelPath: string, targetRelPath: string) => { changed: boolean };
  'refactor:autoLinkInboundSuggest': (relativePath: string) => { suggestions: AutoLinkInboundSuggestion[]; candidateCount: number };
  'refactor:autoLinkInboundApply': (relativePath: string, accepted: AutoLinkInboundSuggestion[]) => { applied: AutoLinkInboundSuggestion[]; skipped: AutoLinkInboundSuggestion[]; touchedPaths: string[] };

  // Formatter (#153)
  'formatter:formatContent': (content: string, settings: FormatSettings, relativePath?: string) => string;
  'formatter:formatFile': (relativePath: string, settings: FormatSettings) => FormatFileResult;
  'formatter:formatFolder': (relDir: string, settings: FormatSettings) => { changedPaths: string[]; cascadedPaths: string[]; totalScanned: number };
  'formatter:loadSettings': () => FormatSettings;
  'formatter:saveSettings': (settings: FormatSettings) => void;

  // Tools for Thought (LLM)
  'tool:execute': (request: ToolExecutionRequest) => ToolExecutionResult;
  'tool:prepareConversation': (request: ToolExecutionRequest) => ConversationToolPayload;
  'tool:cancel': () => void;
  'tool:getSettings': () => LLMSettingsView;
  'tool:setSettings': (update: LLMSettingsUpdate) => void;
  'tool:getKeyStorage': () => ApiKeyStorage;
  'tool:checkConnection': (providerId: ProviderId, candidateKey?: string, baseURL?: string) => ConnectionCheckResult;

  // Typed objects (type registry — #1062)
  'types:list': () => TypeCatalogInfo;
  'types:noteProperties': (relativePath: string) => NoteTypedProperties;
  'types:instances': (typeId: string) => TypeInstancesResult;
  'types:save': (input: { label: string; properties: PropertyDef[]; icon?: string; color?: string; cover?: string; card?: string[]; template?: string }) => { id: string; filePath: string };
  'types:delete': (id: string) => void;

  // Skills (markdown skill files — #622)
  'skills:list': () => SkillCatalogInfo;
  'skills:reload': () => SkillCatalogInfo;
  'skills:import': () => { id: string; name: string } | null;
  'skills:remove': (id: string) => void;
  'skills:reveal': () => void;
  'skills:menuConfig:set': (config: MenuConfig) => MenuConfig;

  // Sources — ingest
  'sources:ingestUrl': (url: string) => { sourceId: string; relativePath: string; duplicate: boolean; title: string; kind?: 'web' | 'pdf' | 'text'; pageCount?: number; needsOcr?: boolean };
  'sources:ingestIdentifier': (identifier: string) => { sourceId: string; relativePath: string; duplicate: boolean; title: string; kind: 'doi' | 'arxiv' | 'pubmed'; pdfSaved: boolean; pdfError: string | null };
  'sources:ingestSmart': (rawInput: string) => { sourceId: string; duplicate: boolean; title: string; route: 'identifier' | 'url' };
  'sources:ingestFile': () => { sourceId: string; relativePath: string; duplicate: boolean; title: string; kind?: 'web' | 'pdf' | 'text'; pageCount?: number; needsOcr?: boolean } | null;
  'sources:importBibtex': () => {
    imported: Array<{ sourceId: string; title: string }>;
    duplicate: Array<{ sourceId: string; title: string }>;
    failed: Array<{ key: string; reason: string }>;
    parseErrors: number;
    totalEntries: number;
  } | null;
  'sources:importZoteroRdf': () => {
    imported: Array<{ sourceId: string; title: string; pdfAttached: boolean }>;
    duplicate: Array<{ sourceId: string; title: string }>;
    failed: Array<{ subject: string; reason: string }>;
    totalItems: number;
  } | null;

  // Sources — read / manage
  'sources:readPdf': (sourceId: string) => Uint8Array;
  'sources:hasPdf': (sourceId: string) => boolean;
  'sources:finishPdfOcr': (sourceId: string, pages: string[]) => void;
  'sources:listAll': () => SourceMetadata[];
  'sources:delete': (sourceId: string) => { sourceId: string; excerptsRemoved: number };
  'sources:merge': (params: { srcId: string; destId: string }) => {
    destId: string;
    removedId: string;
    excerptsMoved: number;
    notesRewritten: number;
    metadataAdded: string[];
    artifactsCopied: string[];
  };
  'sources:setReadStatus': (params: { sourceId: string; status: ReadStatus | null }) => void;
  'sources:setTitle': (params: { sourceId: string; title: string }) => void;
  'sources:setReadDueBy': (params: { sourceId: string; dueBy: string | null }) => void;
  'sources:addTag': (params: { sourceId: string; tag: string }) => void;
  'sources:removeTag': (params: { sourceId: string; tag: string }) => void;
  'sources:queueMembers': (view: 'unread' | 'reading' | 'dueThisWeek' | 'recentlyFinished') => SourceMetadata[];
  'sources:stripUpstreamTags': (sourceId: string) => { removed: number };

  // Sources — references (#106/#107)
  'sources:mineReferences': (sourceId: string) => ParsedReference[];
  'sources:createReferenceStubs': (params: { sourceId: string; refs: ParsedReference[] }) => {
    created: Array<{ sourceId: string; title: string }>;
    matchedExisting: Array<{ sourceId: string; title: string }>;
    skipped: Array<{ reason: string; raw: string }>;
  };
  'sources:resolveStub': (sourceId: string) => ResolveCandidate[];
  'sources:applyStubResolution': (params: { sourceId: string; doi: string }) => { ok: boolean };

  // Sources — excerpts
  'sources:createExcerpt': (params: { sourceId: string; citedText: string; page?: number | null; pageRange?: string | null; locationText?: string | null }) => { excerptId: string; relativePath: string; duplicate: boolean };

  // Ingest settings (per-machine)
  'ingest:getSettings': () => { importUpstreamTags: boolean };
  'ingest:setSettings': (settings: { importUpstreamTags: boolean }) => void;

  // Excerpt → note folder default (#101)
  'excerpt:getNoteFolder': () => string;
  'excerpt:setNoteFolder': (folder: string) => void;

  // Collections (#470)
  'collections:list': () => CollectionsFile;
  'collections:create': (args: { name: string; parent?: string | null }) => Collection;
  'collections:rename': (args: { id: string; name: string }) => void;
  'collections:delete': (id: string) => void;
  'collections:addSource': (args: { collectionId: string; sourceId: string }) => void;
  'collections:removeSource': (args: { collectionId: string; sourceId: string }) => void;
  'collections:createSmart': (args: { name: string; predicate: SmartCollectionPredicate }) => SmartCollection;
  'collections:renameSmart': (args: { id: string; name: string }) => void;
  'collections:deleteSmart': (id: string) => void;
  'collections:updateSmartPredicate': (args: { id: string; predicate: SmartCollectionPredicate }) => void;
  'collections:smartMembers': (id: string) => SourceMetadata[];

  // Proposals (approval engine)
  'proposal:list': (status?: string) => unknown[];
  'proposal:detail': (uri: string) => unknown;
  'proposal:approve': (uri: string) => boolean;
  'proposal:reject': (uri: string) => boolean;
  'proposal:expire': () => number;
  'proposals:notifyArrival': (arg: { count: number; proposer: string }) => void;

  // Conversations
  'conversation:create': (contextBundle: ContextBundle, triggerNodeUri?: string, options?: { systemPrompt?: string; model?: string; webEnabled?: boolean }) => Conversation;
  'conversation:append': (id: string, role: ConversationMessage['role'], content: string) => Conversation;
  'conversation:archive': (id: string) => Conversation;
  'conversation:load': (id: string) => Conversation | null;
  'conversation:list': () => Conversation[];
  'conversation:listActive': () => Conversation[];
  'conversation:send': (convId: string, userMessage: string, systemPrompt?: string, currentNotePath?: string, extraTools?: ConversationToolKey[]) => Conversation;
  'conversation:cancel': () => void;
  'conversation:uiStateLoad': () => ConversationsUIState;
  'conversation:uiStateSave': (state: ConversationsUIState) => void;
  'conversation:askUserReply': (questionId: string, answer: string) => void;
  'conversation:setModel': (conversationId: string, model: string | undefined) => Conversation;
  'conversation:setEffort': (conversationId: string, effort: Effort | undefined) => Conversation;
  'conversation:compact': (conversationId: string) => CompactResult;

  // Conversation draft filing (renderer approves an inline card)
  'conversation:fileDraft': (draft: ConversationDraft) => FileDraftResult;
  'conversation:fileSourceDraft': (draft: ConversationSourceDraft) => FileSourceDraftResult;
  'conversation:filePropertyDraft': (draft: ConversationPropertyDraft) => FilePropertyDraftResult;
  'conversation:fileSourcePropertyDraft': (draft: ConversationSourcePropertyDraft) => FileSourcePropertyDraftResult;
  'conversation:fileClaimsDraft': (draft: ConversationClaimsDraft) => FileClaimsDraftResult;
  'conversation:runComputeDraft': (input: RunComputeDraftInput) => RunComputeDraftResult;
  'conversation:insertComputeDraft': (input: InsertComputeDraftInput) => InsertComputeDraftResult;
  'conversation:fileRefactorDraft': (draft: ConversationRefactorDraft) => { proposalUri: string | null; applied: boolean };
  'conversation:fileReorgDraft': (draft: ConversationReorgDraft, selected: Array<{ fromPath: string; toPath: string }>) => { proposalUri: string | null; applied: boolean };
  'conversation:fileDeleteDraft': (draft: ConversationDeleteDraft, selected: string[]) => { proposalUri: string | null; applied: boolean };
  'conversation:fileNoteBodyDraft': (draft: ConversationNoteBodyDraft) => FileNoteBodyDraftResult;
}

/** A configured publish destination (#254; multi-transport #1444). Mirror of the
 *  main-side `PublishTarget` (project-config) + renderer `PublishTarget`. */
interface PublishTargetBase {
  id: string;
  label: string;
  exporter: string;
  subdir?: string;
}
export interface GitPublishTarget extends PublishTargetBase {
  kind?: 'git';
  gitRemote: string;
  gitBranch: string;
  commitMessageTemplate?: string;
}
export interface S3PublishTarget extends PublishTargetBase {
  kind: 's3';
  bucket: string;
  endpoint?: string;
  region?: string;
  accessKeyId?: string;
  /** Write-only on upsert (tri-state); never returned by the read path. */
  secretAccessKey?: string;
  /** Read-only: a secret is stored. */
  hasSecret?: boolean;
}
export type PublishTarget = GitPublishTarget | S3PublishTarget;
