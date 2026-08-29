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
import { installAnchors } from '../markdown/anchor-plugin';
import { installFences } from '../markdown/fence-plugin';
import { escapeAttr } from './text';
import { resolveRelativeImagePath } from './image-paths';
import { mediaKind } from '../../../shared/media';
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
