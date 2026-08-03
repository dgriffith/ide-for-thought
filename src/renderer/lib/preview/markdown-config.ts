// Markdown-It configuration for the note preview, split out of Preview.svelte
// (#1087). `createPreviewMarkdown(deps)` constructs the fully-configured
// MarkdownIt instance: every custom renderer rule (heading/paragraph/list-item
// anchors, the relative-image rule, the fence dispatcher and its sub-renderers,
// the `:::query-…` block directive) plus the plugin battery. The rules close
// over a handful of live component values — the collapse/running fence sets, the
// current note path, the transcluded-fragment path override, and whether a
// runnable fence's ▶ button should show — which are threaded via `deps` so the
// instance stays a single, stable object the component builds once. Sets are
// shared by reference (mutation-driven re-renders still work); everything that
// changes over the component's life is read through a getter.

import MarkdownIt from 'markdown-it';
// Type-only deep imports — the Token *value* is recovered from
// `inlineTok.constructor` (#347), so no runtime import is needed. These type
// paths don't resolve through `@types/markdown-it`'s `export = X` shape under
// isolatedModules, but type-only imports don't ship to the bundler.
import type { Token, MarkdownIt as MarkdownItInstance } from 'markdown-it';
import type { StateBlock } from 'markdown-it';
import mdFootnote from 'markdown-it-footnote';
import { installMath } from '../../../shared/markdown/math-plugin';
import { installDoiAutolink } from '../../../shared/markdown/doi-plugin';
import { installHighlight } from '../../../shared/markdown/highlight-plugin';
import { installCallouts } from '../markdown/callout-plugin';
import { installWikiLinks, installNoteTags, installTransclusions } from '../markdown/inline-tokens-plugin';
import { renderYouTubeFence } from '../markdown/youtube-embed';
import { detectDataSource } from '../../../shared/vega/data-binding';
import { slugify } from '../../../shared/slug';
import { escapeAttr } from './text';
import { resolveRelativeImagePath } from './image-paths';
import { mediaKind } from '../../../shared/media';
import { RUNNABLE_LANGUAGE_SET } from '../../../shared/compute/fences';
import { findSourceFenceBefore, renderComputeOutput } from './compute-output-render';

export interface PreviewMarkdownDeps {
    /** Per-fence collapse state, keyed by the fence's opening source line.
     *  Shared by reference so a toggle-driven re-render reflects the change. */
    collapsedFences: Set<number>;
    /** Per-fence running state (disables the ▶ button while a cell is in
     *  flight). Shared by reference. */
    runningFences: Set<number>;
    /** The transclusion path override — set while rendering an embedded
     *  fragment so relative image paths resolve against the embedded note. */
    getRenderPathOverride: () => string | null;
    /** The note being rendered (used to resolve relative image paths). */
    getNotePath: () => string | null;
    /** Whether a runnable fence should show its ▶ button — i.e. the host wired
     *  `onRunCell` + `onApplyCellOutputEdit` and a note path is known. */
    getCanRun: () => boolean;
}

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

export function createPreviewMarkdown(deps: PreviewMarkdownDeps): MarkdownItInstance {
    const md = new MarkdownIt({
        html: true,
        linkify: true,
        typographer: true,
        // No synchronous `highlight` (perf #1114). hljs.highlight is O(code
        // size) and, inside md.render, runs on the critical debounced-render
        // path — a large note with many/large fences blocks the main thread
        // before anything paints. Instead markdown-it emits plain escaped code
        // carrying its `language-…` class, and `highlightCodeBlocks()` applies
        // hljs to each block in a post-render pass (off the critical path,
        // after paint). Output is identical — the same hljs span markup — just
        // computed later.
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
        const src = tok.attrs![srcIdx]![1] as string;
        if (/^(?:data:|file:|blob:|mailto:)/i.test(src)) {
            // Inline / already-local — render unchanged.
            return self.renderToken(tokens, idx, options);
        }
        if (/^https?:/i.test(src) || src.startsWith('//')) {
            // External network image — emit a cacheable placeholder. The remote
            // `src` is the immediate/offline-uncached fallback; the post-render
            // pass swaps in a locally-cached copy so it survives offline once
            // viewed (#...).
            const url = src.startsWith('//') ? `https:${src}` : src;
            const altIdx = tok.attrIndex('alt');
            const alt = altIdx >= 0 ? (tok.attrs![altIdx]![1] as string) : (tok.content ?? '');
            const titleIdx = tok.attrIndex('title');
            const title = titleIdx >= 0 ? ` title="${escapeAttr(tok.attrs![titleIdx]![1] as string)}"` : '';
            return `<img class="remote-image" data-remote-src="${escapeAttr(url)}" src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${title} loading="lazy" />`;
        }
        const rel = resolveRelativeImagePath(src, deps.getRenderPathOverride() ?? deps.getNotePath());
        const altIdx = tok.attrIndex('alt');
        const alt = altIdx >= 0 ? (tok.attrs![altIdx]![1] as string) : (tok.content ?? '');
        const titleIdx = tok.attrIndex('title');
        const title = titleIdx >= 0 ? ` title="${escapeAttr(tok.attrs![titleIdx]![1] as string)}"` : '';
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
            const isCollapsed = deps.collapsedFences.has(openingLine);
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
            const isCollapsed = deps.collapsedFences.has(openingLine);
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
        const isCollapsed = deps.collapsedFences.has(openingLine);
        const isRunning = deps.runningFences.has(openingLine);
        const canRun = deps.getCanRun();
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
        const config: Record<string, string> = {};
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

    return md;
}
