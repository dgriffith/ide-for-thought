<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { api } from '../ipc/client';
  import Preview from './Preview.svelte';
  import ExcerptDensityGutter from './ExcerptDensityGutter.svelte';
  import Icon from './Icon.svelte';
  import Eyebrow from './ui/Eyebrow.svelte';
  import Chip from './ui/Chip.svelte';
  import NavList from './NavList.svelte';
  import SourceLinkRow from './SourceLinkRow.svelte';
  import { renderInlineWithMath } from '../markdown/inline-math';
  import type { SourceDetail, SourceExcerpt, SourceBacklink, ReadStatus } from '../../../shared/types';
  import type { ThinkingToolInfo } from '../../../shared/tools/types';
  import { isSourceScoped } from '../../../shared/tools/types';
  import { groupToolsByGroup } from '../../../shared/tools/grouping';
  import { getAllToolInfos } from '../tools/tool-registry';
  import { displaySourceTitle } from '../../../shared/source-display';
  import { renameSource, deleteSource, addSourceTag, sourceTagSuggestions } from '../sources/source-actions';
  import { installDismissOnClickOutside } from '../dismiss-menu';
  import { getSourceDataStore } from '../stores/source-data.svelte';
  import { getNotebaseStore } from '../stores/notebase.svelte';

  const sourceData = getSourceDataStore();
  const notebase = getNotebaseStore();

  const READ_STATUS_OPTIONS: { value: ReadStatus; label: string }[] = [
    { value: 'unread', label: 'Unread' },
    { value: 'reading', label: 'Reading' },
    { value: 'read', label: 'Read' },
    { value: 'skipped', label: 'Skipped' },
  ];

  interface Props {
    sourceId: string;
    highlightExcerptId?: string | undefined;
    onNavigate: (target: string) => void;
    onShowConfirm: (message: string, key: string, label?: string) => Promise<boolean>;
    /** Prompt for text (rename). Host supplies App.svelte's showPrompt. */
    onShowPrompt: (message: string, initial?: string) => Promise<string | null>;
    onDeleted?: (sourceId: string) => void;
    /** Create a Zotero-style child note pre-populated with
     *  `about: [[sources/<id>]]`, open it for editing, and refresh
     *  this detail view so the new note shows under Notes (#474). */
    onCreateAboutNote?: (sourceId: string) => Promise<string | null>;
    /** Open another source — used by the References section to
     *  navigate to a referenced source (or stub) (#106). */
    onOpenReference?: (sourceId: string) => void;
    /** Resolve this stub source by searching CrossRef (#107). The
     *  host runs the search, surfaces a picker if needed, and
     *  re-loads this detail when the meta.ttl gets rewritten. */
    onResolveStub?: (sourceId: string) => Promise<void>;
    /** Open the source's `original.pdf` in a PDF tab (#100). Host
     *  may also remember the preference per source so the next
     *  open of this source routes to the PDF directly. */
    onOpenPdf?: (sourceId: string) => void;
    /** Create a new note from an excerpt (#101). Host runs the
     *  showPrompt for the title, writes the file to the configured
     *  folder, and opens it. */
    onCreateNoteFromExcerpt?: (
      sourceId: string,
      excerpt: import('../../../shared/types').SourceExcerpt,
    ) => Promise<string | null>;
    /** Append the excerpt to the active note tab (#101). Host
     *  no-ops if there is no active note tab. Boolean tells the
     *  caller whether the append succeeded so the UI can flash a
     *  toast. */
    onAppendExcerptToCurrent?: (
      excerpt: import('../../../shared/types').SourceExcerpt,
    ) => boolean;
    /** Whether the host currently has an active note tab — used to
     *  enable / disable the Append button. */
    canAppendToCurrent?: boolean;
    /** Attach this excerpt as grounds/supports/rebuts evidence for a claim
     *  (#1073) — the host opens a role + claim picker and files a proposal. */
    onAttachEvidence?: (excerptId: string) => void;
    /** Invoke a source-scoped tool (#103) on this source. The host runs
     *  the same gather-context → tool-panel / conversation flow used by
     *  the note menus; since this source is the active tab, gatherContext
     *  picks up its body/metadata. */
    onInvokeTool?: (toolId: string) => void;
    /** Mirror of the `numberedHeadings` editor setting (#1120), forwarded to
     *  the source body's Preview so it agrees with note previews. */
    numberedHeadings?: boolean;
  }

  let {
    sourceId, highlightExcerptId, onNavigate, onShowConfirm, onShowPrompt, onDeleted,
    onCreateAboutNote, onOpenReference, onResolveStub, onOpenPdf,
    onCreateNoteFromExcerpt, onAppendExcerptToCurrent, canAppendToCurrent = false,
    onAttachEvidence, onInvokeTool, numberedHeadings = false,
  }: Props = $props();
  let resolving = $state(false);
  let appendFlashId = $state<string | null>(null);

  // Source-scoped tools (#103) for the header "Tools" menu. Skills register
  // into the renderer registry during app startup, before any source tab is
  // opened, so reading the registry here is reliable; the list is grouped by
  // the skill's optional `group:` for the same thematic submenus the note
  // menus use (#525).
  let toolMenuOpen = $state(false);
  const sourceToolGroups = groupToolsByGroup(
    getAllToolInfos().filter((t) => isSourceScoped(t)),
  );
  const hasSourceTools = sourceToolGroups.some((g) => g.tools.length > 0);
  function invokeTool(tool: ThinkingToolInfo) {
    toolMenuOpen = false;
    onInvokeTool?.(tool.id);
  }

  // Element refs + bump-on-change revision for the density gutter (#102).
  let scrollerEl = $state<HTMLDivElement>();
  let bodyViewEl = $state<HTMLDivElement>();
  let gutterRevision = $state(0);
  // Re-index excerpt positions when bodyContent or the excerpt set
  // changes. The write to gutterRevision is wrapped in `untrack` so
  // the increment doesn't re-trigger this same effect — without it,
  // reading + writing gutterRevision spins forever, blocking the
  // event loop and locking the UI on any tab containing this detail.
  $effect(() => {
    void bodyContent;
    void detail?.excerpts.length;
    untrack(() => { gutterRevision++; });
  });

  /** True when `.minerva/sources/<id>/original.pdf` exists, so the
   *  "Open original PDF" button can show (#100). Resolved on mount;
   *  re-resolved when the active source changes. */
  let hasPdf = $state(false);

  $effect(() => {
    void api.sources.hasPdf(sourceId).then((r) => { hasPdf = r; });
  });

  async function handleRename() {
    if (!detail) return;
    await renameSource(detail.metadata, onShowPrompt, () => load(sourceId));
  }

  async function handleDelete() {
    if (!detail) return;
    await deleteSource(detail.metadata, onShowConfirm, () => onDeleted?.(sourceId));
  }

  // ── Tags (#766) ──────────────────────────────────────────────────────────
  let addingTag = $state(false);
  let newTagText = $state('');

  /** Focus the inline tag input the moment it mounts. */
  function autofocus(node: HTMLInputElement) { node.focus(); }

  /** Project tag vocabulary for the inline add-tag autocomplete, minus tags
   *  this source already carries. Loaded fresh each time the input opens. */
  let tagVocab = $state<string[]>([]);
  const tagListId = 'source-tag-suggestions';

  function startAddTag() {
    newTagText = '';
    addingTag = true;
    void loadTagVocab();
  }

  async function loadTagVocab() {
    tagVocab = await sourceTagSuggestions(detail?.metadata);
  }

  async function commitAddTag() {
    const t = newTagText.trim();
    addingTag = false;
    newTagText = '';
    await addSourceTag(sourceId, t, () => load(sourceId));
  }

  function tagInputKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter') { e.preventDefault(); void commitAddTag(); }
    else if (e.key === 'Escape') { addingTag = false; newTagText = ''; }
  }

  async function handleRemoveTag(tag: string) {
    try {
      await sourceData.removeTag(sourceId, tag);
      await load(sourceId);
    } catch (err) {
      console.error('[minerva] remove source tag failed:', err);
    }
  }

  let detail = $state<SourceDetail | null>(null);
  let loading = $state(true);
  let loadedId = $state<string | null>(null);

  // body.md is the extracted content from ingest (or hand-authored for
  // manually-placed sources). Null means the file doesn't exist for this
  // source — older sources without bodies stay tidy with no "Content" header.
  let bodyContent = $state<string | null>(null);
  let bodyLoaded = $state(false);
  let bodyLoadedFor = $state<string | null>(null);
  let editMode = $state(false);
  let draftBody = $state('');
  let saving = $state(false);
  let saveError = $state<string | null>(null);
  const bodyRelativePath = $derived(`.minerva/sources/${sourceId}/body.md`);

  async function load(id: string) {
    loading = true;
    loadedId = id;
    try {
      detail = await api.graph.sourceDetail(id);
    } finally {
      loading = false;
    }
  }

  async function loadBody(id: string) {
    bodyLoaded = false;
    bodyLoadedFor = id;
    editMode = false;
    saveError = null;
    try {
      bodyContent = await api.notebase.readFile(`.minerva/sources/${id}/body.md`);
    } catch {
      // body.md is optional; sources can ship meta-only.
      bodyContent = null;
    } finally {
      bodyLoaded = true;
    }
  }

  $effect(() => {
    if (sourceId !== loadedId) {
      void load(sourceId);
    }
  });

  $effect(() => {
    if (sourceId !== bodyLoadedFor) {
      void loadBody(sourceId);
    }
  });

  function enterEditMode() {
    draftBody = bodyContent ?? '';
    saveError = null;
    editMode = true;
  }

  function cancelEdit() {
    editMode = false;
    draftBody = '';
    saveError = null;
  }

  async function saveBody() {
    saving = true;
    saveError = null;
    try {
      await notebase.writeFile(bodyRelativePath, draftBody);
      bodyContent = draftBody;
      editMode = false;
    } catch (err) {
      saveError = err instanceof Error ? err.message : String(err);
    } finally {
      saving = false;
    }
  }

  // ── Highlight → Excerpt (#224) ──────────────────────────────────────────

  // Right-click inside the rendered body with text selected → show a small
  // menu with "Save as excerpt". Click invokes the main-process create, then
  // the file-watcher broadcast refreshes the Excerpts list below.
  let excerptMenu = $state<{ x: number; y: number; text: string } | null>(null);
  let excerptError = $state<string | null>(null);
  let creatingExcerpt = $state(false);
  let recentExcerpt = $state<{ id: string; duplicate: boolean } | null>(null);

  function handleBodyContextMenu(e: MouseEvent): void {
    if (editMode) return;
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (!text) return; // no selection — let the native context menu show
    e.preventDefault();
    excerptMenu = { x: e.clientX, y: e.clientY, text };
    excerptError = null;
    installDismissOnClickOutside(() => { excerptMenu = null; });
  }

  async function saveExcerpt(): Promise<void> {
    if (!excerptMenu) return;
    const citedText = excerptMenu.text;
    creatingExcerpt = true;
    excerptError = null;
    try {
      const result = await sourceData.createExcerpt({ sourceId, citedText });
      recentExcerpt = { id: result.excerptId, duplicate: result.duplicate };
      excerptMenu = null;
      // Reload the source detail so the new excerpt shows up in the list
      // even before the file-watcher's broadcast arrives.
      await load(sourceId);
      // Clear the "just-saved" banner after a moment.
      setTimeout(() => { recentExcerpt = null; }, 4000);
    } catch (err) {
      excerptError = err instanceof Error ? err.message : String(err);
    } finally {
      creatingExcerpt = false;
    }
  }

  // Reload the source detail when the main process tells us an excerpt
  // was added/updated/removed (covers cross-window sync and any direct
  // filesystem edits the user made to excerpt ttls). Subscribe in onMount and
  // return the unsubscribe so the listener is torn down on unmount (#1610).
  onMount(() => sourceData.onExcerptsChanged(() => {
    if (loadedId === sourceId) void load(sourceId);
  }));

  async function createNoteFromExcerpt(excerpt: SourceExcerpt): Promise<void> {
    if (!onCreateNoteFromExcerpt) return;
    await onCreateNoteFromExcerpt(sourceId, excerpt);
  }

  function appendExcerptToCurrent(excerpt: SourceExcerpt): void {
    if (!onAppendExcerptToCurrent) return;
    const ok = onAppendExcerptToCurrent(excerpt);
    if (ok) {
      appendFlashId = excerpt.excerptId;
      setTimeout(() => { if (appendFlashId === excerpt.excerptId) appendFlashId = null; }, 1500);
    }
  }

  // After render, if a specific excerpt was highlighted, scroll it into view.
  $effect(() => {
    if (!detail || !highlightExcerptId) return;
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-excerpt-anchor="${CSS.escape(highlightExcerptId)}"]`);
      if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  });

  function formatByline(creators: string[], year: string | null): string {
    const who = creators.length === 0 ? ''
      : creators.length === 1 ? creators[0]
      : creators.length === 2 ? `${creators[0]} and ${creators[1]}`
      : `${creators[0]} et al.`;
    if (who && year) return `${who} (${year})`;
    return who || (year ?? '');
  }

  function openExternal(url: string) {
    void api.shell.openExternal(url);
  }

  function excerptLocation(e: SourceExcerpt): string {
    if (e.pageRange) return `pp. ${e.pageRange}`;
    if (e.page) return `p. ${e.page}`;
    if (e.locationText) return e.locationText;
    return '';
  }

  function backlinkLabel(b: SourceBacklink): string {
    return b.kind === 'cite' ? 'cites' : 'quotes';
  }

  async function handleSetReadStatus(next: ReadStatus | null): Promise<void> {
    if (!detail) return;
    try {
      await sourceData.setReadStatus(sourceId, next);
      // Optimistic refresh — the SOURCES_CHANGED broadcast will also
      // fire but the local round trip is faster for the same-window
      // case.
      await load(sourceId);
    } catch (err) {
      console.error('[minerva] setReadStatus failed:', err);
    }
  }

  async function handleSetReadDueBy(next: string | null): Promise<void> {
    if (!detail) return;
    // Normalise empty string from the date input to null so the
    // backend clears the predicate rather than refusing the empty
    // value.
    const value = next && next.trim() ? next.trim() : null;
    try {
      await sourceData.setReadDueBy(sourceId, value);
      await load(sourceId);
    } catch (err) {
      console.error('[minerva] setReadDueBy failed:', err);
    }
  }

  let creatingAbout = $state(false);
  async function handleNewAboutNote(): Promise<void> {
    if (!onCreateAboutNote || creatingAbout) return;
    creatingAbout = true;
    try {
      const newPath = await onCreateAboutNote(sourceId);
      // The host opens the new note; we just refresh the detail view
      // so the new entry shows under Notes when the user navigates
      // back. (If they leave a tab open we may never come back here
      // until they switch; the explicit reload covers the common case.)
      if (newPath) await load(sourceId);
    } finally {
      creatingAbout = false;
    }
  }
</script>

<div class="source-detail" bind:this={scrollerEl}>
  {#if loading}
    <p class="muted">Loading…</p>
  {:else if !detail}
    <div class="missing">
      <h1>Source not found</h1>
      <p class="muted">
        No source with id <code>{sourceId}</code> is in the graph. Make sure
        <code>.minerva/sources/{sourceId}/meta.ttl</code> exists and the graph has been rebuilt.
      </p>
    </div>
  {:else}
    <header class:stub={detail.metadata.stubStatus === 'unresolved'}>
      {#if onInvokeTool && hasSourceTools}
        <div class="tools-menu">
          <button class="tools-btn" onclick={() => (toolMenuOpen = !toolMenuOpen)} aria-haspopup="menu" aria-expanded={toolMenuOpen}>
            Tools <span class="caret"><Icon name="chevronDown" size={11} /></span>
          </button>
          {#if toolMenuOpen}
            <button type="button" class="tools-backdrop" aria-label="Close menu" onclick={() => (toolMenuOpen = false)}></button>
            <div class="tools-dropdown" role="menu">
              {#each sourceToolGroups as group, gi (group.label ?? gi)}
                {#if group.label}<div class="tools-group-label">{group.label}</div>{/if}
                {#each group.tools as tool (tool.id)}
                  <button type="button" class="tools-item" role="menuitem" title={tool.description} onclick={() => invokeTool(tool)}>
                    {tool.name}
                  </button>
                {/each}
              {/each}
            </div>
          {/if}
        </div>
      {/if}
      <div class="subtype">
        {detail.metadata.subtype ?? 'Source'}{#if detail.metadata.stubStatus === 'unresolved'} · STUB{/if}
      </div>
      <h1>{@html renderInlineWithMath(displaySourceTitle(detail.metadata))}</h1>
      {#if detail.metadata.creators.length || detail.metadata.year}
        <div class="byline">{formatByline(detail.metadata.creators, detail.metadata.year)}</div>
      {/if}
      <div class="source-tags">
        {#each detail.metadata.tags as tag (tag)}
          <Chip>
            #{tag}
            <button class="tag-remove" title="Remove tag" onclick={() => handleRemoveTag(tag)}>
              <Icon name="close" size={11} />
            </button>
          </Chip>
        {/each}
        {#if addingTag}
          <input
            class="tag-input"
            list={tagListId}
            bind:value={newTagText}
            use:autofocus
            onkeydown={tagInputKeydown}
            onblur={() => { addingTag = false; newTagText = ''; }}
            placeholder="tag…"
          />
          <datalist id={tagListId}>
            {#each tagVocab as t (t)}
              <option value={t}></option>
            {/each}
          </datalist>
        {:else}
          <button class="add-tag-btn" onclick={startAddTag}><Icon name="plus" size={11} /> tag</button>
        {/if}
      </div>
      {#if detail.metadata.stubStatus === 'unresolved' && onResolveStub}
        <button
          class="resolve-stub-btn"
          disabled={resolving}
          onclick={() => onResolveStub?.(sourceId)}
        >
          {resolving ? 'Resolving…' : 'Resolve to full source'}
        </button>
      {/if}
    </header>

    <section class="metadata">
      {#if detail.metadata.publisher}
        <div class="kv"><span class="k">Publisher</span><span class="v">{detail.metadata.publisher}</span></div>
      {/if}
      {#if detail.metadata.doi}
        {@const doiHref = `https://doi.org/${detail.metadata.doi}`}
        <div class="kv">
          <span class="k">DOI</span>
          <span class="v">
            <a class="external" href={doiHref} onclick={(e) => { e.preventDefault(); openExternal(doiHref); }}>{detail.metadata.doi}</a>
          </span>
        </div>
      {/if}
      {#if detail.metadata.uri}
        {@const uriHref = detail.metadata.uri}
        <div class="kv">
          <span class="k">URL</span>
          <span class="v">
            <a class="external" href={uriHref} onclick={(e) => { e.preventDefault(); openExternal(uriHref); }}>{uriHref}</a>
          </span>
        </div>
      {/if}
      <div class="kv"><span class="k">Source id</span><span class="v mono">{detail.metadata.sourceId}</span></div>
      <div class="kv read-status-row">
        <span class="k">Status</span>
        <span class="v">
          <div class="status-buttons" role="group" aria-label="Reading status">
            {#each READ_STATUS_OPTIONS as opt (opt.value)}
              <button
                class="status-btn"
                class:active={detail.metadata.readStatus === opt.value}
                onclick={() => handleSetReadStatus(
                  detail!.metadata.readStatus === opt.value ? null : opt.value,
                )}
                title={detail.metadata.readStatus === opt.value ? 'Click again to clear' : `Mark as ${opt.label.toLowerCase()}`}
              >
                {opt.label}
              </button>
            {/each}
          </div>
        </span>
      </div>
      <div class="kv read-due-row">
        <span class="k">Due by</span>
        <span class="v">
          <input
            type="date"
            class="due-input"
            aria-label="Due by"
            value={detail.metadata.readDueBy ?? ''}
            onchange={(e) => handleSetReadDueBy((e.target as HTMLInputElement).value)}
          />
          {#if detail.metadata.readDueBy}
            <button class="due-clear" onclick={() => handleSetReadDueBy(null)} title="Clear due date">Clear</button>
          {/if}
        </span>
      </div>
      <div class="actions">
        {#if hasPdf && onOpenPdf}
          <button class="action-btn" onclick={() => onOpenPdf(sourceId)}>Open original PDF</button>
        {/if}
        <button class="action-btn" onclick={handleRename}>Rename source</button>
        <button class="action-btn" onclick={handleDelete}>Delete source</button>
      </div>
    </section>

    {#if detail.metadata.abstract}
      <section class="abstract">
        <div class="sect-head"><Eyebrow>Abstract</Eyebrow></div>
        <p>{@html renderInlineWithMath(detail.metadata.abstract)}</p>
      </section>
    {/if}

    {#if bodyLoaded && (bodyContent !== null || editMode)}
      <section class="body">
        <div class="body-header">
          <Eyebrow>Content</Eyebrow>
          {#if !editMode}
            <button class="body-edit" onclick={enterEditMode}>Edit body</button>
          {/if}
        </div>
        {#if editMode}
          <textarea
            class="body-editor"
            bind:value={draftBody}
            spellcheck="false"
            autocomplete="off"
          ></textarea>
          {#if saveError}
            <div class="save-error">{saveError}</div>
          {/if}
          <div class="body-actions">
            <button class="btn primary" disabled={saving} onclick={saveBody}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button class="btn secondary" disabled={saving} onclick={cancelEdit}>Cancel</button>
          </div>
        {:else if bodyContent !== null}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="body-view"
            bind:this={bodyViewEl}
            oncontextmenu={handleBodyContextMenu}
          >
            <Preview content={bodyContent} onNavigate={onNavigate} {numberedHeadings} />
            {#if detail && detail.excerpts.length > 0}
              <ExcerptDensityGutter
                host={bodyViewEl ?? null}
                scroller={scrollerEl ?? null}
                excerpts={detail.excerpts}
                revision={gutterRevision}
              />
            {/if}
          </div>
          {#if recentExcerpt}
            <div class="excerpt-banner" class:duplicate={recentExcerpt.duplicate}>
              {recentExcerpt.duplicate
                ? 'That passage was already saved as an excerpt.'
                : 'Saved as excerpt'}
              <code>{recentExcerpt.id}</code>
            </div>
          {/if}
          {#if excerptError}
            <div class="save-error">Couldn't save excerpt: {excerptError}</div>
          {/if}
        {/if}
      </section>
    {/if}

    {#if excerptMenu}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        class="excerpt-menu"
        style:left="{excerptMenu.x}px"
        style:top="{excerptMenu.y}px"
        onmousedown={(e) => e.preventDefault()}
      >
        <button disabled={creatingExcerpt} onclick={saveExcerpt}>
          {creatingExcerpt ? 'Saving…' : 'Save as excerpt'}
        </button>
      </div>
    {/if}

    <section>
      <div class="sect-head"><Eyebrow>Excerpts <span class="ct">{detail.excerpts.length}</span></Eyebrow></div>
      {#if detail.excerpts.length === 0}
        <p class="muted">No excerpts linked to this source yet.</p>
      {:else}
        <ul class="excerpt-list">
          {#each detail.excerpts as excerpt}
            <li
              data-excerpt-anchor={excerpt.excerptId}
              class:highlighted={excerpt.excerptId === highlightExcerptId}
            >
              {#if excerpt.citedText}
                <blockquote>{excerpt.citedText}</blockquote>
              {:else}
                <p class="muted">No cited text</p>
              {/if}
              <div class="excerpt-meta">
                <span class="mono">{excerpt.excerptId}</span>
                {#if excerptLocation(excerpt)}
                  <span class="sep">·</span>
                  <span>{excerptLocation(excerpt)}</span>
                {/if}
                <span class="excerpt-actions">
                  {#if onCreateNoteFromExcerpt}
                    <button
                      class="excerpt-action"
                      onclick={() => { void createNoteFromExcerpt(excerpt); }}
                      title="Create a new note seeded with this quote"
                    >New note</button>
                  {/if}
                  {#if onAppendExcerptToCurrent}
                    <button
                      class="excerpt-action"
                      disabled={!canAppendToCurrent}
                      onclick={() => appendExcerptToCurrent(excerpt)}
                      title={canAppendToCurrent ? 'Append this quote to the active note' : 'No active note tab'}
                    >
                      {appendFlashId === excerpt.excerptId ? 'Appended ✓' : 'Append to current'}
                    </button>
                  {/if}
                  {#if onAttachEvidence}
                    <button
                      class="excerpt-action"
                      onclick={() => onAttachEvidence?.(excerpt.excerptId)}
                      title="Attach this excerpt as grounds/supports/rebuts evidence for a claim"
                    >Attach evidence…</button>
                  {/if}
                </span>
              </div>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section>
      <div class="section-header">
        <Eyebrow>Notes <span class="ct">{detail.aboutNotes.length}</span></Eyebrow>
        {#if onCreateAboutNote}
          <button class="section-action" disabled={creatingAbout} onclick={handleNewAboutNote}>
            {creatingAbout ? 'Creating…' : 'New note about this source'}
          </button>
        {/if}
      </div>
      {#if detail.aboutNotes.length === 0}
        <p class="muted">No notes about this source yet.</p>
      {:else}
        <NavList>
          {#each detail.aboutNotes as note (note.relativePath)}
            <SourceLinkRow title={note.title} onClick={() => onNavigate(note.relativePath)}>
              {#snippet meta()}
                <span class="about-path mono">{note.relativePath}</span>
              {/snippet}
            </SourceLinkRow>
          {/each}
        </NavList>
      {/if}
    </section>

    {#if detail.references.length > 0}
      <section>
        <div class="sect-head"><Eyebrow>References <span class="ct">{detail.references.length}</span></Eyebrow></div>
        <NavList>
          {#each detail.references as ref (ref.sourceId)}
            <SourceLinkRow
              title={ref.title}
              onClick={() => onOpenReference?.(ref.sourceId)}
              stub={ref.stubStatus === 'unresolved'}
            >
              {#snippet meta()}
                {#if ref.stubStatus === 'unresolved'}
                  <span class="stub-badge">stub</span>
                {/if}
              {/snippet}
            </SourceLinkRow>
          {/each}
        </NavList>
      </section>
    {/if}

    <section>
      <div class="sect-head"><Eyebrow>Referenced from <span class="ct">{detail.backlinks.length}</span></Eyebrow></div>
      {#if detail.backlinks.length === 0}
        <p class="muted">No notes reference this source.</p>
      {:else}
        <NavList>
          {#each detail.backlinks as b}
            <SourceLinkRow title={b.title} onClick={() => onNavigate(b.relativePath)}>
              {#snippet meta()}
                <span class="backlink-meta">
                  <span class="backlink-kind">{backlinkLabel(b)}</span>
                  {#if b.viaExcerptId}
                    <span class="sep">·</span>
                    <span class="mono">{b.viaExcerptId}</span>
                  {/if}
                </span>
              {/snippet}
            </SourceLinkRow>
          {/each}
        </NavList>
      {/if}
    </section>
  {/if}
</div>

<style>
  .source-detail {
    flex: 1;
    overflow-y: auto;
    padding: 32px 48px;
    max-width: 820px;
    font-size: 15px;
    line-height: 1.6;
    color: var(--text);
  }

  header {
    margin-bottom: 20px;
    position: relative;
  }

  /* Source-scoped tools menu (#103) — top-right of the header. */
  .tools-menu {
    position: absolute;
    top: 0;
    right: 0;
  }
  .tools-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
  }
  .tools-btn:hover { background: var(--bg-button-hover); }
  .tools-btn .caret { display: inline-flex; align-items: center; color: var(--text-muted); }
  .tools-backdrop {
    position: fixed;
    inset: 0;
    z-index: 10;
    border: none;
    background: transparent;
    cursor: default;
  }
  .tools-dropdown {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 11;
    min-width: 200px;
    padding: 4px;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 6px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .tools-group-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    padding: 6px 8px 2px;
  }
  .tools-item {
    text-align: left;
    padding: 6px 8px;
    border: none;
    border-radius: 4px;
    background: none;
    color: var(--text);
    font-size: 13px;
    cursor: pointer;
  }
  .tools-item:hover { background: var(--bg-button); }

  .subtype {
    display: inline-block;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
    background: var(--bg-button);
    padding: 2px 8px;
    border-radius: 3px;
    margin-bottom: 8px;
  }

  h1 {
    font-family: var(--font-display);
    font-size: 30px;
    font-weight: 500;
    letter-spacing: -0.01em;
    margin: 0 0 6px;
  }

  /* Section headings use the shared Eyebrow primitive (#1119). The wrapper
     just restores the vertical rhythm the old <h2> margin provided; the
     count renders in accent. */
  .sect-head {
    margin: 24px 0 12px;
  }
  .ct {
    color: var(--accent);
  }

  .byline {
    font-family: var(--font-display);
    font-style: italic;
    color: var(--text-muted);
    font-size: 15px;
  }

  /* Tag editor (#766) */
  .source-tags {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    margin-top: 8px;
  }
  /* Remove-tag glyph inside the shared Chip (#1119) — an <Icon name="close">
     rather than a bare ×. */
  .tag-remove {
    display: inline-flex;
    align-items: center;
    border: none;
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    line-height: 1;
    padding: 0;
    margin: 0 -2px 0 1px;
  }
  .tag-remove:hover { color: var(--text); }
  .add-tag-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    border: 1px dashed var(--border);
    background: none;
    color: var(--text-muted);
    border-radius: 999px;
    font-size: 12px;
    padding: 2px 9px;
    cursor: pointer;
  }
  .add-tag-btn:hover { color: var(--text); border-color: var(--text-muted); }
  .tag-input {
    border: 1px solid var(--accent);
    background: var(--bg);
    color: var(--text);
    border-radius: 999px;
    font-size: 12px;
    padding: 1px 8px;
    width: 100px;
    font-family: inherit;
  }
  .tag-input:focus { outline: none; }

  section {
    margin-bottom: 12px;
  }

  .metadata {
    border-top: 1px solid var(--border);
    padding-top: 16px;
    margin-top: 16px;
    display: grid;
    grid-template-columns: 120px 1fr;
    gap: 6px 16px;
  }

  .kv { display: contents; }
  .actions {
    grid-column: 1 / -1;
    margin-top: 8px;
    display: flex;
    justify-content: flex-end;
  }
  .action-btn {
    padding: 4px 12px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-button);
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
  }
  .action-btn:hover { background: var(--bg-button-hover); }

  /* Reading-queue status (#116). Segmented buttons; the active one
     picks up the accent rail/tint shared with selected affordances
     elsewhere. Clicking the active button clears the status. */
  .read-status-row .v { display: flex; }
  .status-buttons {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }
  .status-btn {
    padding: 3px 10px;
    background: transparent;
    color: var(--text-muted);
    border: none;
    border-right: 1px solid var(--border);
    font-family: var(--font-sans);
    font-size: 12px;
    cursor: pointer;
  }
  .status-btn:last-child { border-right: none; }
  .status-btn:hover { background: color-mix(in oklch, var(--text) 4%, transparent); color: var(--text); }
  .status-btn.active {
    background: color-mix(in oklch, var(--accent) 14%, transparent);
    color: var(--accent);
    font-weight: 500;
  }

  .read-due-row .v {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .due-input {
    padding: 3px 6px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-sans);
    font-size: 13px;
    font-variant-numeric: tabular-nums;
  }
  .due-input:focus {
    outline: none;
    border-color: var(--accent);
  }
  .due-clear {
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    font-size: 11px;
    cursor: pointer;
  }
  .due-clear:hover {
    color: var(--text);
    border-color: var(--border-strong);
  }
  .k {
    color: var(--text-muted);
    font-size: 13px;
  }
  .v {
    font-size: 14px;
    word-break: break-word;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 13px;
  }

  .external {
    color: var(--accent);
    cursor: pointer;
  }
  .external:hover { text-decoration: underline; }

  .abstract p {
    font-family: var(--font-display);
    font-style: italic;
    font-size: 15px;
    color: var(--text-muted);
    margin: 0;
  }

  .body-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
  }

  .body-edit {
    border: 1px solid var(--border);
    background: var(--bg-button);
    color: var(--text);
    font-size: 11px;
    padding: 3px 10px;
    border-radius: 4px;
    cursor: pointer;
  }
  .body-edit:hover {
    background: var(--bg-button-hover);
  }

  .body-view {
    /* Preview has its own padding; reset it so the body sits flush within
     * the source panel's existing padding. */
    margin-left: -48px;
    margin-right: -48px;
    /* `position: relative` so the density gutter (#102) can absolute-
     *  position its tick marks against the body's full content height. */
    position: relative;
  }
  .body-view :global(.preview) {
    padding: 0 48px;
    overflow-y: visible;
  }

  .body-editor {
    width: 100%;
    min-height: 300px;
    padding: 12px;
    background: var(--bg);
    color: var(--text);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-family: ui-monospace, monospace;
    font-size: 13px;
    line-height: 1.5;
    resize: vertical;
  }
  .body-editor:focus {
    outline: none;
    border-color: var(--accent);
  }

  .body-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }

  .btn {
    padding: 5px 14px;
    font-size: 12px;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn.primary {
    background: var(--accent);
    color: var(--bg);
    border-color: var(--accent);
  }
  .btn.primary:hover:not(:disabled) { opacity: 0.9; }
  .btn.secondary {
    background: var(--bg-button);
    color: var(--text);
  }
  .btn.secondary:hover:not(:disabled) {
    background: var(--bg-button-hover);
  }

  .save-error {
    color: var(--text);
    background: var(--bg-button);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 8px 12px;
    margin-top: 8px;
    font-size: 12px;
  }

  .excerpt-menu {
    position: fixed;
    z-index: 100;
    background: var(--bg-sidebar);
    border: 1px solid var(--border);
    border-radius: 4px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    padding: 4px;
    min-width: 160px;
  }
  .excerpt-menu button {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 12px;
    background: none;
    border: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    border-radius: 3px;
  }
  .excerpt-menu button:hover:not(:disabled) {
    background: var(--bg-button);
  }
  .excerpt-menu button:disabled {
    opacity: 0.5;
    cursor: wait;
  }

  .excerpt-banner {
    margin-top: 8px;
    padding: 6px 10px;
    border-left: 3px solid var(--accent);
    background: var(--bg-button);
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .excerpt-banner.duplicate {
    border-left-color: var(--text-muted);
  }
  .excerpt-banner code {
    font-size: 11px;
    color: var(--text-muted);
    font-family: ui-monospace, monospace;
  }

  .muted {
    color: var(--text-muted);
    font-style: italic;
  }

  .excerpt-list {
    list-style: none;
    padding: 0;
    margin: 0;
  }

  .excerpt-list li {
    border-left: 3px solid var(--border);
    padding: 8px 12px;
    margin: 0 0 12px;
    transition: border-color 0.15s;
  }
  .excerpt-list li.highlighted {
    border-left-color: var(--accent);
    background: var(--bg-button);
  }

  .excerpt-list blockquote {
    margin: 0 0 6px;
    font-style: italic;
    color: var(--text);
  }

  .excerpt-meta {
    font-size: 12px;
    color: var(--text-muted);
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }

  .sep { opacity: 0.5; }

  /* Push the per-excerpt action buttons to the end so the id +
     location stay left-aligned while the actions cluster right. */
  .excerpt-actions {
    margin-left: auto;
    display: inline-flex;
    gap: 4px;
  }
  .excerpt-action {
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    font-family: var(--font-sans);
    font-size: 11.5px;
    cursor: pointer;
  }
  .excerpt-action:hover:not(:disabled) {
    color: var(--text);
    border-color: var(--border-strong);
  }
  .excerpt-action:disabled {
    opacity: 0.45;
    cursor: default;
  }

  .backlink-meta {
    font-size: 12px;
    color: var(--text-muted);
    display: flex;
    gap: 6px;
    align-items: center;
  }

  .backlink-kind {
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.3px;
    font-weight: 600;
  }

  .section-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin: 0 0 8px;
  }
  .section-action {
    font-family: var(--font-sans);
    font-size: 12px;
    color: var(--accent);
    background: none;
    border: 1px solid color-mix(in oklch, var(--accent) 40%, var(--border));
    padding: 3px 10px;
    border-radius: 4px;
    cursor: pointer;
  }
  .section-action:hover:not(:disabled) {
    background: color-mix(in oklch, var(--accent) 10%, transparent);
  }
  .section-action:disabled { cursor: default; opacity: 0.5; }

  .about-path {
    font-size: 11px;
    color: var(--text-faint);
  }

  .stub-badge {
    font-family: var(--font-mono);
    font-size: 9.5px;
    color: var(--text-faint);
    background: var(--bg-button);
    padding: 1px 6px;
    border-radius: 3px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* Stub markers in the source-detail header: italicise the title +
     dim the byline so it reads as "partial record" at a glance. */
  header.stub h1 {
    font-style: italic;
    color: color-mix(in oklch, var(--text) 75%, transparent);
  }
  header.stub .byline { color: var(--text-faint); }
  .resolve-stub-btn {
    margin-top: 10px;
    padding: 5px 14px;
    border: 1px solid var(--accent);
    border-radius: 6px;
    background: var(--accent);
    color: var(--accent-ink);
    font-family: var(--font-sans);
    font-size: 12.5px;
    font-weight: 600;
    cursor: pointer;
  }
  .resolve-stub-btn:hover:not(:disabled) { opacity: 0.92; }
  .resolve-stub-btn:disabled { opacity: 0.55; cursor: default; }

  code {
    background: var(--bg-button);
    padding: 1px 5px;
    border-radius: 3px;
    font-family: var(--font-mono);
    font-size: 13px;
  }

  .missing h1 {
    font-size: 18px;
    margin-bottom: 8px;
  }
</style>
