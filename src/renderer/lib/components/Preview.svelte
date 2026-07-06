<script lang="ts">
    import {onDestroy} from 'svelte';
    import Icon from './Icon.svelte';
    import {installDismissOnClickOutside} from '../dismiss-menu';
    import MarkdownIt from 'markdown-it';
    // The Token *value* (used below for `new Token(...)` to inject a
    // task-list checkbox) is now recovered from `inlineTok.constructor`
    // (#347) so we no longer need a runtime import of
    // `markdown-it/lib/token.mjs`. The remaining `import type` paths
    // stay deep — `MarkdownIt.Token` / `MarkdownIt.StateBlock` namespace
    // lookups don't resolve through `@types/markdown-it`'s `export = X`
    // shape under isolatedModules — but type-only imports don't ship to
    // the bundler and only fail loudly at typecheck if the typings move.
    import type Token from 'markdown-it/lib/token.mjs';
    import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs';
    import hljs from 'highlight.js';
    import 'highlight.js/styles/github-dark.min.css';
    import 'katex/dist/katex.min.css';
    import {installMath} from '../../../shared/markdown/math-plugin';
    import {installDoiAutolink} from '../../../shared/markdown/doi-plugin';
    import {installHighlight} from '../../../shared/markdown/highlight-plugin';
    import {installCallouts} from '../markdown/callout-plugin';
    import {installWikiLinks, installNoteTags, installTransclusions} from '../markdown/inline-tokens-plugin';
    import {parseTransclusionTarget, sliceTransclusion} from '../../../shared/transclusion';
    import {resolveWikiLinkTarget, flattenNoteFiles} from '../../../shared/wiki-link-resolver';
    import {hydrateMermaidBlocks, invalidateMermaidTheme} from '../markdown/mermaid-renderer';
    import {hydrateVegaBlocks, invalidateVegaTheme} from '../markdown/vega-renderer';
    import {renderYouTubeFence} from '../markdown/youtube-embed';
    import {hydrateCardCallouts} from '../markdown/card-callout';
    import {detectDataSource} from '../../../shared/vega/data-binding';
    import {slugify} from '../../../shared/slug';
    import {api} from '../ipc/client';
    import {normalizeSqlRows} from '../editor/sql-result';
    import {clampSubmenu} from '../utils/menuClamp';
    import {renderChart, type ChartHandle, type ChartConfig, type ChartSeries} from '../charts';
    import {getToolInfosByCategory} from '../tools/tool-registry';
    import mdFootnote from 'markdown-it-footnote';
    import {planOutputEdit} from '../editor/output-block';
    import {findRunnableFences, codeOf, RUNNABLE_LANGUAGE_SET} from '../../../shared/compute/fences';
    import {runAllCellsInContent} from '../compute/run-all-cells';
    import type {CellResult} from '../ipc/client';
    import {escapeHtml, escapeAttr, stripFrontmatter, countFrontmatterLines} from '../preview/text';
    import {resolveRelativeImagePath, mimeFromPath} from '../preview/image-paths';
    import {mediaKind, mediaMime} from '../../../shared/media';
    import {
        type CiteMeta,
        type QuoteMeta,
        collapseCiteRows,
        buildCiteTooltip,
        buildQuoteTooltip,
        buildFootnoteTooltip
    } from '../preview/cite-meta';
    import {
        findSourceFenceBefore,
        renderComputeOutput,
        tableToCsv,
        outputToMarkdownClipboard
    } from '../preview/compute-output-render';

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
    }

    let {
        content,
        notePath = null,
        onNavigate,
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
    }: Props = $props();

    // §-numeral opt-in (#1120). The decimal-leading-zero "§ 01" H2 counter
    // only makes sense for long-form/essay notes, so it's gated on a
    // `numbered: true` frontmatter flag rather than firing on every note
    // (a journal or grocery list shouldn't grow section numerals). A
    // targeted regex over the frontmatter block is enough for one boolean.
    const numbered = $derived.by(() => {
        const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content)?.[1];
        return fm ? /^\s*numbered:\s*true\s*$/m.test(fm) : false;
    });

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

    const md = new MarkdownIt({
        html: true,
        linkify: true,
        typographer: true,
        highlight(str: string, lang: string) {
            if (lang && hljs.getLanguage(lang)) {
                try {
                    return hljs.highlight(str, {language: lang}).value;
                } catch { /* fall through */
                }
            }
            return '';
        },
    });
    // Disable setext (underline) headings. Minerva is ATX-only by convention —
    // the heading extractor deliberately skips `text\n---` — and leaving lheading
    // on actively breaks `[!card]` flashcards: the front line plus a `---` divider
    // parse as a setext `<h2>`, so the callout never forms and the raw
    // `[!card] ^id` marker leaks out as heading text. Off, `---` is the thematic
    // break the card syntax intends. (#850 polish)
    md.disable('lheading');
    installMath(md);
    installCallouts(md);
    installDoiAutolink(md);
    installHighlight(md);
    // Footnotes — markdown-it-footnote renders `[^id]` as a numbered
    // superscript anchored to a back-of-note `<section class="footnotes">`,
    // and each footnote body links back to the ref. Both jumps fire
    // through the existing `<a href="#id">` machinery — `handleClick`
    // below intercepts internal anchor clicks and scrolls the matching
    // element into view.
    md.use(mdFootnote);

    // Give every heading an id derived from its text so [[note#heading]] anchor
    // navigation can target it. Slugs must match the indexer's convention.
    const defaultHeadingOpen = md.renderer.rules.heading_open;
    md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
        const inline = tokens[idx + 1];
        const text = inline && inline.type === 'inline' ? inline.content : '';
        const slug = slugify(text);
        if (slug) tokens[idx]!.attrSet('id', slug);
        return defaultHeadingOpen
            ? defaultHeadingOpen(tokens, idx, options, env, self)
            : self.renderToken(tokens, idx, options);
    };

    // Watch for block-id paragraphs (`^block-id` at paragraph end) and mirror
    // them onto the rendered <p> so [[note#^id]] scrolls can find the target.
    const BLOCK_ID_RE = /\s*\^([\w-]+)\s*$/;
    const defaultParagraphOpen = md.renderer.rules.paragraph_open;
    md.renderer.rules.paragraph_open = (tokens, idx, options, env, self) => {
        const inline = tokens[idx + 1];
        if (inline && inline.type === 'inline') {
            const m = inline.content.match(BLOCK_ID_RE);
            if (m) {
                tokens[idx]!.attrSet('id', `^${m[1]}`);
                // Strip the marker from what renders.
                inline.content = inline.content.replace(BLOCK_ID_RE, '');
                if (inline.children) {
                    for (let i = inline.children.length - 1; i >= 0; i--) {
                        const child = inline.children[i]!;
                        if (child.type === 'text') {
                            const stripped = child.content.replace(BLOCK_ID_RE, '');
                            if (stripped !== child.content) {
                                child.content = stripped;
                                break;
                            }
                        }
                    }
                }
            }
        }
        return defaultParagraphOpen
            ? defaultParagraphOpen(tokens, idx, options, env, self)
            : self.renderToken(tokens, idx, options);
    };

    // Task-list items: when a list item starts with `[ ]` or `[x]`, render a
    // live <input type="checkbox"> and stamp `data-task-line` with the source
    // line (from the list_item_open token's `map`) so the click handler on
    // the preview root knows which line to flip in the editor store (#127).
    const TASK_ITEM_RE = /^\[([ xX])\]\s/;
    const defaultListItemOpen = md.renderer.rules.list_item_open;
    md.renderer.rules.list_item_open = (tokens, idx, options, env, self) => {
        // Scan forward to the first inline token inside this list item (typical
        // structure: list_item_open → paragraph_open → inline). Stop if we hit
        // the matching close without finding one.
        let k = idx + 1;
        while (k < tokens.length && tokens[k]!.type !== 'inline' && tokens[k]!.type !== 'list_item_close') k++;
        const inlineTok = k < tokens.length && tokens[k]!.type === 'inline' ? tokens[k]! : null;
        if (inlineTok) {
            const m = inlineTok.content.match(TASK_ITEM_RE);
            if (m) {
                const checked = m[1] === 'x' || m[1] === 'X';
                // `map[0]` is 0-indexed within whatever source was passed to
                // `md.render` — which is the frontmatter-stripped content below.
                // Add the env-carried offset so the checkbox's data-task-line
                // points at the line index in the original note.
                const rawLine = tokens[idx]!.map?.[0] ?? -1;
                const line = rawLine >= 0 ? rawLine + ((env as { lineOffset?: number })?.lineOffset ?? 0) : -1;
                tokens[idx]!.attrSet('data-task-line', String(line));
                tokens[idx]!.attrJoin('class', 'task-list-item');
                // Strip the `[ ]` prefix from the inline's aggregate content and
                // from its first text child so the rendered output doesn't repeat it.
                inlineTok.content = inlineTok.content.replace(TASK_ITEM_RE, '');
                if (inlineTok.children) {
                    for (let i = 0; i < inlineTok.children.length; i++) {
                        const child = inlineTok.children[i]!;
                        if (child.type === 'text') {
                            child.content = child.content.replace(TASK_ITEM_RE, '');
                            break;
                        }
                    }
                    // Inject the checkbox as an html_inline prefix on the inline tree.
                    // Recover the Token constructor from the inline token itself so we
                    // don't have to deep-import `markdown-it/lib/token.mjs` (#347).
                    const TokenCtor = inlineTok.constructor as new (
                        type: string, tag: string, nesting: -1 | 0 | 1,
                    ) => Token;
                    const cb = new TokenCtor('html_inline', '', 0);
                    cb.content = `<input type="checkbox" data-task-line="${line}"${checked ? ' checked' : ''}> `;
                    inlineTok.children.unshift(cb);
                }
            }
        }
        return defaultListItemOpen
            ? defaultListItemOpen(tokens, idx, options, env, self)
            : self.renderToken(tokens, idx, options);
    };

    // Wiki-link plugin: [[type::target|display]], [[type::target]], [[target|display]], [[target]]
    installWikiLinks(md);
    installNoteTags(md);
    installTransclusions(md);

    /**
     * Image rule (#244). markdown-it would normally emit `<img src="…">`
     * with the URL untouched; in the renderer that breaks for relative
     * paths because the document base is the Vite dev server / packaged
     * app URL, not the user's project root.
     *
     * Strategy: emit a placeholder `<img class="local-image" data-rel="…">`
     * for relative paths and let a post-render pass fetch each via
     * `api.notebase.readBinary`, then swap in a data URL. http(s) /
     * data: / file: pass through unchanged.
     */
    md.renderer.rules.image = (tokens, idx, options, _env, self) => {
        const tok = tokens[idx]!;
        const srcIdx = tok.attrIndex('src');
        if (srcIdx < 0) return self.renderToken(tokens, idx, options);
        const src = tok.attrs![srcIdx]![1];
        if (/^(?:https?:|data:|file:|blob:|mailto:)/i.test(src) || src.startsWith('//')) {
            // Absolute / data URL — render normally.
            return self.renderToken(tokens, idx, options);
        }
        const rel = resolveRelativeImagePath(src, renderPathOverride ?? notePath);
        const altIdx = tok.attrIndex('alt');
        const alt = altIdx >= 0 ? tok.attrs![altIdx]![1] : (tok.content ?? '');
        const titleIdx = tok.attrIndex('title');
        const title = titleIdx >= 0 ? ` title="${escapeAttr(tok.attrs![titleIdx]![1])}"` : '';
        // Local audio/video (#908): emit a player placeholder hydrated to a blob URL
        // by the post-render pass (videos are too large to base64-inline like images).
        const kind = mediaKind(rel);
        if (kind === 'video') {
            return `<video class="local-media" data-rel="${escapeAttr(rel)}" controls preload="metadata"${title}></video>`;
        }
        if (kind === 'audio') {
            return `<audio class="local-media" data-rel="${escapeAttr(rel)}" controls preload="metadata"${title}></audio>`;
        }
        return `<img class="local-image" data-rel="${escapeAttr(rel)}" alt="${escapeAttr(alt)}"${title} />`;
    };

    // Custom fence rendering (#994). The markdown-it fence rule computes the
    // shared context (token, 1-based source line) once, then dispatches on the
    // lowercased info string via `fenceRenderers`. Runnable fences (a
    // language-set membership test) and the default code-block wrapper (the
    // fallthrough) aren't keyable by a single info string, so they're
    // dispatched explicitly after the map lookup.
    interface FenceRenderArgs {
        tok: Token;
        tokens: Token[];
        idx: number;
        info: string;
        openingLine: number | null;
        /** Reproduce markdown-it's built-in fence output (the highlighted code
         *  block) — used by the runnable + default renderers. */
        renderDefault: () => string;
    }

    const fenceRenderers: Record<string, (args: FenceRenderArgs) => string> = {
        output: renderOutputFence,
        mermaid: renderMermaidFence,
        vega: renderVegaFence,
        'vega-lite': renderVegaFence,
        youtube: renderYouTubeFenceCard,
    };

    const defaultFence = md.renderer.rules.fence;
    md.renderer.rules.fence = (tokens, idx, options, env, self) => {
        const tok = tokens[idx]!;
        const info = tok.info.trim().toLowerCase();
        // tok.map is the [startLine, endLine] of the fence in the
        // SOURCE-FED-TO-md.render — 0-indexed, and that source has had
        // the YAML frontmatter stripped (see `renderContent` above).
        // `findRunnableFences` operates on the FULL content (frontmatter
        // intact). Add back `env.lineOffset` (the frontmatter line count)
        // and switch to 1-based numbering so the two helpers agree on
        // line numbers — without this the lookup in `runFenceAt` would
        // miss every fence in any note that has frontmatter. tok.map is
        // null when markdown-it can't determine the position (rare;
        // toolbar falls back to "no run button").
        const frontmatterOffset = (env as { lineOffset?: number } | undefined)?.lineOffset ?? 0;
        const openingLine = tok.map ? tok.map[0] + 1 + frontmatterOffset : null;
        const renderDefault = () => (defaultFence
            ? defaultFence(tokens, idx, options, env, self)
            : self.renderToken(tokens, idx, options));
        const args: FenceRenderArgs = { tok, tokens, idx, info, openingLine, renderDefault };

        const typeRenderer = fenceRenderers[info];
        if (typeRenderer) return typeRenderer(args);

        // Runnable fences render a toolbar (▶ run + collapse) only when the
        // source line is known; otherwise they fall through to the default
        // code-block wrapper.
        if (RUNNABLE_LANGUAGE_SET.has(info) && openingLine !== null) {
            return renderRunnableFence(args, openingLine);
        }
        return renderDefaultFence(args);
    };

    // Compute-cell output blocks (#238). A ```output fence below an executable
    // fence carries the JSON payload the executor produced; render it as a
    // shape-specific artifact (table / error / text / pretty JSON) rather
    // than as a generic highlighted code block. Users editing the note in
    // source view still see the raw JSON and can delete the block to re-run.
    function renderOutputFence(args: FenceRenderArgs): string {
        const source = findSourceFenceBefore(args.tokens, args.idx);
        return renderComputeOutput(args.tok.content, source);
    }

    function renderMermaidFence(args: FenceRenderArgs): string {
        const { tok, openingLine } = args;
        const escaped = (tok.content ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        // Mermaid blocks get a collapse toggle (no run — they auto-render
        // on view) so a long diagram can be tucked away when scrolling
        // through the rest of the note.
        if (openingLine !== null) {
            const isCollapsed = collapsedFences.has(openingLine);
            return `<div class="fence-block fence-mermaid${isCollapsed ? ' fence-collapsed' : ''}" data-fence-line="${openingLine}">`
                + `<div class="fence-toolbar"><span class="fence-lang">mermaid</span>`
                + `<button class="fence-collapse-btn" data-fence-action="collapse" type="button" title="Collapse / expand">${isCollapsed ? '▸' : '▾'}</button>`
                + `</div>`
                + `<div class="fence-body"><div class="mermaid-block" data-mermaid-pending="1">${escaped}</div></div>`
                + `</div>\n`;
        }
        return `<div class="mermaid-block" data-mermaid-pending="1">${escaped}</div>\n`;
    }

    function renderVegaFence(args: FenceRenderArgs): string {
        const { tok, info, openingLine } = args;
        const escaped = (tok.content ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
        const mode = info === 'vega' ? 'full' : 'lite';
        // Like mermaid, charts auto-render on view (no run button) but get a
        // collapse toggle so a tall chart can be tucked away. The lazy hydrator
        // (vega-renderer.ts) swaps the placeholder for an embedded SVG chart.
        const block = `<div class="vega-block" data-vega-pending="1" data-vega-mode="${mode}">${escaped}</div>`;
        // A data-bound chart (#832 — `data.sparql` etc.) gets a refresh button so
        // the user can re-run the query after the graph changes without editing
        // the note. Inline charts don't need it. Cheap parse — charts are few.
        let isBound = false;
        try {
            isBound = detectDataSource(JSON.parse(tok.content ?? '')) !== null;
        } catch { /* not bound */
        }
        if (openingLine !== null) {
            const isCollapsed = collapsedFences.has(openingLine);
            const refreshBtn = isBound
                ? `<button class="fence-refresh-btn" data-fence-action="refresh-vega" type="button" title="Refresh chart data">⟳</button>`
                : '';
            return `<div class="fence-block fence-vega${isCollapsed ? ' fence-collapsed' : ''}" data-fence-line="${openingLine}">`
                + `<div class="fence-toolbar"><span class="fence-lang">${info}</span>`
                + refreshBtn
                + `<button class="fence-collapse-btn" data-fence-action="collapse" type="button" title="Collapse / expand">${isCollapsed ? '▸' : '▾'}</button>`
                + `</div>`
                + `<div class="fence-body">${block}</div>`
                + `</div>\n`;
        }
        return `${block}\n`;
    }

    // A `youtube` fence renders a click-to-open poster card (#904) — thumbnail
    // + ▶, opens in the browser on click. No live iframe, so no CSP change; the
    // card is self-explanatory, so it skips the code-fence toolbar wrapper.
    function renderYouTubeFenceCard(args: FenceRenderArgs): string {
        return `${renderYouTubeFence(args.tok.content ?? '')}\n`;
    }

    // Runnable fences (python / sparql / sql) get a toolbar with a ▶
    // run button (when the host wired `onRunCell` + `onApplyCellOutputEdit`)
    // and a collapse toggle. The default highlighted-code body is
    // wrapped inside `.fence-body` so the toggle can hide it.
    function renderRunnableFence(args: FenceRenderArgs, openingLine: number): string {
        const { info, renderDefault } = args;
        const isCollapsed = collapsedFences.has(openingLine);
        const isRunning = runningFences.has(openingLine);
        const canRun = !!(onRunCell && onApplyCellOutputEdit && notePath);
        const defaultRender = renderDefault();
        const runBtn = canRun
            ? `<button class="fence-run-btn" data-fence-action="run" type="button" title="Run cell" ${isRunning ? 'disabled' : ''}>${isRunning ? '⋯' : '▶'}</button>`
            : '';
        return `<div class="fence-block fence-runnable${isCollapsed ? ' fence-collapsed' : ''}" data-fence-line="${openingLine}" data-fence-lang="${info}">`
            + `<div class="fence-toolbar">`
            + `<span class="fence-lang">${info}</span>`
            + runBtn
            + `<button class="fence-collapse-btn" data-fence-action="collapse" type="button" title="Collapse / expand">${isCollapsed ? '▸' : '▾'}</button>`
            + `</div>`
            + `<div class="fence-body">${defaultRender}</div>`
            + `</div>\n`;
    }

    function renderDefaultFence(args: FenceRenderArgs): string {
        const { info, renderDefault } = args;
        const rendered = renderDefault();
        // Wrap non-runnable, non-mermaid fences in a code-block container
        // carrying the language label (§8.5). Empty `info` (a bare ```)
        // skips the wrapper so plain code blocks don't get a stray label.
        if (info && info !== 'output') {
            return `<div class="code-block" data-language="${info}">${rendered}</div>\n`;
        }
        return rendered;
    }

    /**
     * Cache of {projectRelPath → data URL} for images referenced from
     * the rendered note. Survives re-renders so panning around a long
     * doc doesn't keep refetching the same `<img>` over and over.
     * Cleared when the active note changes (the path-keyed cache stays
     * project-scoped automatically since paths include the note dir).
     */
    const imageDataUrlCache = new Map<string, string>();

    /**
     * Post-render hydration: walk every `.local-image[data-rel]`
     * placeholder, fetch the asset bytes via the binary IPC, and
     * inline as a data URL. Cached so re-renders are O(1) per image.
     */
    async function hydrateLocalImages(): Promise<void> {
        const root = previewEl;
        if (!root) return;
        const imgs = Array.from(root.querySelectorAll<HTMLImageElement>('img.local-image[data-rel]'));
        await Promise.all(imgs.map(async (img) => {
            const rel = img.dataset.rel;
            if (!rel) return;
            const cached = imageDataUrlCache.get(rel);
            if (cached) {
                if (img.src !== cached) img.src = cached;
                return;
            }
            try {
                if (typeof api.notebase.readBinary !== 'function') {
                    throw new Error(
                        'api.notebase.readBinary is not exposed. Preload changes require a full Electron restart (Cmd-R reloads the renderer only).',
                    );
                }
                const bytes = await api.notebase.readBinary(rel);
                // Buffer encoding via btoa over a small string is cheap; the
                // chunked builder avoids "Maximum call stack" for big images.
                let bin = '';
                const view: Uint8Array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
                const CHUNK = 0x8000;
                for (let i = 0; i < view.length; i += CHUNK) {
                    bin += String.fromCharCode.apply(null, Array.from(view.subarray(i, i + CHUNK)));
                }
                const url = `data:${mimeFromPath(rel)};base64,${btoa(bin)}`;
                imageDataUrlCache.set(rel, url);
                img.src = url;
            } catch (err) {
                // Missing / unreadable — flag the placeholder visually and log
                // the underlying error to the devtools console so a typo'd
                // path or a missing asset is easy to debug.
                console.warn('[preview] image hydration failed for', rel, err);
                img.classList.add('local-image-broken');
            }
        }));
    }

    /**
     * Transclusion hydration (#906). Walk `.transclusion[data-embed]`
     * placeholders, resolve each `![[target]]` to a note, slice out the
     * requested section/block, render it through this same markdown
     * pipeline, and inject it inline. Nested embeds resolve over repeated
     * passes; a per-placeholder ancestry chain (seeded with the host note)
     * catches loops, and a depth cap stops runaway nesting. Missing notes /
     * headings / blocks degrade to a visible inline notice.
     */
    const TRANSCLUSION_MAX_DEPTH = 5;

    async function hydrateTransclusions(): Promise<void> {
        const root = previewEl;
        if (!root) return;
        if (!root.querySelector('.transclusion[data-embed]:not([data-resolved])')) return;

        let flat: { relativePath: string; isDirectory: boolean }[] = [];
        let aliasMap: Record<string, string> = {};
        try {
            const tree = await api.notebase.listFiles();
            flat = flattenNoteFiles(tree).map((f) => ({relativePath: f.relativePath, isDirectory: false}));
        } catch { /* tree not ready — every embed will degrade to a notice */
        }
        try {
            aliasMap = await api.graph.aliasMap();
        } catch { /* no aliases */
        }

        const hostChain = notePath ? [notePath] : [];
        const notice = (ph: HTMLElement, text: string, cls: string) => {
            ph.innerHTML = `<div class="transclusion-notice ${cls}"></div>`;
            (ph.firstElementChild as HTMLElement).textContent = text;
            ph.dataset.resolved = '1';
        };

        let injected = false;
        for (let pass = 0; pass <= TRANSCLUSION_MAX_DEPTH; pass++) {
            const todo = Array.from(
                root.querySelectorAll<HTMLElement>('.transclusion[data-embed]:not([data-resolved])'),
            );
            if (todo.length === 0) break;

            for (const ph of todo) {
                const embed = ph.dataset.embed ?? '';
                const target = parseTransclusionTarget(embed);
                // Ancestry: nearest already-resolved transclusion above us carries the
                // chain of source paths; top-level embeds inherit the host note's.
                const ancestor = ph.parentElement?.closest<HTMLElement>('.transclusion[data-chain]');
                const chain = ancestor?.dataset.chain ? JSON.parse(ancestor.dataset.chain) as string[] : hostChain;

                const rel = resolveWikiLinkTarget(target.path, flat, aliasMap);
                if (!rel) {
                    notice(ph, `Note “${target.path}” not found`, 'transclusion-missing');
                    continue;
                }
                if (chain.includes(rel)) {
                    notice(ph, `Transclusion loop: ${target.path}`, 'transclusion-loop');
                    continue;
                }
                if (chain.length > TRANSCLUSION_MAX_DEPTH) {
                    notice(ph, 'Transclusion nested too deep', 'transclusion-loop');
                    continue;
                }

                let fileContent: string;
                try {
                    fileContent = await api.notebase.readFile(rel);
                } catch {
                    notice(ph, `Could not read “${target.path}”`, 'transclusion-missing');
                    continue;
                }

                const slice = sliceTransclusion(fileContent, target);
                if (!slice.ok) {
                    notice(ph, slice.reason ?? 'Embedded content unavailable', 'transclusion-missing');
                    continue;
                }

                renderPathOverride = rel;
                let html: string;
                try {
                    html = md.render(slice.text);
                } finally {
                    renderPathOverride = null;
                }

                const label = target.heading ? `${target.path} › ${target.heading}`
                    : target.blockId ? `${target.path} › ^${target.blockId}` : target.path;
                const header = document.createElement('a');
                header.className = 'transclusion-open';
                header.dataset.target = target.path;
                header.textContent = label;
                const body = document.createElement('div');
                body.className = 'transclusion-body';
                body.innerHTML = html;
                ph.replaceChildren(header, body);
                ph.dataset.chain = JSON.stringify([...chain, rel]);
                ph.dataset.resolved = '1';
                injected = true;
            }
        }

        // Anything still unresolved bottomed out at the depth cap.
        root.querySelectorAll<HTMLElement>('.transclusion[data-embed]:not([data-resolved])')
            .forEach((ph) => notice(ph, 'Transclusion nested too deep', 'transclusion-loop'));

        // Embedded fragments carry their own images / charts / cards / cite links —
        // run the same post-render battery over the freshly injected subtree.
        if (injected) {
            void hydrateLocalImages();
            const cites = root.querySelectorAll('.cite-link');
            cites.forEach((el) => resolveCiteLabel(el as HTMLElement));
            const quotes = root.querySelectorAll('.quote-link');
            quotes.forEach((el) => resolveQuoteLabel(el as HTMLElement));
            void hydrateMermaidBlocks(root);
            void hydrateVegaBlocks(root, content);
            hydrateCardCallouts(root);
        }
    }

    /* Blob-URL cache for local audio/video (#908). Unlike images (base64 data
    * URLs), media is held as `blob:` URLs — a 200 MB video can't be base64-inlined.
    * Keyed by rel path so a re-render reuses the same blob; revoked on unmount.
    * (Large-library seeking would want a streaming `app://` protocol — a follow-up.)
    */
    const mediaBlobCache = new Map<string, string>();

    /** Post-render hydration for `.local-media[data-rel]` players — fetch the bytes
     *  and point the element at a blob URL. Mirrors hydrateLocalImages. */
    async function hydrateLocalMedia(): Promise<void> {
        const root = previewEl;
        if (!root) return;
        const els = Array.from(root.querySelectorAll<HTMLMediaElement>('.local-media[data-rel]'));
        await Promise.all(els.map(async (el) => {
            const rel = el.dataset.rel;
            if (!rel) return;
            const cached = mediaBlobCache.get(rel);
            if (cached) {
                if (el.src !== cached) el.src = cached;
                return;
            }
            try {
                const bytes = await api.notebase.readBinary(rel);
                const view: Uint8Array = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
                const url = URL.createObjectURL(new Blob([view as BlobPart], {type: mediaMime(rel)}));
                mediaBlobCache.set(rel, url);
                el.src = url;
            } catch (err) {
                console.warn('[preview] media hydration failed for', rel, err);
                el.classList.add('local-media-broken');
            }
        }));
    }

    onDestroy(() => {
        for (const url of mediaBlobCache.values()) URL.revokeObjectURL(url);
        mediaBlobCache.clear();
    });

    // Query directive plugin: :::query-list ... :::
    md.block.ruler.before('fence', 'query_directive', (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
        const startPos = state.bMarks[startLine]! + state.tShift[startLine]!;
        const startMax = state.eMarks[startLine];
        const lineText = state.src.slice(startPos, startMax);

        // Match opening :::query-TYPE
        const openMatch = lineText.match(/^:::query-(\w+)\s*$/);
        if (!openMatch) return false;
        if (silent) return true;

        const directiveType = openMatch[1]; // 'list', etc.

        // Find closing :::
        let nextLine = startLine + 1;
        let found = false;
        while (nextLine < endLine) {
            const pos = state.bMarks[nextLine]! + state.tShift[nextLine]!;
            const max = state.eMarks[nextLine];
            const line = state.src.slice(pos, max).trim();
            if (line === ':::') {
                found = true;
                break;
            }
            nextLine++;
        }
        if (!found) return false;

        // Extract body between the fences
        const contentStart = state.bMarks[startLine + 1];
        const contentEnd = state.bMarks[nextLine];
        const body = state.src.slice(contentStart, contentEnd).trim();

        // Split on --- separator: config above, query below. If no separator, entire body is the query.
        const sepIdx = body.indexOf('\n---\n');
        let config: Record<string, string> = {};
        let query: string;
        if (sepIdx >= 0) {
            const configBlock = body.slice(0, sepIdx).trim();
            query = body.slice(sepIdx + 5).trim();
            for (const line of configBlock.split('\n')) {
                const colonIdx = line.indexOf(':');
                if (colonIdx > 0) {
                    const key = line.slice(0, colonIdx).trim();
                    const value = line.slice(colonIdx + 1).trim();
                    if (key && value) config[key] = value;
                }
            }
        } else {
            query = body;
        }

        const token = state.push('query_directive', 'div', 0);
        token.content = query;
        token.meta = {type: directiveType, config};
        token.map = [startLine, nextLine + 1];
        state.line = nextLine + 1;
        return true;
    });

    md.renderer.rules.query_directive = (tokens: Token[], idx: number) => {
        const query = tokens[idx]!.content;
        const {type, config} = tokens[idx]!.meta as { type: string; config: Record<string, unknown> };
        const configJson = Object.keys(config).length > 0 ? escapeAttr(JSON.stringify(config)) : '';
        return `<div class="query-block" data-type="${escapeAttr(type)}" data-query="${escapeAttr(query)}"${configJson ? ` data-config="${configJson}"` : ''}><span class="query-loading">Loading...</span></div>`;
    };

    // Re-rendering markdown + KaTeX + highlight.js + citeproc on every
    // keystroke felt as typing lag in split-view once notes pass a few
    // thousand characters (#335). Debounce: render the first frame
    // synchronously so there's no FOUC, then coalesce subsequent
    // changes to one render per ~120ms idle window.
    function renderContent(c: string): string {
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

    // After render, find query-block placeholders and execute queries
    $effect(() => {
        rendered; // track dependency on rendered HTML

        // Destroy previous chart instances before re-rendering
        activeCharts.forEach(c => c.destroy());
        activeCharts = [];

        requestAnimationFrame(() => {
            const blocks = previewEl?.querySelectorAll('.query-block');
            blocks?.forEach((el) => executeQueryBlock(el as HTMLElement));
            const cites = previewEl?.querySelectorAll('.cite-link');
            cites?.forEach((el) => resolveCiteLabel(el as HTMLElement));
            const quotes = previewEl?.querySelectorAll('.quote-link');
            quotes?.forEach((el) => resolveQuoteLabel(el as HTMLElement));
            // CSL marker pass — runs in parallel with the per-element
            // metadata fetches. Citeproc-rendered markers replace the
            // raw cite/quote display text per the project's CSL style.
            void applyCslMarkers();
            // Image hydration (#244) — same shape as CSL markers: walk the
            // rendered DOM, fetch each `<img class="local-image">` via the
            // binary IPC, swap in a data URL. Cached per-path so re-renders
            // skip the round-trip.
            void hydrateLocalImages();
            // Transclusion hydration (#906) — resolve `![[note]]` / `![[note#H]]` /
            // `![[note^block]]` embeds, slicing + re-rendering the target inline.
            void hydrateTransclusions();
            void hydrateLocalMedia();
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

    /**
     * Walk every cite/quote link in document order, batch them into one
     * IPC call, and swap each link's `.link-display` text for the
     * citeproc-rendered marker. Document order matters for numeric
     * styles ("[1]" goes to the first-cited item) — `querySelectorAll`
     * returns DOM-order, which equals source-order here.
     */
    async function applyCslMarkers(): Promise<void> {
        const root = previewEl;
        if (!root) return;
        const links = Array.from(
            root.querySelectorAll<HTMLElement>('.cite-link, .quote-link'),
        );
        if (links.length === 0) {
            cslBibliographyEntries = null;
            return;
        }
        const refs: { kind: 'cite' | 'quote'; id: string }[] = [];
        for (const el of links) {
            if (el.classList.contains('cite-link')) {
                const id = el.dataset.sourceId;
                if (id) refs.push({kind: 'cite', id});
            } else {
                const id = el.dataset.excerptId;
                if (id) refs.push({kind: 'quote', id});
            }
        }
        if (refs.length === 0) {
            cslBibliographyEntries = null;
            return;
        }
        let response: Awaited<ReturnType<typeof api.citations.renderInline>>;
        try {
            response = await api.citations.renderInline(refs);
        } catch (err) {
            console.warn('[preview] citation render failed:', err);
            cslBibliographyEntries = null;
            return;
        }
        // The DOM may have re-rendered while the IPC was in flight; bail
        // if the link set we measured is no longer current.
        const currentLinks = root.querySelectorAll<HTMLElement>('.cite-link, .quote-link');
        if (currentLinks.length !== links.length) return;
        for (let i = 0; i < links.length; i++) {
            const el = links[i]!;
            const marker = response.markers[i];
            if (typeof marker !== 'string') continue;
            // Respect the user's |display override — they asked for that
            // exact text and citeproc shouldn't override it.
            if (el.dataset.displayOverride === '1') continue;
            const displayEl = el.querySelector<HTMLSpanElement>('.link-display');
            if (!displayEl) continue;
            displayEl.innerHTML = marker;
        }
        cslBibliographyEntries = response.bibliography;
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

    async function resolveCiteLabel(el: HTMLElement) {
        const sourceId = el.dataset.sourceId;
        if (!sourceId) return;

        const displayEl = el.querySelector<HTMLSpanElement>('.link-display');
        if (!displayEl) return;

        const cached = citeMetaCache.get(sourceId);
        if (cached) {
            applyCiteMeta(el, displayEl, sourceId, cached);
            return;
        }

        try {
            const idEsc = sourceId.replace(/"/g, '\\"');
            const sparql = `PREFIX bibo: <http://purl.org/ontology/bibo/>
        SELECT ?title ?creator ?issued ?doi ?uri WHERE {
          ?src minerva:sourceId "${idEsc}" .
          OPTIONAL { ?src dc:title ?title }
          OPTIONAL { ?src dc:creator ?creator }
          OPTIONAL { ?src dc:issued ?issued }
          OPTIONAL { ?src bibo:doi ?doi }
          OPTIONAL { ?src bibo:uri ?uri }
        }`;
            const response = await api.graph.query(QUERY_PREFIXES + sparql);
            const meta = collapseCiteRows(response.results as Array<Record<string, string>>);
            citeMetaCache.set(sourceId, meta);
            applyCiteMeta(el, displayEl, sourceId, meta);
        } catch {
            // Fall back to the source-id already rendered.
        }
    }

    function applyCiteMeta(el: HTMLElement, _displayEl: HTMLSpanElement, _sourceId: string, meta: CiteMeta) {
        // Display text is owned by the CSL marker pass (#110); we only
        // populate tooltip metadata here.
        el.dataset.tooltipKind = 'cite';
        el.dataset.tooltipPayload = JSON.stringify(meta);
    }

    async function resolveQuoteLabel(el: HTMLElement) {
        const excerptId = el.dataset.excerptId;
        if (!excerptId) return;

        const displayEl = el.querySelector<HTMLSpanElement>('.link-display');
        if (!displayEl) return;

        const cached = quoteMetaCache.get(excerptId);
        if (cached) {
            applyQuoteMeta(el, displayEl, excerptId, cached);
            return;
        }

        try {
            const idEsc = excerptId.replace(/"/g, '\\"');
            const sparql = `SELECT ?citedText ?sourceTitle ?sourceCreator ?sourceIssued ?page ?pageRange ?locationText WHERE {
        ?ex minerva:excerptId "${idEsc}" .
        OPTIONAL { ?ex thought:citedText ?citedText }
        OPTIONAL { ?ex thought:page ?page }
        OPTIONAL { ?ex thought:pageRange ?pageRange }
        OPTIONAL { ?ex thought:locationText ?locationText }
        OPTIONAL {
          ?ex thought:fromSource ?src .
          OPTIONAL { ?src dc:title ?sourceTitle }
          OPTIONAL { ?src dc:creator ?sourceCreator }
          OPTIONAL { ?src dc:issued ?sourceIssued }
        }
      } LIMIT 1`;
            const response = await api.graph.query(QUERY_PREFIXES + sparql);
            const row = response.results[0] as Record<string, string> | undefined;
            const meta: QuoteMeta = row ? {
                ...(row.citedText !== undefined ? { citedText: row.citedText } : {}),
                ...(row.sourceTitle !== undefined ? { sourceTitle: row.sourceTitle } : {}),
                ...(row.sourceCreator !== undefined ? { sourceCreator: row.sourceCreator } : {}),
                ...(row.sourceIssued !== undefined ? { sourceYear: row.sourceIssued.slice(0, 4) } : {}),
                ...(row.page !== undefined ? { page: row.page } : {}),
                ...(row.pageRange !== undefined ? { pageRange: row.pageRange } : {}),
                ...(row.locationText !== undefined ? { locationText: row.locationText } : {}),
            } : {};
            quoteMetaCache.set(excerptId, meta);
            applyQuoteMeta(el, displayEl, excerptId, meta);
        } catch {
            // Fall back to the excerpt-id already rendered.
        }
    }

    function applyQuoteMeta(el: HTMLElement, _displayEl: HTMLSpanElement, _excerptId: string, meta: QuoteMeta) {
        // Display text is owned by the CSL marker pass (#110); we only
        // populate tooltip metadata here.
        el.dataset.tooltipKind = 'quote';
        el.dataset.tooltipPayload = JSON.stringify(meta);
    }

    async function executeQueryBlock(el: HTMLElement) {
        const query = el.dataset.query;
        const type = el.dataset.type;
        if (!query) return;

        let config: Record<string, string> = {};
        try {
            config = JSON.parse(el.dataset.config ?? '{}');
        } catch { /* ignore */
        }

        const language = config.language === 'sql' ? 'sql' : 'sparql';
        // Cache key pairs (language, query) so a SQL query and a SPARQL query that
        // happen to share the same string don't collide.
        const cacheKey = `${language}::${query}`;

        const cached = queryCache.get(cacheKey);
        if (cached) {
            renderQueryResults(el, type ?? 'list', config, cached.results, cached.error);
            return;
        }

        el.innerHTML = '<span class="query-loading">Loading...</span>';

        try {
            let results: Record<string, string>[];
            if (language === 'sql') {
                const response = await api.tables.query(query);
                if (!response.ok) {
                    queryCache.set(cacheKey, {results: [], error: response.error});
                    renderQueryResults(el, type ?? 'list', config, [], response.error);
                    return;
                }
                results = normalizeSqlRows(response.columns, response.rows);
            } else {
                const response = await api.graph.query(QUERY_PREFIXES + query);
                results = response.results as Record<string, string>[];
            }
            queryCache.set(cacheKey, {results});
            renderQueryResults(el, type ?? 'list', config, results);
        } catch (e) {
            const error = e instanceof Error ? e.message : String(e);
            queryCache.set(cacheKey, {results: [], error});
            renderQueryResults(el, type ?? 'list', config, [], error);
        }
    }

    function renderQueryResults(el: HTMLElement, type: string, config: Record<string, string>, results: unknown[], error?: string) {
        if (error) {
            el.innerHTML = `<p class="query-error">${escapeHtml(error)}</p>`;
            return;
        }

        const title = config.title;
        const titleHtml = title ? `<h4 class="query-title">${escapeHtml(title)}</h4>` : '';

        if (type === 'list') {
            renderAsList(el, config, results, titleHtml);
        } else if (type === 'table') {
            renderAsTable(el, config, results, titleHtml);
        } else if (type === 'timeseries') {
            renderAsTimeseries(el, config, results);
        } else {
            el.innerHTML = `<p class="query-error">Unknown directive type: ${escapeHtml(type)}</p>`;
        }
    }

    function renderAsList(el: HTMLElement, config: Record<string, string>, results: unknown[], titleHtml: string) {
        // "link" config key specifies which column contains the navigable path (default: "path")
        const linkCol = config.link ?? 'path';
        const rows = results as Record<string, string>[];

        const items = rows.map((r) => {
            const label = r.title ?? r.name ?? r.label ?? r[linkCol] ?? 'Untitled';
            const path = r[linkCol] ?? '';
            if (path) {
                return `<li><a class="wiki-link" data-target="${escapeAttr(path)}">${escapeHtml(label)}</a></li>`;
            }
            return `<li>${escapeHtml(label)}</li>`;
        });
        el.innerHTML = items.length > 0
            ? `${titleHtml}<ul class="query-result-list">${items.join('')}</ul>`
            : `${titleHtml}<p class="query-empty">No results</p>`;
    }

    function renderAsTable(el: HTMLElement, config: Record<string, string>, results: unknown[], titleHtml: string) {
        const rows = results as Record<string, string>[];
        if (rows.length === 0) {
            el.innerHTML = `${titleHtml}<p class="query-empty">No results</p>`;
            return;
        }

        // "link" config key specifies which column contains navigable paths
        const linkCol = config.link ?? '';
        // "columns" config key can restrict/reorder visible columns (comma-separated)
        const allCols = Object.keys(rows[0]!);
        const visibleCols = config.columns
            ? config.columns.split(',').map(c => c.trim()).filter(c => allCols.includes(c))
            : allCols;

        const headers = visibleCols.map(c => `<th>${escapeHtml(c)}</th>`).join('');
        const body = rows.map(r => {
            const cells = visibleCols.map(c => {
                const val = r[c] ?? '';
                if (c === linkCol || (linkCol === '' && c === 'path')) {
                    return `<td><a class="wiki-link" data-target="${escapeAttr(val)}">${escapeHtml(val)}</a></td>`;
                }
                // If this cell looks like a path and there's a link column, make it a link using that path
                if (linkCol && r[linkCol]) {
                    // Only make the title/name/label column clickable
                    if (c === 'title' || c === 'name' || c === 'label') {
                        return `<td><a class="wiki-link" data-target="${escapeAttr(r[linkCol])}">${escapeHtml(val)}</a></td>`;
                    }
                }
                return `<td>${escapeHtml(val)}</td>`;
            }).join('');
            return `<tr>${cells}</tr>`;
        }).join('');

        el.innerHTML = `${titleHtml}<table class="query-result-table"><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`;
    }

    function renderAsTimeseries(el: HTMLElement, config: Record<string, string>, results: unknown[]) {
        const rows = results as Record<string, string>[];
        if (rows.length === 0) {
            const title = config.title;
            el.innerHTML = title
                ? `<h4 class="query-title">${escapeHtml(title)}</h4><p class="query-empty">No results</p>`
                : '<p class="query-empty">No results</p>';
            return;
        }

        const allCols = Object.keys(rows[0]!);
        const xCol = config.x ?? allCols[0] ?? '';
        const yCols = config.y
            ? config.y.split(',').map(c => c.trim())
            : allCols.filter(c => c !== xCol);
        const chartType = (config.type ?? 'line') as 'line' | 'bar' | 'area';
        const height = parseInt(config.height ?? '300', 10);

        const series: ChartSeries[] = yCols.map(col => ({
            label: col,
            data: rows.map(r => ({
                x: r[xCol] ?? '',
                y: parseFloat(r[col] ?? '0') || 0,
            })),
        }));

        const chartConfig: ChartConfig = {
            ...(config.title !== undefined ? { title: config.title } : {}),
            type: chartType,
            height,
            series,
        };

        const wrapper = document.createElement('div');
        wrapper.className = 'query-chart-wrapper';
        wrapper.style.height = `${height}px`;
        const canvas = document.createElement('canvas');
        wrapper.appendChild(canvas);
        el.innerHTML = '';
        el.appendChild(wrapper);

        const handle = renderChart(canvas, chartConfig);
        activeCharts.push(handle);
    }

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
                tooltipVisible = true;
                positionTooltip(footnoteRef);
            }
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
        tooltipVisible = true;
        positionTooltip(el);
    }

    function handleMouseOut(e: MouseEvent) {
        const target = e.target as HTMLElement | null;
        const leaving = target?.closest<HTMLElement>('.cite-link, .quote-link, .footnote-ref');
        if (!leaving) return;
        // relatedTarget can be null when cursor leaves the window — dismiss anyway
        const to = e.relatedTarget as Node | null;
        if (to && leaving.contains(to)) return;
        tooltipVisible = false;
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
        class:numbered
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
                <!-- citeproc emits trusted HTML from project-controlled meta.ttl -->
                <div class="csl-bibliography-entry">{@html entry}</div>
            {/each}
        </aside>
    {/if}
    <div
            class="cite-tooltip"
            class:visible={tooltipVisible}
            style={tooltipStyle}
            aria-hidden="true"
    >
        {@html tooltipHtml}
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
       per note (#1120): only `.preview.numbered` — set from a
       `numbered: true` frontmatter flag — resets/increments the counter and
       shows the "§ 01" prefix. The serif H2 itself stays unconditional. */
    .preview.numbered {
        counter-reset: h2;
    }

    .preview :global(h1) {
        font-family: var(--font-display);
        font-size: 30px;
        line-height: 1.15;
        font-weight: 500;
        letter-spacing: -0.01em;
        margin: 8px 0 4px;
        padding: 0;
        border: none;
    }

    .preview :global(h2) {
        font-family: var(--font-display);
        font-size: 22px;
        line-height: 1.2;
        font-weight: 500;
        letter-spacing: -0.01em;
        margin: 24px 0 12px;
    }

    .preview.numbered :global(h2) {
        counter-increment: h2;
    }

    .preview.numbered :global(h2)::before {
        content: '§ ' counter(h2, decimal-leading-zero);
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--accent);
        margin-right: 10px;
        font-weight: 400;
        letter-spacing: 0;
    }

    .preview :global(h3) {
        font-family: var(--font-display);
        font-size: 18px;
        font-weight: 500;
        letter-spacing: -0.005em;
        margin: 20px 0 8px;
    }

    .preview :global(p) {
        margin: 0 0 12px;
    }

    .preview :global(li.task-list-item) {
        list-style: none;
        margin-left: -1.2em;
    }

    .preview :global(li.task-list-item > input[type="checkbox"][data-task-line]) {
        margin-right: 6px;
        cursor: pointer;
        vertical-align: -1px;
    }

    .preview :global(a) {
        color: var(--accent);
        text-decoration: none;
    }

    .preview :global(a:hover) {
        text-decoration: underline;
    }

    /* Wiki-link as a chip (§8.4) — accent-tinted bg, no underline, small
       padding. Plain wiki-links only; typed-links keep their existing
       pill-with-badge shape below. */
    .preview :global(.wiki-link) {
        display: inline-block;
        padding: 1px 8px;
        background: color-mix(in oklch, var(--accent) 12%, transparent);
        color: var(--accent);
        border-radius: 4px;
        font-family: var(--font-sans);
        border: none;
        cursor: pointer;
    }

    .preview :global(.wiki-link:hover) {
        background: color-mix(in oklch, var(--accent) 18%, transparent);
        text-decoration: none;
    }

    /* Transclusion embeds (#906) — a framed, slightly inset block so the
       reader can tell embedded content from the host note's own prose. */
    .preview :global(.transclusion) {
        margin: 0.75em 0;
        border: 1px solid var(--border);
        border-left: 3px solid var(--accent);
        border-radius: 6px;
        background: color-mix(in oklch, var(--accent) 4%, transparent);
        overflow: hidden;
    }

    .preview :global(.transclusion-loading) {
        padding: 8px 12px;
        color: var(--text-muted);
        font-family: var(--font-sans);
        font-size: 0.9em;
        opacity: 0.7;
    }

    .preview :global(.transclusion-open) {
        display: block;
        padding: 4px 12px;
        font-family: var(--font-sans);
        font-size: 0.8em;
        color: var(--text-muted);
        background: color-mix(in oklch, var(--accent) 8%, transparent);
        border-bottom: 1px solid var(--border);
        cursor: pointer;
        user-select: none;
    }

    .preview :global(.transclusion-open:hover) {
        color: var(--accent);
        text-decoration: none;
    }

    .preview :global(.transclusion-body) {
        padding: 2px 14px;
    }

    /* Collapse the embedded body's outer margins so it sits flush in the frame. */
    .preview :global(.transclusion-body > :first-child) {
        margin-top: 0;
    }

    .preview :global(.transclusion-body > :last-child) {
        margin-bottom: 0;
    }

    .preview :global(.transclusion-notice) {
        padding: 8px 12px;
        font-family: var(--font-sans);
        font-size: 0.85em;
        color: var(--text-muted);
    }

    .preview :global(.transclusion-loop) {
        border-left-color: var(--text-muted);
    }

    .preview :global(.typed-link) {
        color: var(--link-color, var(--accent));
        border-bottom-color: var(--link-color, var(--accent));
        display: inline-flex;
        align-items: baseline;
        gap: 4px;
    }

    .preview :global(.link-type-badge) {
        display: inline-block;
        font-size: 10px;
        font-weight: 600;
        color: var(--bg);
        padding: 1px 5px;
        border-radius: 3px;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        vertical-align: baseline;
    }

    .preview :global(.note-tag) {
        display: inline-block;
        background: var(--bg-button);
        color: var(--accent);
        padding: 1px 8px;
        border-radius: 10px;
        font-size: 13px;
        cursor: pointer;
        transition: background 0.15s;
    }

    .preview :global(.note-tag:hover) {
        background: var(--bg-button-hover);
    }

    .preview :global(code) {
        background: var(--bg-inset);
        padding: 1px 5px;
        border-radius: 3px;
        font-size: 11.5px;
        font-family: var(--font-mono);
        color: var(--text);
    }

    .preview :global(pre) {
        background: var(--bg-inset);
        border: 1px solid var(--border);
        padding: 12px 16px;
        border-radius: 6px;
        overflow-x: auto;
        margin: 0 0 16px;
    }

    .preview :global(pre code) {
        background: none;
        padding: 0;
        font-size: 12.5px;
        font-family: var(--font-mono);
    }

    /* Wrapper added by the fence renderer for any languaged code block —
       surfaces the language as a small uppercase eyebrow pinned to the
       top-right (§8.5). The bare `pre` inside keeps its borders + padding. */
    .preview :global(.code-block) {
        position: relative;
    }

    .preview :global(.code-block)::before {
        content: attr(data-language);
        position: absolute;
        top: 8px;
        right: 12px;
        font-family: var(--font-mono);
        font-size: 10px;
        color: var(--text-faint);
        letter-spacing: 0.08em;
        text-transform: uppercase;
        pointer-events: none;
        z-index: 1;
    }

    .preview :global(blockquote) {
        border-left: 3px solid var(--accent);
        margin: 0 0 12px;
        padding: 4px 16px;
        color: var(--text-muted);
    }

    /* Math (§8.6) — inline math chips against --bg-inset; block math
       in a bordered card matching the code-block / mermaid look. */
    .preview :global(.katex-inline) {
        padding: 1px 6px;
        background: var(--bg-inset);
        border: 1px solid var(--border);
        border-radius: 4px;
    }

    .preview :global(.math-block) {
        background: var(--bg-inset);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 16px 20px;
        margin: 0 0 16px;
        overflow-x: auto;
        text-align: center;
    }

    /* Callout styles live in global.css (#465) — Svelte's scoped
       :global() chain through @html-rendered children proved
       unreliable in HMR. */

    .preview :global(ul),
    .preview :global(ol) {
        margin: 0 0 12px;
        padding-left: 24px;
    }

    .preview :global(li) {
        margin: 4px 0;
    }

    .preview :global(table) {
        border-collapse: collapse;
        margin: 0 0 16px;
        width: 100%;
    }

    .preview :global(th),
    .preview :global(td) {
        border: 1px solid var(--border);
        padding: 8px 12px;
        text-align: left;
    }

    .preview :global(th) {
        background: var(--bg-button);
        font-weight: 600;
    }

    .preview :global(hr) {
        border: none;
        border-top: 1px solid var(--border);
        margin: 24px 0;
    }

    .preview :global(img) {
        max-width: 100%;
        border-radius: 4px;
    }

    .preview :global(.query-block) {
        margin: 0 0 16px;
    }

    .preview :global(.query-result-list) {
        list-style: none;
        padding: 0;
        margin: 0;
    }

    .preview :global(.query-result-list li) {
        padding: 4px 0;
        border-bottom: 1px solid var(--border);
    }

    .preview :global(.query-result-list li:last-child) {
        border-bottom: none;
    }

    .preview :global(.query-loading) {
        color: var(--text-muted);
        font-size: 13px;
        font-style: italic;
    }

    .preview :global(.query-empty) {
        color: var(--text-muted);
        font-size: 13px;
        font-style: italic;
    }

    .preview :global(.query-error) {
        color: var(--text-muted);
        font-size: 13px;
        background: var(--bg-button);
        padding: 8px 12px;
        border-radius: 4px;
    }

    .preview :global(.query-title) {
        font-size: 15px;
        font-weight: 600;
        margin: 0 0 8px;
        color: var(--text);
    }

    .preview :global(.query-result-table) {
        border-collapse: collapse;
        width: 100%;
        font-size: 13px;
    }

    .preview :global(.query-result-table th) {
        background: var(--bg-button);
        font-weight: 600;
        text-align: left;
        padding: 6px 12px;
        border: 1px solid var(--border);
    }

    .preview :global(.query-result-table td) {
        padding: 5px 12px;
        border: 1px solid var(--border);
    }

    .preview :global(.query-chart-wrapper) {
        position: relative;
        margin: 0 0 16px;
    }

    /* Compute-cell output block styles (#238). Visually mirror the
       query-directive outputs above so a SPARQL query-panel result and a
       SPARQL notebook-cell result look the same. */
    .preview :global(.compute-output) {
        margin: 0 0 12px;
        font-size: 13px;
    }

    .preview :global(.compute-output-table) {
        border-collapse: collapse;
        width: 100%;
    }

    .preview :global(.compute-output-table th) {
        background: var(--bg-button);
        font-weight: 600;
        text-align: left;
        padding: 6px 12px;
        border: 1px solid var(--border);
    }

    .preview :global(.compute-output-table td) {
        padding: 5px 12px;
        border: 1px solid var(--border);
    }

    .preview :global(.compute-output-text),
    .preview :global(.compute-output-json),
    .preview :global(.compute-output-raw) {
        background: var(--bg-button);
        padding: 8px 12px;
        border-radius: 4px;
        overflow-x: auto;
        white-space: pre-wrap;
        word-wrap: break-word;
    }

    .preview :global(.compute-output-error) {
        color: var(--text);
        background: var(--bg-button);
        border-left: 3px solid var(--accent);
        padding: 8px 12px;
        border-radius: 0 4px 4px 0;
        font-family: var(--font-mono, ui-monospace, monospace);
        white-space: pre-wrap;
    }

    /* Rich-output additions (#243). DataFrame tables get a max-height
       so a 1000-row dump doesn't push the rest of the note off-screen;
       overflow auto so the user can scroll inside the box. The footer
       sits below the scroll viewport so the row counts stay anchored
       while the user scrubs the rows. */
    .preview :global(.compute-output-table-wrap) {
        margin: 0 0 12px;
        border: 1px solid var(--border);
        border-radius: 4px;
        overflow: hidden;
    }

    .preview :global(.compute-output-table-wrap) :global(.compute-output-table) {
        max-height: 420px;
        display: block;
        overflow: auto;
    }

    .preview :global(.compute-output-table-wrap) :global(.compute-output-table thead) {
        position: sticky;
        top: 0;
        z-index: 1;
    }

    .preview :global(.compute-output-truncation) {
        margin: 0;
        padding: 6px 12px;
        background: var(--bg-button);
        border-top: 1px solid var(--border);
        font-size: 11px;
        color: var(--text-muted);
        font-style: italic;
    }

    .preview :global(.compute-output-image) {
        max-width: 100%;
        height: auto;
        border-radius: 4px;
        background: #fff; /* Many matplotlib figures save with transparent bg */
        cursor: zoom-in;
    }

    /* Local images from `![](path)` references (#244). Pre-hydration
       they're empty `<img>` placeholders; sized with a min-height so
       the page doesn't reflow when the data URL lands. The .broken
       state surfaces unresolvable paths so the user can spot the typo. */
    .preview :global(img.local-image) {
        max-width: 100%;
        height: auto;
        min-height: 1em;
    }

    .preview :global(img.local-image-broken) {
        outline: 1px dashed var(--accent);
        background: var(--bg-button);
        min-height: 80px;
    }

    .preview :global(img.local-image-broken)::after {
        content: 'image not found';
        color: var(--text-muted);
        font-size: 11px;
        font-style: italic;
    }

    /* Local audio/video players (#908). */
    .preview :global(video.local-media) {
        max-width: 100%;
        max-height: 70vh;
        border-radius: 6px;
        display: block;
        margin: 8px 0;
        background: #000;
    }

    .preview :global(audio.local-media) {
        width: 100%;
        margin: 8px 0;
    }

    .preview :global(.local-media-broken) {
        display: inline-block;
        outline: 1px dashed var(--accent);
        background: var(--bg-button);
        padding: 8px 12px;
        border-radius: 6px;
        color: var(--text-muted);
        font-size: 11px;
        font-style: italic;
    }

    .preview :global(.local-media-broken)::after {
        content: 'media not found';
    }

    .preview :global(.compute-output-image.zoomed) {
        cursor: zoom-out;
        max-width: none;
        max-height: 90vh;
    }

    .preview :global(.compute-output-svg) {
        background: #fff;
        padding: 8px;
        border-radius: 4px;
    }

    .preview :global(.compute-output-svg) :global(svg) {
        max-width: 100%;
        height: auto;
    }

    .preview :global(.compute-output-html) {
        /* Sanitised _repr_html_ output. Scope styling so the output's own
           inline styles don't bleed into the rest of the note: a CSS
           containment boundary keeps fonts / margins from escaping. */
        contain: content;
        background: var(--bg);
        padding: 8px 12px;
        border-radius: 4px;
        overflow-x: auto;
    }

    .preview :global(.compute-output-html) :global(table) {
        border-collapse: collapse;
    }

    .preview :global(.compute-output-html) :global(th),
    .preview :global(.compute-output-html) :global(td) {
        padding: 4px 10px;
        border: 1px solid var(--border);
    }

    /* Output overflow-menu button — sits in the top-right corner of each
       saveable compute output, shows ⋯ on hover of the wrapper. */
    .preview :global(.compute-output-wrap) {
        position: relative;
    }

    .preview :global(.compute-output-menu-btn) {
        position: absolute;
        top: 4px;
        right: 4px;
        background: var(--bg-button);
        color: var(--text-muted);
        border: 1px solid var(--border);
        border-radius: 3px;
        padding: 0 6px;
        font-size: 12px;
        line-height: 16px;
        cursor: pointer;
        opacity: 0;
        transition: opacity 0.1s;
    }

    .preview :global(.compute-output-wrap:hover .compute-output-menu-btn),
    .preview :global(.compute-output-menu-btn:focus) {
        opacity: 1;
    }

    .preview :global(.compute-output-menu-btn:hover) {
        color: var(--text);
    }

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

    /* Turtle (.ttl) source view. Replaces the markdown render for any
       file whose path ends in `.ttl` — running Turtle through markdown
       produces stray HTML from `@prefix` lines and IRI angle brackets
       that read as broken tags. Three lightweight token classes are
       enough to make structure scannable without resembling a full IDE
       syntax highlighter. */
    .preview :global(.ttl-source) {
        font-family: var(--font-mono, monospace);
        font-size: 13px;
        line-height: 1.5;
        white-space: pre-wrap;
        background: var(--bg);
        padding: 12px;
        border: 1px solid var(--border);
        border-radius: 4px;
        color: var(--text);
        overflow-x: auto;
    }

    .preview :global(.ttl-comment) {
        color: var(--text-muted);
        font-style: italic;
    }

    .preview :global(.ttl-directive) {
        color: var(--accent);
        font-weight: 600;
    }

    .preview :global(.ttl-iri) {
        color: var(--accent);
    }

    /* Runnable / collapsible fence wrappers. The fence renderer above
       wraps python / sparql / sql / mermaid bodies inside
       `.fence-block > .fence-toolbar + .fence-body`. The
       toolbar carries a tiny ▶ run button (runnable langs only, gated
       on the host wiring `onRunCell` + `onApplyCellOutputEdit`) and a
       ▾/▸ collapse toggle. The body shrinks to a single-line "code
       hidden" affordance when collapsed; the toolbar stays visible so
       the user can re-expand. */
    .preview :global(.fence-block) {
        margin: 0.6em 0;
        border: 1px solid var(--border);
        border-radius: 6px;
        overflow: hidden;
        background: var(--bg);
    }

    .preview :global(.fence-toolbar) {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        background: var(--bg-titlebar, var(--bg-sidebar));
        border-bottom: 1px solid var(--border);
        font-size: 11px;
    }

    .preview :global(.fence-lang) {
        color: var(--text-muted);
        text-transform: uppercase;
        letter-spacing: 0.05em;
        font-family: var(--font-mono, monospace);
        margin-right: auto;
    }

    .preview :global(.fence-run-btn),
    .preview :global(.fence-refresh-btn),
    .preview :global(.fence-collapse-btn) {
        border: 1px solid transparent;
        background: transparent;
        color: var(--text-muted);
        padding: 0 6px;
        height: 20px;
        border-radius: 3px;
        cursor: pointer;
        font-size: 11px;
        font-family: var(--font-mono, monospace);
    }

    .preview :global(.fence-run-btn:hover:not([disabled])),
    .preview :global(.fence-refresh-btn:hover),
    .preview :global(.fence-collapse-btn:hover) {
        background: var(--bg-button);
        color: var(--text);
        border-color: var(--border);
    }

    .preview :global(.fence-run-btn[disabled]) {
        opacity: 0.5;
        cursor: default;
    }

    .preview :global(.fence-body) {
        overflow: hidden;
    }

    .preview :global(.fence-body > pre) {
        margin: 0;
        border-radius: 0;
        border: none;
    }

    .preview :global(.fence-collapsed .fence-body) {
        display: none;
    }

    /* markdown-it-footnote output. The plugin emits a back-of-note
       `<section class="footnotes">` with an ordered list of footnote
       bodies, plus inline `<sup class="footnote-ref">` markers in the
       body text and `<a class="footnote-backref">` arrows on each
       footnote body item. Both directions of click are intercepted in
       `handleClick` above for smooth scroll + transient highlight. */
    .preview :global(.footnotes) {
        margin-top: 2em;
        padding-top: 1em;
        border-top: 1px solid var(--border);
        font-size: 13px;
        color: var(--text-muted);
    }

    .preview :global(.footnotes-list) {
        padding-left: 1.4em;
        margin: 0;
    }

    .preview :global(.footnote-item) {
        margin: 0.4em 0;
    }

    .preview :global(.footnote-item p) {
        margin: 0;
        display: inline;
    }

    .preview :global(.footnote-ref a) {
        text-decoration: none;
        color: var(--accent);
        padding: 0 2px;
    }

    .preview :global(.footnote-ref a:hover) {
        text-decoration: underline;
    }

    .preview :global(.footnote-backref) {
        text-decoration: none;
        color: var(--accent);
        margin-left: 4px;
    }

    .preview :global(.footnote-backref:hover) {
        text-decoration: underline;
    }

    /* Anchor-landing flash — set on the target element for ~1.2s
       after a smooth-scroll jump. Pulses the background so the user's
       eye locks onto the destination even if the scroll was short. */
    .preview :global(.anchor-landing) {
        animation: anchor-landing-pulse 1.2s ease-out;
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
