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
import { installCallouts } from '../../../shared/markdown/callout-plugin';
import { installWikiLinks, installNoteTags, installTransclusions } from '../markdown/inline-tokens-plugin';
import { installAnchors } from '../../../shared/markdown/anchor-plugin';
import { installFences } from '../markdown/fence-plugin';
import { escapeAttr } from './text';
import { splitQueryDirective, queryBlockPlaceholderHtml } from './query-directive';
import { resolveRelativeImagePath } from './image-paths';
import { mediaKind } from '../../../shared/media';
import { appImageMark } from './app-image-mark';
import { installImageSize, imageSizeOf, type ImageSizeMeta } from '../../../shared/markdown/image-size';
import { imageResizeFrame } from './embed-resize-markup';
import type { PreviewMarkdownDeps } from './markdown-deps';

export type { PreviewMarkdownDeps } from './markdown-deps';

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

    // Heading/block/task-list addressability (id-for-anchor stamping +
    // task-checkbox rendering) — see anchor-plugin.ts.
    installAnchors(md);

    // Wiki-link plugin: [[type::target|display]], [[type::target]], [[target|display]], [[target]]
    installWikiLinks(md);
    installNoteTags(md);
    installTransclusions(md);
    // `![alt|400](pic.png)` sizes (#2666) — the same rule every HTML export installs.
    installImageSize(md);

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
    md.renderer.rules.image = (tokens, idx, options, env, self) => {
        const tok = tokens[idx]!;
        const srcIdx = tok.attrIndex('src');
        if (srcIdx < 0) return self.renderToken(tokens, idx, options);
        const src = tok.attrs![srcIdx]![1] as string;
        if (/^(?:data:|file:|blob:|mailto:)/i.test(src)) {
            // Inline / already-local — render unchanged.
            return self.renderToken(tokens, idx, options);
        }
        // The alt text, size suffix stripped (#2666). markdown-it leaves the
        // `alt` attr empty and fills it from the label's children only in its
        // own renderer, which this rule replaces.
        const alt = self.renderInlineAsText(tok.children ?? [], options, env);
        const titleIdx = tok.attrIndex('title');
        const title = titleIdx >= 0 ? ` title="${escapeAttr(tok.attrs![titleIdx]![1] as string)}"` : '';
        const size = sizeAttrs(tok);
        if (/^https?:/i.test(src) || src.startsWith('//')) {
            // External network image — emit a cacheable placeholder. The remote
            // `src` is the immediate/offline-uncached fallback; the post-render
            // pass swaps in a locally-cached copy so it survives offline once
            // viewed (#...).
            const url = src.startsWith('//') ? `https:${src}` : src;
            return resizable(tok, `<img class="remote-image"${appImageMark()} data-remote-src="${escapeAttr(url)}" src="${escapeAttr(src)}" alt="${escapeAttr(alt)}"${title}${size} loading="lazy" />`);
        }
        const rel = resolveRelativeImagePath(src, deps.getRenderPathOverride() ?? deps.getNotePath());
        // Local audio/video (#908): emit a player placeholder hydrated to a blob URL
        // by the post-render pass (videos are too large to base64-inline like images).
        const kind = mediaKind(rel);
        if (kind === 'video') {
            return `<video class="local-media" data-rel="${escapeAttr(rel)}" controls preload="metadata"${title}></video>`;
        }
        if (kind === 'audio') {
            return `<audio class="local-media" data-rel="${escapeAttr(rel)}" controls preload="metadata"${title}></audio>`;
        }
        return resizable(tok, `<img class="local-image"${appImageMark()} data-rel="${escapeAttr(rel)}" alt="${escapeAttr(alt)}"${title}${size} />`);
    };

    /** ` width="…" height="…"` from the size suffix (#2666), or nothing. */
    function sizeAttrs(tok: Token): string {
        const { width, height } = imageSizeOf(tok);
        return (width !== null ? ` width="${width}"` : '') + (height !== null ? ` height="${height}"` : '');
    }

    /**
     * Wrap an image in its resize frame (#2666) when the host can write the
     * size back: a corner handle that drags, steps with the keyboard and
     * resets on double-click (`preview/embed-resize.ts`). An image inside a
     * transcluded fragment belongs to another note, and a table cell's image
     * can't be found in the source again, so neither gets one.
     */
    function resizable(tok: Token, img: string): string {
        const ref = (tok.meta as ImageSizeMeta | null)?.imageSource;
        if (!ref || !deps.getCanResize?.() || deps.getRenderPathOverride() !== null) return img;
        return imageResizeFrame(img, ref, imageSizeOf(tok).width);
    }

    // Custom fence rendering (output blocks, mermaid, vega, youtube, runnable
    // toolbar, default code-block wrap) — see fence-plugin.ts.
    installFences(md, deps);

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

        // Config above a `---`, query below — shared with the export renderer (#2512).
        const {query, config} = splitQueryDirective(body);

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
        return queryBlockPlaceholderHtml(type, query, config);
    };

    // Argument-map directive (#907): :::argument ... :::. Same config/body
    // split as query_directive (key: value lines above an optional `---`,
    // the focus wiki-link below) but its own rule/token/renderer — the data
    // shape (a graph neighborhood) doesn't fit the `query-*` family, and the
    // hydrator mounts a real component rather than building an HTML string
    // (see argument-map-renderer.ts).
    md.block.ruler.before('fence', 'argument_directive', (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
        const startPos = state.bMarks[startLine]! + state.tShift[startLine]!;
        const startMax = state.eMarks[startLine];
        const lineText = state.src.slice(startPos, startMax);

        if (!/^:::argument\s*$/.test(lineText)) return false;
        if (silent) return true;

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

        const contentStart = state.bMarks[startLine + 1];
        const contentEnd = state.bMarks[nextLine];
        const body = state.src.slice(contentStart, contentEnd).trim();

        const sepIdx = body.indexOf('\n---\n');
        const config: Record<string, string> = {};
        let focusBody: string;
        if (sepIdx >= 0) {
            const configBlock = body.slice(0, sepIdx).trim();
            focusBody = body.slice(sepIdx + 5).trim();
            for (const line of configBlock.split('\n')) {
                const colonIdx = line.indexOf(':');
                if (colonIdx > 0) {
                    const key = line.slice(0, colonIdx).trim();
                    const value = line.slice(colonIdx + 1).trim();
                    if (key && value) config[key] = value;
                }
            }
        } else {
            focusBody = body;
        }

        const token = state.push('argument_directive', 'div', 0);
        token.content = focusBody;
        token.meta = {config};
        token.map = [startLine, nextLine + 1];
        state.line = nextLine + 1;
        return true;
    });

    md.renderer.rules.argument_directive = (tokens: Token[], idx: number) => {
        const focus = tokens[idx]!.content;
        const {config} = tokens[idx]!.meta as { config: Record<string, unknown> };
        const configJson = Object.keys(config).length > 0 ? escapeAttr(JSON.stringify(config)) : '';
        return `<div class="argument-map-block" data-focus="${escapeAttr(focus)}"${configJson ? ` data-config="${configJson}"` : ''}></div>`;
    };

    return md;
}
