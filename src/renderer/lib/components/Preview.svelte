<script lang="ts">
    import {onDestroy} from 'svelte';
    import Icon from './Icon.svelte';
    import {installDismissOnClickOutside} from '../dismiss-menu';
    import '../../styles/hljs-minerva.css';
    import '../../styles/preview-content.css';
    import 'katex/dist/katex.min.css';
    import {hydrateMermaidBlocks, invalidateMermaidTheme} from '../markdown/mermaid-renderer';
    import {hydrateVegaBlocks, invalidateVegaTheme} from '../markdown/vega-renderer';
    import {hydrateCardCallouts} from '../markdown/card-callout';
    import {slugify} from '../../../shared/slug';
    import {createPreviewMarkdown} from '../preview/markdown-config';
    import {sanitizeNoteHtml} from '../preview/sanitize-note-html';
    import {api} from '../ipc/client';
    import {clampSubmenu} from '../utils/menuClamp';
    import {type ChartHandle} from '../charts';
    import {getToolInfosByCategory} from '../tools/tool-registry';
    import {planOutputEdit} from '../editor/output-block';
    import {findRunnableFences, codeOf, RUNNABLE_LANGUAGE_SET} from '../../../shared/compute/fences';
    import {runAllCellsInContent} from '../compute/run-all-cells';
    import type {CellResult} from '../ipc/client';
    import {stripFrontmatter, countFrontmatterLines} from '../preview/text';
    import {
        type CiteMeta,
        type QuoteMeta,
        buildCiteTooltip,
        buildQuoteTooltip,
        buildFootnoteTooltip,
        buildNotePreviewTooltip,
        buildNotePreviewMissing
    } from '../preview/cite-meta';
    import { makeNotePreviewFetcher } from '../editor/note-preview';
    import {
        tableToCsv,
        outputToMarkdownClipboard
    } from '../preview/compute-output-render';
    import { applyCslMarkers, resolveCiteQuoteLabels, type CitationRenderDeps } from '../preview/citation-render';
    import { hydrateTypedCards, type TypedCardDeps } from '../preview/typed-link-render';
    import { markBrokenWikiLinks } from '../preview/broken-links';
    import { buildObjectCardHtml } from '../preview/typed-card';
    import { resolveWikiLinkTarget } from '../../../shared/wiki-link-resolver';
    import type { NoteTypedProperties } from '../../../shared/objects/type-def';
    import { executeQueryBlock, type QueryBlockDeps } from '../preview/query-blocks';
    import {
        type HydrateContext,
        highlightCodeBlocks,
        hydrateLocalImages,
        hydrateRemoteImages,
        hydrateYouTubeThumbnails,
        hydrateTransclusions,
        hydrateLocalMedia,
    } from '../preview/hydrate';

    interface Props {
        content: string;
        /**
         * Project-relative path of the note being rendered. Used to
         * resolve relative `![](image.png)` references against the note's
         * directory (#244 image rendering). Null when no file is open or
         * the editor's path isn't surfaced (preview-only contexts).
         */
        notePath?: string | null;
        onNavigate: (target: string) => void;
        /** Broken-link hover quick-fix (#1446): create the missing note the
         *  hovered `[[link]]` points at. Mirrors the editor's hover lightbulb. */
        onCreateNoteFromReference?: (target: string) => void;
        onTagSelect?: (tag: string) => void;
        onOpenSource?: (sourceId: string) => void;
        onOpenExcerpt?: (excerptId: string) => void;
        /** If set, the effect below will scroll the preview to the matching heading / block after render. */
        pendingAnchor?: string | null;
        /** Called when the effect successfully scrolls, so the caller can clear its pending state. */
        onAnchorResolved?: () => void;
        /** Fired when a rendered task-list checkbox is toggled. Line is 0-indexed. */
        onTaskToggle?: (lineIndex: number) => void;
        /**
         * Save-as-note action on a compute-output block (#244). Receives the
         * source fence and payload; the caller prompts for a destination path,
         * invokes `api.compute.saveCellOutput`, and opens the new note.
         */
        onSaveCellOutput?: (payload: {
            cellLanguage: string;
            cellCode: string;
            output: import('../../../shared/compute/types').CellOutput;
            /** Pin to notebook (#244) — see App.handleSaveCellOutput. */
            pin?: boolean;
        }) => void;
        /**
         * Right-click-menu callbacks mirroring the read-only portion of the
         * Editor's context menu (Learning / Analysis / Research-Decompose /
         * Ask About This… / Bookmark / Open In…). The preview pane is
         * read-only by design, so the menu deliberately excludes the
         * Refactor submenu and any mutation-bearing items.
         */
        onToolInvoke?: (toolId: string) => void;
        onOpenConversation?: () => void;
        onBookmark?: () => void;
        /**
         * Run a python / sparql / sql code fence from the
         * preview's inline ▶ button. Same shape as the Editor's `onRunCell`
         * so the host can inject the same trust-gated wrapper for both.
         * The result flows back through `onApplyCellOutputEdit` below as a
         * full-document content replacement — preview never writes to disk
         * directly; the host routes the edit through the editor's state so
         * undo history, autosave, and dirty-tracking stay consistent.
         * Without both callbacks the ▶ button is suppressed.
         */
        onRunCell?: (language: string, code: string, notePath: string) => Promise<CellResult>;
        /**
         * Called after `onRunCell` returns with a new full-document string.
         * The host typically does `editor.setContent(newContent)` so the
         * editor view, autosave, and undo history all see the change as a
         * regular doc edit.
         */
        onApplyCellOutputEdit?: (newContent: string) => void;
        /**
         * Click on a bare-DOI link the DOI plugin rendered (#473).
         * The host decides what to do: open the matching source if it
         * exists, otherwise offer to ingest. Without the callback,
         * DOI links open externally like any other link.
         */
        onDoiClick?: (doi: string) => void;
        /**
         * §-numeral opt-in (#1120). When true, rendered H2s get a
         * decimal-leading-zero "§ 01" section numeral. Driven by the
         * `numberedHeadings` editor setting (Settings → Editor), off by
         * default — only long-form/essay notes want it, so it isn't forced on
         * every journal or list.
         */
        numberedHeadings?: boolean;
        /** Live note-path list + frontmatter aliases, for the wiki-link hover
         *  preview (#1132) — resolves a hovered `[[link]]` to a note to read.
         *  Without them the hover preview is simply inert. */
        getNotePaths?: () => string[];
        getAliases?: () => readonly { alias: string; relativePath: string }[];
        /** Graph revision — bumped on any index change. The live query-block
         *  family (backlinks / semantic, #1137/#1128) re-runs when it changes,
         *  so a block reflects links/embeddings added elsewhere. */
        revision?: number;
    }

    let {
        content,
        notePath = null,
        onNavigate,
        onCreateNoteFromReference,
        onTagSelect,
        onOpenSource,
        onOpenExcerpt,
        pendingAnchor = null,
        onAnchorResolved,
        onTaskToggle,
        onSaveCellOutput,
        onToolInvoke,
        onOpenConversation,
        onBookmark,
        onRunCell,
        onApplyCellOutputEdit,
        onDoiClick,
        numberedHeadings = false,
        getNotePaths,
        getAliases,
        revision = 0,
    }: Props = $props();

    // Wiki-link hover preview (#1132) — reuses the editor's async fetcher +
    // per-path read cache. A monotonic token cancels a stale async result when
    // the pointer has since left or moved to another link.
    const notePreviewFetcher = makeNotePreviewFetcher({
        getNotePaths: () => getNotePaths?.() ?? [],
        getAliases: () => getAliases?.() ?? [],
        readNote: (p) => api.notebase.readFile(p),
    });
    let hoverToken = 0;

    // Per-fence collapse state, keyed by the fence's opening line in the
    // source markdown. Survives doc-edit re-renders (line numbers may
    // shift, but the user toggling collapse means "I'm done with this
    // body for now" — re-expanding when the doc shifts is fine).
    // In-memory only; resets on tab switch / note open.
    const collapsedFences = $state<Set<number>>(new Set());
    // Per-fence running state, same keying. Disables the ▶ button while
    // a cell is in flight so a double-click can't fire two parallel
    // executions.
    const runningFences = $state<Set<number>>(new Set());

    // Tool lists for the right-click menu's Learning / Analysis submenus.
    // Loaded once at mount — the registry is project-stable.
    const analysisTools = getToolInfosByCategory('analysis');
    const learningTools = getToolInfosByCategory('learning');

    // Query result cache: query text → results (survives re-renders)
    const queryCache = new Map<string, { results: unknown[]; error?: string }>();

    // Cite/quote metadata caches: id → resolved bundle (survives re-renders)
    const citeMetaCache = new Map<string, CiteMeta>();
    const quoteMetaCache = new Map<string, QuoteMeta>();
    // Type-keyed card cache (#1071): resolved path → typed properties. Survives
    // re-renders; cleared on `revision` so a save to a linked note refreshes its
    // card. Also read by the wiki-link hover to show a typed card tooltip.
    const typePropsCache = new Map<string, NoteTypedProperties>();

    // Rendered-transclusion cache (perf #1114): `${rel}\u0000${embed}` → the
    // md.render output for that embed's sliced body. Each host re-render rebuilds
    // the whole preview DOM, so without this every `![[embed]]` re-ran a readFile
    // IPC + a full md.render on every keystroke-debounced render. Keyed by the
    // resolved target + embed directive (both project-global, like the other
    // caches), and cleared on `revision` so a save to an embedded note refreshes
    // it (see the effect below). Loop/depth checks still run per pass — only the
    // read+parse of an unchanged body is skipped.
    const transclusionRenderCache = new Map<string, string>();

    const QUERY_PREFIXES = `PREFIX minerva: <https://minerva.dev/ontology#>
PREFIX thought: <https://minerva.dev/ontology/thought#>
PREFIX dc: <http://purl.org/dc/terms/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
PREFIX csvw: <http://www.w3.org/ns/csvw#>
PREFIX prov: <http://www.w3.org/ns/prov#>
`;

    // When rendering a transcluded fragment (#906), relative image paths inside
    // it resolve against the *embedded* note's location, not the host's. md.render
    // is synchronous, so a module-scoped override set just before the fragment
    // render (and cleared after) threads that context into the image rule below.
    let renderPathOverride: string | null = null;

    const md = createPreviewMarkdown({
        collapsedFences,
        runningFences,
        getRenderPathOverride: () => renderPathOverride,
        getNotePath: () => notePath,
        getCanRun: () => !!(onRunCell && onApplyCellOutputEdit && notePath),
    });

    /**
     * Cache of {projectRelPath → data URL} for images referenced from
     * the rendered note. Survives re-renders so panning around a long
     * doc doesn't keep refetching the same `<img>` over and over.
     * Cleared when the active note changes (the path-keyed cache stays
     * project-scoped automatically since paths include the note dir).
     */
    const imageDataUrlCache = new Map<string, string>();

    /** url → data URL of a cached external image; survives re-renders. */
    const remoteImageCache = new Map<string, string>();

    /** id → data URL of a cached YouTube poster; survives re-renders. */
    const youtubeThumbCache = new Map<string, string>();

    /* Blob-URL cache for local audio/video (#908). Unlike images (base64 data
    * URLs), media is held as `blob:` URLs — a 200 MB video can't be base64-inlined.
    * Keyed by rel path so a re-render reuses the same blob; revoked on unmount.
    * (Large-library seeking would want a streaming `app://` protocol — a follow-up.)
    */
    const mediaBlobCache = new Map<string, string>();

    onDestroy(() => {
        for (const url of mediaBlobCache.values()) URL.revokeObjectURL(url);
        mediaBlobCache.clear();
    });

    // Re-rendering markdown + KaTeX + highlight.js + citeproc on every
    // keystroke felt as typing lag in split-view once notes pass a few
    // thousand characters (#335). Debounce: render the first frame
    // synchronously so there's no FOUC, then coalesce subsequent
    // changes to one render per ~120ms idle window.
    function renderContent(c: string): string {
        // DOMPurify pass before the result reaches `{@html rendered}` (#1327 /
        // M2 + #1332 / L4). Single choke point so both the initial seed and the
        // debounced re-render are sanitised; preserves the rich markup (KaTeX,
        // mermaid/vega/query placeholders, wiki-links, task checkboxes) while
        // stripping scripting vectors + remote privacy beacons.
        return sanitizeNoteHtml(renderContentRaw(c));
    }
    function renderContentRaw(c: string): string {
        // Turtle files are indexable + previewable but they aren't
        // markdown — running them through markdown-it turns `@prefix`
        // lines into stray HTML and IRI angle-brackets into wrecked
        // tags. Emit a monospace `<pre>` with the three tightest token
        // classes (directive / IRI / comment); the rest stays plain.
        // hljs doesn't ship a Turtle grammar so we do this inline rather
        // than dragging in a third-party highlighter.
        if (notePath?.toLowerCase().endsWith('.ttl')) {
            return renderTurtle(c);
        }
        const stripped = stripFrontmatter(c);
        const lineOffset = countFrontmatterLines(c);
        return md.render(stripped, {lineOffset});
    }

    // Turtle syntax-highlight patterns (applied in order — see renderTurtle).
    const TTL_COMMENT_RE = /^([ \t]*#.*)$/gm;
    const TTL_DIRECTIVE_RE = /(@(?:prefix|base|keywords)\b)/g;
    const TTL_IRI_RE = /(&lt;[^&\s]*?&gt;)/g;

    function renderTurtle(c: string): string {
        // Escape HTML first so the IRI regex below can match the now-
        // safe `&lt; … &gt;` tokens without risking double-application.
        const escaped = c
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        // Order matters: comments swallow anything to end-of-line, so
        // tag them first; then directives (which never overlap comments
        // because directives don't start with `#`); then IRIs (which
        // can appear inside non-comment lines).
        const highlighted = escaped
            .replace(TTL_COMMENT_RE, '<span class="ttl-comment">$1</span>')
            .replace(TTL_DIRECTIVE_RE, '<span class="ttl-directive">$1</span>')
            .replace(TTL_IRI_RE, '<span class="ttl-iri">$1</span>');
        return `<pre class="ttl-source">${highlighted}</pre>`;
    }

    const RENDER_DEBOUNCE_MS = 120;
    // Intentional initial seed; the $effect below tracks content/notePath
    // reactively and reconciles on change (debounced).
    // svelte-ignore state_referenced_locally
    let rendered = $state(renderContent(content));
    // svelte-ignore state_referenced_locally
    let lastRendered = content;
    // svelte-ignore state_referenced_locally
    let lastRenderedNotePath = notePath;
    let renderTimer: ReturnType<typeof setTimeout> | null = null;

    $effect(() => {
        // Track content + notePath reactively. notePath gates the run
        // button on runnable code fences — without it as a dep, a Preview
        // mounted before `editor.activeFilePath` resolves would render
        // once with notePath=null and never regenerate the ▶ buttons,
        // even after the path arrived. Bail when nothing meaningful
        // changed so derived-state churn doesn't force re-renders.
        const c = content;
        const np = notePath;
        if (c === lastRendered && np === lastRenderedNotePath) return;

        if (renderTimer) clearTimeout(renderTimer);
        renderTimer = setTimeout(() => {
            rendered = renderContent(c);
            lastRendered = c;
            lastRenderedNotePath = np;
            renderTimer = null;
        }, RENDER_DEBOUNCE_MS);

        return () => {
            if (renderTimer) {
                clearTimeout(renderTimer);
                renderTimer = null;
            }
        };
    });
    let previewEl = $state<HTMLDivElement>();
    let activeCharts: ChartHandle[] = [];

    /**
     * Numeric-style preview bibliography (#110). Author-date / note styles
     * carry their context inline and don't need a preview-side
     * accumulation; numeric styles ([1], [2]) are opaque without one.
     * `null` when the current style is non-numeric or there are no
     * citations.
     */
    let cslBibliographyEntries = $state<string[] | null>(null);

    // Dependency bundles handed to the extracted preview renderers (#1087):
    // citation-render (cite/quote enrichment) and query-blocks (query/chart
    // rendering). Built per call so they capture the current previewEl / props;
    // the caches + activeCharts are stable refs the modules read/mutate.
    function citeDeps(): CitationRenderDeps {
        return {
            previewEl,
            citeMetaCache,
            quoteMetaCache,
            queryPrefixes: QUERY_PREFIXES,
            setBibliographyEntries: (v) => { cslBibliographyEntries = v; },
        };
    }
    function queryDeps(): QueryBlockDeps {
        return { notePath, revision, queryCache, queryPrefixes: QUERY_PREFIXES, activeCharts };
    }
    // Type-keyed card pass (#1071): promote block-level typed links to cards.
    // resolvePath reuses the same wiki-link resolution as the hover fetcher.
    function typedCardDeps(): TypedCardDeps {
        // Build the resolver inputs once (mirrors note-preview.ts): paths → files,
        // the alias list → a lowercased map.
        const files = (getNotePaths?.() ?? []).map((relativePath) => ({ relativePath, isDirectory: false }));
        const aliases = Object.fromEntries((getAliases?.() ?? []).map((a) => [a.alias.toLowerCase(), a.relativePath]));
        return {
            previewEl: previewEl ?? null,
            typePropsCache,
            quoteMetaCache,
            queryPrefixes: QUERY_PREFIXES,
            resolvePath: (t) => resolveWikiLinkTarget(t, files, aliases),
        };
    }

    // Context for the extracted post-render hydration passes (#1087). Built once
    // — the caches + `md` are stable refs, and everything that changes over the
    // component's life (previewEl, notePath, content, renderPathOverride) is read
    // through a getter/setter so the closures always see the current value.
    const hydrateCtx: HydrateContext = {
        getPreviewEl: () => previewEl,
        getNotePath: () => notePath,
        getContent: () => content,
        md,
        setRenderPathOverride: (v) => { renderPathOverride = v; },
        imageDataUrlCache,
        remoteImageCache,
        youtubeThumbCache,
        mediaBlobCache,
        transclusionRenderCache,
        citeDeps,
    };

    // Drop cached transclusion bodies whenever the graph changes (perf #1114).
    // `revision` bumps on any note save/index — including an embedded note — so
    // this is exactly when a cached embed body could be stale. Pure host typing
    // doesn't bump revision, so the cache still absorbs keystroke re-renders.
    // Runs before the post-render effect's rAF, so hydrateTransclusions sees the
    // cleared cache.
    $effect(() => {
        revision;
        transclusionRenderCache.clear();
        typePropsCache.clear(); // a linked note's type/props may have changed (#1071)
    });

    // After render, find query-block placeholders and execute queries
    $effect(() => {
        rendered; // track dependency on rendered HTML
        revision; // re-run live blocks (backlinks/semantic) on graph changes (#1137/#1128)

        // Destroy previous chart instances before re-rendering
        activeCharts.forEach(c => c.destroy());
        activeCharts = [];

        requestAnimationFrame(() => {
            // Syntax-highlight fences off the critical render path (#1114).
            highlightCodeBlocks(hydrateCtx);
            // Broken-link squiggle (#1446): mark unresolved note links so the
            // Preview mirrors the editor. Synchronous DOM pass; runs before the
            // async typed-card hydration (which only ever touches resolved links).
            markBrokenWikiLinks(previewEl ?? null, typedCardDeps().resolvePath);
            const blocks = previewEl?.querySelectorAll('.query-block');
            blocks?.forEach((el) => executeQueryBlock(queryDeps(), el as HTMLElement));
            void resolveCiteQuoteLabels(citeDeps());
            // CSL marker pass — runs in parallel with the per-element
            // metadata fetches. Citeproc-rendered markers replace the
            // raw cite/quote display text per the project's CSL style.
            void applyCslMarkers(citeDeps());
            // Image hydration (#244) — same shape as CSL markers: walk the
            // rendered DOM, fetch each `<img class="local-image">` via the
            // binary IPC, swap in a data URL. Cached per-path so re-renders
            // skip the round-trip.
            void hydrateLocalImages(hydrateCtx);
            void hydrateRemoteImages(hydrateCtx);
            void hydrateYouTubeThumbnails(hydrateCtx);
            // Transclusion hydration (#906) — resolve `![[note]]` / `![[note#H]]` /
            // `![[note^block]]` embeds, slicing + re-rendering the target inline.
            void hydrateTransclusions(hydrateCtx);
            void hydrateLocalMedia(hydrateCtx);
            // Type-keyed cards (#1071) — a block-level `[[TypedNote]]` or
            // `[[quote::id]]` becomes a card keyed off its type. Lazy + cached;
            // untyped/inline links are untouched.
            void hydrateTypedCards(typedCardDeps());
            // Mermaid hydration (#467) — lazy-loads the library on first use,
            // replaces .mermaid-block placeholders with rendered SVG, surfaces
            // parse errors inline.
            if (previewEl) void hydrateMermaidBlocks(previewEl);
            // Vega-Lite / Vega chart hydration (#827) — same shape as mermaid:
            // lazy-loads vega-embed, replaces .vega-block placeholders with SVG
            // charts, surfaces parse / security errors inline.
            if (previewEl) void hydrateVegaBlocks(previewEl, content);
            // Flashcard polish: tuck each [!card]'s answer (the part after `---`)
            // behind a collapsed "Show answer" disclosure.
            if (previewEl) hydrateCardCallouts(previewEl);
        });
    });

    /**
     * Re-render mermaid diagrams against the new theme tokens. Called
     * from App.svelte when the user cycles the theme — the existing
     * SVG was generated with the old palette and would otherwise look
     * out of place.
     */
    export function updateTheme(): void {
        invalidateMermaidTheme();
        invalidateVegaTheme();
        if (previewEl) {
            void hydrateMermaidBlocks(previewEl);
            void hydrateVegaBlocks(previewEl, content);
        }
    }

    // After render, if the caller asked us to jump to a heading or block, do it.
    $effect(() => {
        if (!pendingAnchor || !previewEl) return;
        const anchor = pendingAnchor;
        requestAnimationFrame(() => {
            if (!previewEl) return;
            const id = anchor.startsWith('^') ? anchor : slugify(anchor);
            const target = previewEl.querySelector(`[id="${CSS.escape(id)}"]`);
            if (target) {
                target.scrollIntoView({block: 'start', behavior: 'auto'});
                onAnchorResolved?.();
            }
        });
    });

    // Click routing (#993). handleClick walks a [selector, handler] table and
    // dispatches to the first branch whose `.closest(selector)` matches the
    // click target. Each handler receives the matched element + the event and
    // returns true once it has consumed the click (false = "not mine, keep
    // looking" — used by the branches that only conditionally handle). The
    // task-checkbox case tests the target element itself, not an ancestor, so
    // it can't ride the `.closest()` table and runs first as a pre-check.
    type ClickRouteHandler = (matched: HTMLElement, e: MouseEvent) => boolean;
    const clickRoutes: [selector: string, handler: ClickRouteHandler][] = [
        ['.cite-link', handleCiteLinkClick],
        ['.quote-link', handleQuoteLinkClick],
        ['.wiki-link', handleWikiLinkClick],
        ['.transclusion-open', handleTransclusionOpenClick],
        ['.note-tag', handleTagClick],
        ['.compute-output-menu-btn', handleComputeMenuBtnClick],
        ['.compute-output-image', handleOutputImageClick],
        ['[data-fence-action]', handleFenceActionClick],
        ['.youtube-embed', handleYouTubeEmbedClick],
        ['a[href^="https://doi.org/"]', handleDoiAnchorClick],
        ['a[href^="#"]', handleInternalAnchorClick],
    ];

    function handleClick(e: MouseEvent) {
        const el = e.target as HTMLElement;
        // Dismiss any open hover tooltip first. Clicking a wiki-link navigates
        // the preview and replaces the DOM before a `mouseout` can fire on the
        // now-destroyed link, which otherwise leaves the tooltip stuck onscreen
        // over the newly-loaded note. A click means "acting, not hovering".
        dismissTooltip();
        if (handleTaskCheckboxClick(el)) return;
        for (const [selector, handler] of clickRoutes) {
            const matched = el.closest<HTMLElement>(selector);
            if (matched && handler(matched, e)) return;
        }
    }

    function handleTaskCheckboxClick(el: HTMLElement): boolean {
        if (
            !(el instanceof HTMLInputElement) ||
            el.type !== 'checkbox' ||
            el.dataset.taskLine === undefined
        ) {
            return false;
        }
        const line = parseInt(el.dataset.taskLine, 10);
        if (!Number.isNaN(line)) onTaskToggle?.(line);
        // Don't preventDefault — the native toggle gives an instant flicker-free
        // response. The content re-render will land the DOM in the same state.
        return true;
    }

    function handleCiteLinkClick(citeLink: HTMLElement, e: MouseEvent): boolean {
        e.preventDefault();
        const sourceId = citeLink.dataset.sourceId;
        if (sourceId && onOpenSource) onOpenSource(sourceId);
        return true;
    }

    function handleQuoteLinkClick(quoteLink: HTMLElement, e: MouseEvent): boolean {
        e.preventDefault();
        const excerptId = quoteLink.dataset.excerptId;
        if (excerptId && onOpenExcerpt) onOpenExcerpt(excerptId);
        return true;
    }

    function handleWikiLinkClick(wikiLink: HTMLElement, e: MouseEvent): boolean {
        e.preventDefault();
        const linkTarget = wikiLink.dataset.target;
        if (linkTarget) onNavigate(linkTarget);
        return true;
    }

    // Transclusion header → open the embedded note (#906).
    function handleTransclusionOpenClick(transclusionOpen: HTMLElement, e: MouseEvent): boolean {
        e.preventDefault();
        const t = transclusionOpen.dataset.target;
        if (t) onNavigate(t);
        return true;
    }

    function handleTagClick(tagEl: HTMLElement, e: MouseEvent): boolean {
        e.preventDefault();
        const tag = tagEl.dataset.tag;
        if (tag && onTagSelect) onTagSelect(tag);
        return true;
    }

    // Compute-output overflow menu (#244).
    function handleComputeMenuBtnClick(menuBtn: HTMLElement, e: MouseEvent): boolean {
        e.preventDefault();
        e.stopPropagation();
        const wrap = menuBtn.closest<HTMLElement>('.compute-output-wrap');
        if (!wrap) return true;
        openOutputMenu(menuBtn, wrap);
        return true;
    }

    // Click-to-zoom on inline compute output images (#243). Toggles a `.zoomed`
    // class so the stylesheet flips between thumbnail and full-size views
    // without a modal dialog. Not an image element → fall through to the next
    // route (matches the original guard).
    function handleOutputImageClick(outputImg: HTMLElement, e: MouseEvent): boolean {
        if (!(outputImg instanceof HTMLImageElement)) return false;
        e.preventDefault();
        outputImg.classList.toggle('zoomed');
        return true;
    }

    // Fence toolbar — collapse toggle + run button.
    function handleFenceActionClick(fenceBtn: HTMLElement, e: MouseEvent): boolean {
        e.preventDefault();
        e.stopPropagation();
        const action = fenceBtn.getAttribute('data-fence-action');
        const block = fenceBtn.closest<HTMLElement>('.fence-block');
        const lineAttr = block?.getAttribute('data-fence-line');
        const openingLine = lineAttr ? parseInt(lineAttr, 10) : NaN;
        if (!block || Number.isNaN(openingLine)) return true;
        if (action === 'collapse') {
            // Pure UI toggle — flip the class on the live DOM instead of
            // forcing a markdown re-render. The collapsedFences set stays
            // in sync so the next real re-render (e.g. after an edit)
            // honors the current state.
            if (collapsedFences.has(openingLine)) {
                collapsedFences.delete(openingLine);
                block.classList.remove('fence-collapsed');
            } else {
                collapsedFences.add(openingLine);
                block.classList.add('fence-collapsed');
            }
            const tBtn = block.querySelector<HTMLElement>('.fence-collapse-btn');
            if (tBtn) tBtn.textContent = collapsedFences.has(openingLine) ? '▸' : '▾';
            return true;
        }
        if (action === 'run') {
            void runFenceAt(openingLine);
            return true;
        }
        if (action === 'refresh-vega') {
            // Re-resolve a data-bound chart (#832): drop its rendered state and
            // re-hydrate, which re-runs the query against the current graph.
            const vegaBlock = block.querySelector<HTMLElement>('.vega-block');
            if (vegaBlock) {
                vegaBlock.removeAttribute('data-vega-rendered');
                vegaBlock.innerHTML = '';
                if (previewEl) void hydrateVegaBlocks(previewEl, content);
            }
            return true;
        }
        return true;
    }

    // YouTube poster card (#904) — open the video in the real browser rather
    // than navigating the renderer. `data-youtube-url` is a normalized
    // youtube.com watch URL; openExternal's main-process handler re-validates
    // it's http(s) before handing off to the OS.
    function handleYouTubeEmbedClick(ytEmbed: HTMLElement, e: MouseEvent): boolean {
        e.preventDefault();
        const url = ytEmbed.getAttribute('data-youtube-url');
        if (url) void api.shell.openExternal(url);
        return true;
    }

    // DOI link click — the doi-plugin auto-linker rendered this. The host
    // decides between "open existing source" and "offer to ingest" based on
    // whether the DOI matches a known source. (#473) Without an onDoiClick
    // handler, leave the click alone (fall through to the next route).
    function handleDoiAnchorClick(doiAnchor: HTMLElement, e: MouseEvent): boolean {
        if (!onDoiClick) return false;
        e.preventDefault();
        const href = doiAnchor.getAttribute('href') ?? '';
        const doi = href.replace(/^https:\/\/doi\.org\//, '');
        if (doi) onDoiClick(doi);
        return true;
    }

    // Internal anchor click (footnote ref ↔ body, heading anchor jumps,
    // etc.). The browser's native handling would scroll instantly and
    // also tack `#fn1` onto the URL hash — neither great for an
    // Electron renderer where the URL is `file:` or `chrome-error:`.
    // Intercept, smooth-scroll the matching id into view, no hash
    // mutation.
    function handleInternalAnchorClick(anchorEl: HTMLElement, e: MouseEvent): boolean {
        const href = anchorEl.getAttribute('href') ?? '';
        const id = href.slice(1);
        if (id) {
            const target = previewEl?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
            if (target) {
                e.preventDefault();
                target.scrollIntoView({behavior: 'smooth', block: 'center'});
                // Brief highlight so the user's eye locks onto the landing
                // spot — especially useful for footnote bodies that may be
                // visually adjacent to their neighbors.
                target.classList.add('anchor-landing');
                setTimeout(() => target.classList.remove('anchor-landing'), 1200);
            }
        }
        return true;
    }

    // ── Run-fence-from-preview handler ─────────────────────────────────────────
    //
    // Click on a ▶ run button on a python/sparql/sql code fence. We
    // locate the fence by its opening-line number in the source
    // markdown (markdown-it stamped it onto the fence-block wrapper),
    // call the host's `onRunCell` (same trust-gated wrapper the editor
    // uses), splice the resulting output fence block into
    // the doc via the shared `planOutputEdit` helper, and hand the new
    // full content back through `onApplyCellOutputEdit`. The host
    // routes it through the editor's `setContent` so the edit shows up
    // in undo history, autosave, and the dirty-state indicator just
    // like a typed change.
    //
    // The whole pipeline lives in the editor side too — sharing
    // `findRunnableFences` / `codeOf` / `planOutputEdit` from
    // `editor/output-block.ts` means a run from preview and a run from
    // the editor gutter produce bit-identical doc edits.
    async function runFenceAt(openingLine: number): Promise<void> {
        if (!onRunCell || !onApplyCellOutputEdit || !notePath) return;
        if (runningFences.has(openingLine)) return;
        // Locate the fence in the live content. We could trust the line
        // number from markdown-it, but the doc may have been edited since
        // last render — re-scanning is cheap and rules out stale-token
        // bugs.
        const fences = findRunnableFences(content, RUNNABLE_LANGUAGE_SET);
        const fence = fences.find((f) => f.openingLine === openingLine);
        if (!fence) {
            console.warn(`[preview] runFenceAt: no fence at line ${openingLine}`);
            return;
        }
        const code = codeOf(content, fence);
        runningFences.add(openingLine);
        try {
            const result = await onRunCell(fence.language, code, notePath);
            const edit = planOutputEdit(content, fence, result);
            const newContent = content.slice(0, edit.from) + edit.insert + content.slice(edit.to);
            onApplyCellOutputEdit(newContent);
        } catch (e) {
            console.warn('[preview] runFenceAt failed:', e);
        } finally {
            runningFences.delete(openingLine);
        }
    }

    /**
     * Re-run every runnable fence in the note, top to bottom — the
     * preview-mode counterpart to the editor's Run-all, so the toolbar
     * button works when no editor is mounted. The sequential/stop-on-error
     * loop lives in `runAllCellsInContent`; here we just wire it to the
     * host's run + apply callbacks and the per-cell running indicator.
     */
    export async function runAllCells(): Promise<void> {
        if (!onRunCell || !onApplyCellOutputEdit || !notePath) return;
        const runCell = onRunCell;
        const apply = onApplyCellOutputEdit;
        const np = notePath;
        await runAllCellsInContent(content, RUNNABLE_LANGUAGE_SET, {
            runCell: (language, code) => runCell(language, code, np),
            apply,
            setRunning: (line, running) => {
                if (running) runningFences.add(line);
                else runningFences.delete(line);
            },
        });
    }

    // ── Note context menu (read-only mirror of Editor's right-click menu) ──────
    //
    // Same Learning / Analysis / Research-Decompose / Ask About This… /
    // Bookmark / Open In… items the Editor exposes, minus the Refactor
    // submenu and the cut/copy/paste/insert-link block that only makes
    // sense over a CodeMirror selection. The Find-Supporting/Opposing
    // items inside Research are intentionally omitted because they need
    // a claim URI under the right-click position — the preview's HTML
    // doesn't surface raw claim URIs the way the source view does, so
    // we'd need DOM-level extraction. Decompose-into-Claims operates on
    // the whole note, so it stays.

    let noteMenu = $state<{ x: number; y: number } | null>(null);

    function handlePreviewContextMenu(e: MouseEvent) {
        // Don't fire over the compute-output overflow menu's own ⋯ button,
        // or over the compute-output-menu popup itself. Both have their
        // own affordances and the page-wide menu would clash visually.
        const target = e.target as HTMLElement | null;
        if (target?.closest('.compute-output-menu-btn')) return;
        if (target?.closest('.compute-output-menu')) return;
        // Suppress when nothing actionable would land — no callbacks
        // wired means the host doesn't want this menu (preview-only
        // contexts like the SourceDetail preview).
        if (!onToolInvoke && !onOpenConversation && !onBookmark && !notePath) return;
        e.preventDefault();
        noteMenu = {x: e.clientX, y: e.clientY};
        installDismissOnClickOutside(() => { noteMenu = null; }, '.note-context-menu');
    }

    function runMenuAction(fn: (() => void) | undefined): void {
        if (fn) fn();
        noteMenu = null;
    }

    function adjustNoteSubmenu(event: MouseEvent): void {
        clampSubmenu(event.currentTarget as HTMLElement);
    }

    // ── Compute-output overflow menu state (#244) ──────────────────────────────

    let outputMenu = $state<{
        x: number;
        y: number;
        source: { language: string; code: string };
        output: import('../../../shared/compute/types').CellOutput;
    } | null>(null);

    function openOutputMenu(btn: HTMLElement, wrap: HTMLElement): void {
        try {
            const outputB64 = wrap.dataset.outputB64 ?? '';
            const codeB64 = wrap.dataset.sourceCodeB64 ?? '';
            const language = wrap.dataset.sourceLanguage ?? '';
            if (!outputB64 || !codeB64 || !language) return;
            const output = JSON.parse(decodeURIComponent(escape(atob(outputB64))));
            const code = decodeURIComponent(escape(atob(codeB64)));
            const rect = btn.getBoundingClientRect();
            outputMenu = {
                x: rect.left,
                y: rect.bottom + 2,
                source: {language, code},
                output,
            };
            installDismissOnClickOutside(() => { outputMenu = null; }, '.compute-output-menu');
        } catch {
            outputMenu = null;
        }
    }

    function handleSaveAsNote(): void {
        if (!outputMenu || !onSaveCellOutput) return;
        // $state wraps the parsed output in a reactive proxy; Electron's
        // structured-clone bridge rejects proxies with "An object could not
        // be cloned", so unwrap before handing it over.
        onSaveCellOutput({
            cellLanguage: outputMenu.source.language,
            cellCode: outputMenu.source.code,
            output: $state.snapshot(outputMenu.output),
        });
        outputMenu = null;
    }

    function handlePinToNotebook(): void {
        if (!outputMenu || !onSaveCellOutput) return;
        // Pin path skips the destination prompt — the App-side handler
        // routes to whatever derived note already exists for this cell
        // (or creates a default-path note on first pin). Subsequent
        // saves of the same cell reuse the pinned destination.
        onSaveCellOutput({
            cellLanguage: outputMenu.source.language,
            cellCode: outputMenu.source.code,
            output: $state.snapshot(outputMenu.output),
            pin: true,
        });
        outputMenu = null;
    }

    function handleCopyAsMarkdown(): void {
        if (!outputMenu) return;
        // Render the output as markdown-table / code-block, matching the
        // derived-note builder's body format so a user-pasted block looks the
        // same as a "Save as note" output.
        const md = outputToMarkdownClipboard(outputMenu.output);
        void navigator.clipboard.writeText(md);
        outputMenu = null;
    }

    function handleCopyAsCsv(): void {
        if (!outputMenu || outputMenu.output.type !== 'table') return;
        const csv = tableToCsv(outputMenu.output.columns, outputMenu.output.rows);
        void navigator.clipboard.writeText(csv);
        outputMenu = null;
    }

    let tooltipVisible = $state(false);
    let tooltipHtml = $state('');
    let tooltipStyle = $state('');
    // When the hovered link is broken (and a create handler is wired), the raw
    // target to offer "Create Note From Reference" for (#1446). Non-null turns
    // the tooltip interactive (see `.has-fix`).
    let tooltipFixTarget = $state<string | null>(null);
    let tooltipEl = $state<HTMLDivElement>();
    // Grace timer for the interactive (broken-link) tooltip: leaving the link
    // schedules a dismiss that entering the tooltip cancels, so the cursor can
    // cross the gap to click Create-Note. Plain tooltips dismiss immediately.
    let tooltipDismissTimer: ReturnType<typeof setTimeout> | null = null;
    function cancelScheduledDismiss() {
        if (tooltipDismissTimer !== null) { clearTimeout(tooltipDismissTimer); tooltipDismissTimer = null; }
    }

    function handleMouseOver(e: MouseEvent) {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        // Footnote-ref hover: markdown-it-footnote emits
        // `<sup class="footnote-ref"><a href="#fn1">…</a></sup>` for each
        // reference and the matching body sits at `#fn1` near the bottom
        // of the rendered DOM. Pull the body text out (minus the trailing
        // backref arrow) and show it in the same tooltip surface used for
        // cite/quote hovers. Mirrors the editor's `footnotePreview` hover
        // tooltip for parity between panes.
        const footnoteRef = target.closest<HTMLAnchorElement>('.footnote-ref a[href^="#fn"]');
        if (footnoteRef) {
            const href = footnoteRef.getAttribute('href') ?? '';
            const id = href.slice(1);
            const body = previewEl?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
            if (body) {
                tooltipHtml = buildFootnoteTooltip(body);
                tooltipFixTarget = null;
                tooltipVisible = true;
                positionTooltip(footnoteRef);
            }
            return;
        }
        // Wiki-link hover (#1132): unlike cite/quote (whose metadata is on the
        // element), a note's content is in another file — resolve + cached-read
        // + snippet, then fill. Async, so guard against the pointer having moved
        // on before the read resolves.
        const wiki = target.closest<HTMLElement>('.wiki-link');
        if (wiki) {
            const linkTarget = wiki.dataset.target;
            if (!linkTarget || !getNotePaths) return;
            const token = ++hoverToken;
            void notePreviewFetcher(linkTarget).then(async (preview) => {
                if (token !== hoverToken) return; // superseded by another hover / mouseout
                if (!preview) {
                    tooltipHtml = buildNotePreviewMissing(linkTarget);
                    // Offer the create-note fix on a broken link (#1446). The
                    // anchor is dropped — the fix creates the note, not a heading.
                    tooltipFixTarget = onCreateNoteFromReference ? linkTarget : null;
                    tooltipVisible = true;
                    positionTooltip(wiki);
                    return;
                }
                // A typed note shows its card (#1071); an untyped one keeps the
                // title+snippet preview. Reuses the card pass's per-path cache.
                const rb = typePropsCache.get(preview.path) ?? await api.types.noteProperties(preview.path);
                typePropsCache.set(preview.path, rb);
                if (token !== hoverToken) return;
                tooltipHtml = rb.type
                    ? `<div class="object-card oc-tooltip">${buildObjectCardHtml(rb, { title: preview.title })}</div>`
                    : buildNotePreviewTooltip(preview.title, preview.snippet);
                tooltipFixTarget = null;
                tooltipVisible = true;
                positionTooltip(wiki);
            }).catch(() => {
                if (token === hoverToken) tooltipVisible = false;
            });
            return;
        }
        const el = target.closest<HTMLElement>('.cite-link, .quote-link');
        if (!el) return;
        const kind = el.dataset.tooltipKind;
        const payload = el.dataset.tooltipPayload;
        if (!kind || !payload) return;
        try {
            const meta = JSON.parse(payload);
            tooltipHtml = kind === 'cite' ? buildCiteTooltip(meta) : buildQuoteTooltip(meta);
        } catch {
            return;
        }
        tooltipFixTarget = null;
        tooltipVisible = true;
        positionTooltip(el);
    }

    function handleMouseOut(e: MouseEvent) {
        const target = e.target as HTMLElement | null;
        const leaving = target?.closest<HTMLElement>('.cite-link, .quote-link, .footnote-ref, .wiki-link');
        if (!leaving) return;
        // relatedTarget can be null when cursor leaves the window — dismiss anyway
        const to = e.relatedTarget as Node | null;
        if (to && leaving.contains(to)) return;
        // Moving onto an interactive (broken-link) tooltip keeps it open so its
        // Create-Note button is clickable; the tooltip's own mouseleave dismisses.
        if (to && tooltipEl?.contains(to)) return;
        // For that interactive tooltip, delay the dismiss so the cursor can cross
        // the gap between the link and the tooltip (mouseenter cancels it).
        if (tooltipFixTarget !== null) {
            cancelScheduledDismiss();
            tooltipDismissTimer = setTimeout(() => { tooltipDismissTimer = null; dismissTooltip(); }, 180);
            return;
        }
        dismissTooltip();
    }

    /** Apply the broken-link hover fix — create the missing note, then dismiss. */
    function applyTooltipFix() {
        const t = tooltipFixTarget;
        dismissTooltip();
        if (t) onCreateNoteFromReference?.(t);
    }

    /** Hide the hover tooltip and cancel any in-flight wiki-link fetch (#1132)
     *  so a late-resolving read can't re-show it. */
    function dismissTooltip() {
        cancelScheduledDismiss();
        hoverToken++;
        tooltipVisible = false;
        tooltipFixTarget = null;
    }

    function positionTooltip(anchor: HTMLElement) {
        if (!previewEl) return;
        const anchorRect = anchor.getBoundingClientRect();
        const containerRect = previewEl.getBoundingClientRect();
        // Position relative to the preview container so scrolling the preview
        // body moves the tooltip with it.
        const top = anchorRect.bottom - containerRect.top + previewEl.scrollTop + 6;
        const left = Math.max(8, anchorRect.left - containerRect.left);
        const maxLeft = containerRect.width - 360 - 8;
        tooltipStyle = `top:${top}px;left:${Math.min(left, Math.max(8, maxLeft))}px`;
    }

</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_mouse_events_have_key_events -->
<div
        class="preview"
        class:numbered={numberedHeadings}
        bind:this={previewEl}
        onclick={handleClick}
        oncontextmenu={handlePreviewContextMenu}
        onmouseover={handleMouseOver}
        onmouseout={handleMouseOut}
>
    {@html rendered}
    {#if cslBibliographyEntries && cslBibliographyEntries.length > 0}
        <aside class="csl-numeric-bibliography" aria-label="References">
            <h2>References</h2>
            {#each cslBibliographyEntries as entry, i (i)}
                <!-- citeproc HTML from project-controlled meta.ttl — sanitised as defence-in-depth (#1327) -->
                <div class="csl-bibliography-entry">{@html sanitizeNoteHtml(entry)}</div>
            {/each}
        </aside>
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
            class="cite-tooltip"
            class:visible={tooltipVisible}
            class:has-fix={tooltipFixTarget !== null}
            style={tooltipStyle}
            aria-hidden="true"
            bind:this={tooltipEl}
            onmouseenter={cancelScheduledDismiss}
            onmouseleave={dismissTooltip}
    >
        {@html sanitizeNoteHtml(tooltipHtml)}
        {#if tooltipFixTarget !== null}
            <button class="tooltip-fix" onclick={applyTooltipFix}>
                <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 13h4M6.5 15h3"/><path d="M8 1a5 5 0 0 0-3 9c.5.4.8 1 .8 1.6h4.4c0-.6.3-1.2.8-1.6A5 5 0 0 0 8 1z"/></svg>
                <span>Create Note From Reference</span>
            </button>
        {/if}
    </div>
</div>

{#if outputMenu}
    <div class="compute-output-menu" role="menu" style:left="{outputMenu.x}px" style:top="{outputMenu.y}px">
        {#if onSaveCellOutput}
            <button role="menuitem" onclick={handleSaveAsNote}>Save as note…</button>
            <button role="menuitem" onclick={handlePinToNotebook}>Pin to notebook</button>
        {/if}
        <button role="menuitem" onclick={handleCopyAsMarkdown}>Copy as markdown</button>
        {#if outputMenu.output.type === 'table'}
            <button role="menuitem" onclick={handleCopyAsCsv}>Copy as CSV</button>
        {/if}
    </div>
{/if}

{#if noteMenu}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
            class="note-context-menu"
            style:left="{noteMenu.x}px"
            style:top="{noteMenu.y}px"
            onmousedown={(e) => e.preventDefault()}
    >
        {#if onToolInvoke && learningTools.length > 0}
            <div class="submenu-item" onmouseenter={adjustNoteSubmenu}>
                <span class="submenu-trigger">Learning<Icon name="chevronRight" size={10}/></span>
                <div class="submenu">
                    {#each learningTools as tool}
                        <button onclick={() => runMenuAction(() => onToolInvoke?.(tool.id))}>{tool.name}</button>
                    {/each}
                </div>
            </div>
        {/if}
        {#if onToolInvoke && analysisTools.length > 0}
            <div class="submenu-item" onmouseenter={adjustNoteSubmenu}>
                <span class="submenu-trigger">Analysis<Icon name="chevronRight" size={10}/></span>
                <div class="submenu">
                    {#each analysisTools as tool}
                        <button onclick={() => runMenuAction(() => onToolInvoke?.(tool.id))}>{tool.name}</button>
                    {/each}
                </div>
            </div>
        {/if}
        {#if onToolInvoke}
            <div class="submenu-item" onmouseenter={adjustNoteSubmenu}>
                <span class="submenu-trigger">Research<Icon name="chevronRight" size={10}/></span>
                <div class="submenu">
                    <button onclick={() => runMenuAction(() => onToolInvoke?.('research.decompose-into-claims'))}>
                        Decompose into Claims
                    </button>
                </div>
            </div>
        {/if}
        {#if onOpenConversation || onBookmark}
            <div class="separator"></div>
        {/if}
        {#if onOpenConversation}
            <button onclick={() => runMenuAction(onOpenConversation)}>Ask About This...</button>
        {/if}
        {#if onBookmark}
            <button onclick={() => runMenuAction(onBookmark)}>Bookmark This Note</button>
        {/if}
        {#if notePath}
            <div class="separator"></div>
            <div class="submenu-item" onmouseenter={adjustNoteSubmenu}>
                <span class="submenu-trigger">Open In<Icon name="chevronRight" size={10}/></span>
                <div class="submenu">
                    <button onclick={() => { if (notePath) void api.shell.revealFile(notePath); noteMenu = null; }}>
                        Reveal in Finder
                    </button>
                    <button onclick={() => { if (notePath) void api.shell.openInDefault(notePath); noteMenu = null; }}>
                        Open in Default App
                    </button>
                    <button onclick={() => { if (notePath) void api.shell.openInTerminal(notePath); noteMenu = null; }}>
                        Open in Terminal
                    </button>
                </div>
            </div>
        {/if}
    </div>
{/if}

<style>
    .preview {
        flex: 1;
        padding: 24px 48px;
        overflow-y: auto;
        font-size: 15px;
        line-height: 1.7;
        color: var(--text);
        max-width: 800px;
        font-family: var(--content-font-family, inherit);
        position: relative;
    }

    .cite-tooltip {
        position: absolute;
        z-index: 10;
        max-width: 360px;
        min-width: 180px;
        padding: 10px 12px;
        background: var(--bg-button);
        color: var(--text);
        border: 1px solid var(--border);
        border-radius: 6px;
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
        font-size: 13px;
        line-height: 1.45;
        pointer-events: none;
        opacity: 0;
        visibility: hidden;
        transition: opacity 0.08s ease-out;
    }

    .cite-tooltip.visible {
        opacity: 1;
        visibility: visible;
    }

    /* Broken-link tooltip is interactive so its Create-Note button is clickable
       (the plain preview tooltip stays pointer-events:none). (#1446) */
    .cite-tooltip.has-fix {
        pointer-events: auto;
    }
    .tooltip-fix {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        margin-top: 8px;
        padding: 3px 8px;
        border: 1px solid var(--border);
        border-radius: 5px;
        background: var(--bg-elev);
        color: var(--text);
        font-size: 11px;
        font-family: var(--font-sans);
        cursor: pointer;
    }
    .tooltip-fix:hover { border-color: var(--rust); }
    .tooltip-fix svg { color: var(--rust); flex-shrink: 0; }

    .cite-tooltip :global(.tt-title) {
        font-weight: 600;
        margin-bottom: 2px;
    }

    .cite-tooltip :global(.tt-byline) {
        color: var(--text-muted);
        font-size: 12px;
        margin-bottom: 4px;
    }

    .cite-tooltip :global(.tt-meta) {
        font-size: 12px;
        color: var(--text-muted);
        font-family: var(--font-mono);
    }

    /* Wiki-link hover preview (#1132) — the target note's opening snippet. */
    .cite-tooltip :global(.tt-note-body) {
        color: var(--text-muted);
        font-size: 12px;
        white-space: pre-wrap;
        word-break: break-word;
        max-height: 12em;
        overflow: hidden;
    }
    .cite-tooltip :global(.tt-note-missing) {
        color: var(--text-muted);
        font-style: italic;
        font-size: 12px;
    }

    .cite-tooltip :global(.tt-quote) {
        font-style: italic;
        color: var(--text);
        white-space: pre-wrap;
        margin-bottom: 6px;
    }

    /* Footnote body in the hover tooltip. The cloned `<li>` content
       contains arbitrary inline markdown (`<em>`, `<code>`, `<a>`, …);
       scope it tight so it inherits the tooltip's compact type scale. */
    .cite-tooltip :global(.tt-footnote) {
        color: var(--text);
        font-size: 12px;
        line-height: 1.45;
    }

    .cite-tooltip :global(.tt-footnote p) {
        margin: 0;
    }

    .cite-tooltip :global(.tt-footnote p + p) {
        margin-top: 0.4em;
    }

    .cite-tooltip :global(.tt-footnote code) {
        font-family: var(--font-mono, monospace);
        font-size: 11px;
        background: var(--bg);
        padding: 0 3px;
        border-radius: 2px;
    }

    .cite-tooltip :global(.tt-footnote a) {
        color: var(--accent);
        text-decoration: underline;
    }

    /* Heading scale per IMPLEMENTATION.md §8.1. H1/H2/H3 in the display
       serif. The § numeral eyebrow (rendered via a CSS counter) is opt-in
       (#1120): only `.preview.numbered` — added when the `numberedHeadings`
       editor setting is on — resets/increments the counter and shows the
       "§ 01" prefix. The serif H2 itself stays unconditional. */
    .preview.numbered {
        counter-reset: h2;
    }
    :global(.cite-tooltip .object-card.oc-tooltip) { margin: 0; border: none; background: transparent; padding: 0; }
    :global(.object-card .oc-cover) {
        flex-shrink: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 52px;
        height: 68px;
        border-radius: 5px;
        overflow: hidden;
        background: color-mix(in oklch, var(--text) 6%, transparent);
    }
    :global(.object-card .oc-cover img) { width: 100%; height: 100%; object-fit: cover; }
    :global(.object-card .oc-cover-icon) { font-size: 26px; opacity: 0.65; }
    :global(.object-card .oc-main) { display: flex; flex-direction: column; gap: 5px; min-width: 0; }
    :global(.object-card .oc-title) { font-weight: 600; font-size: 0.95em; display: flex; align-items: center; gap: 5px; }
    :global(.object-card .oc-type-icon) { font-size: 0.9em; opacity: 0.8; }
    :global(.object-card .oc-fields) { display: flex; flex-wrap: wrap; gap: 4px 10px; }
    :global(.object-card .oc-field) { display: inline-flex; gap: 5px; font-size: 0.82em; }
    :global(.object-card .oc-flabel) { color: var(--text-faint); }
    :global(.object-card .oc-fval) { color: var(--text-muted); }
    :global(.quote-link.excerpt-card) { flex-direction: column; gap: 5px; color: var(--text); }
    :global(.excerpt-card .ec-quote) { font-style: italic; line-height: 1.4; }
    :global(.excerpt-card .ec-meta) { font-size: 0.82em; color: var(--text-faint); }

    .compute-output-menu {
        position: fixed;
        z-index: 1000;
        background: var(--bg-sidebar);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 4px 0;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        min-width: 160px;
        display: flex;
        flex-direction: column;
    }

    .compute-output-menu button {
        display: block;
        width: 100%;
        padding: 6px 12px;
        border: none;
        background: none;
        color: var(--text);
        font-size: 12px;
        cursor: pointer;
        text-align: left;
    }

    .compute-output-menu button:hover {
        background: var(--bg-button);
    }

    /* Numeric-style preview bibliography (#110). */
    .csl-numeric-bibliography {
        margin-top: 24px;
        padding-top: 16px;
        border-top: 1px solid var(--border);
    }

    .csl-numeric-bibliography h2 {
        font-size: 14px;
        margin: 0 0 8px 0;
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.5px;
    }

    .csl-bibliography-entry {
        font-size: 13px;
        line-height: 1.5;
        margin-bottom: 6px;
        padding-left: 1.5em;
        text-indent: -1.5em;
    }

    .csl-bibliography-entry :global(.csl-entry) {
        /* citeproc emits its own div wrapper; let it inherit our entry styles. */
        display: inline;
    }

    @keyframes anchor-landing-pulse {
        0% {
            background: var(--accent);
            color: var(--bg);
        }
        100% {
            background: transparent;
            color: inherit;
        }
    }

    /* Note-wide right-click menu. Mirrors `.context-menu` from
       Editor.svelte but namespaced under `.note-context-menu` so the
       two never collide if both panes are open in split view. */
    .note-context-menu {
        position: fixed;
        z-index: 1000;
        background: var(--bg-sidebar);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 4px 0;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        min-width: 160px;
    }

    .note-context-menu button {
        display: block;
        width: 100%;
        padding: 6px 12px;
        border: none;
        background: none;
        color: var(--text);
        font-size: 12px;
        cursor: pointer;
        text-align: left;
    }

    .note-context-menu button:hover {
        background: var(--bg-button);
    }

    .note-context-menu .submenu-item {
        position: relative;
    }

    .note-context-menu .submenu-trigger {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 6px 12px;
        font-size: 12px;
        color: var(--text);
        cursor: default;
    }

    .note-context-menu .submenu-item:hover > .submenu-trigger {
        background: var(--bg-button);
    }

    .note-context-menu .submenu {
        display: none;
        position: absolute;
        left: 100%;
        top: -4px;
        background: var(--bg-sidebar);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 4px 0;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        min-width: 150px;
    }

    .note-context-menu .submenu-item:hover > .submenu {
        display: block;
    }

    .note-context-menu .separator {
        height: 1px;
        background: var(--border);
        margin: 4px 0;
    }
</style>
