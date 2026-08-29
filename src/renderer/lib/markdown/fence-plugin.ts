/**
 * Custom fence rendering (#994; split out of `preview/markdown-config.ts` in
 * #1908 to finish that file's `install*` convention). The markdown-it fence
 * rule computes the shared context (token, 1-based source line) once, then
 * dispatches on the lowercased info string via `fenceRenderers`. Runnable
 * fences (a language-set membership test) and the default code-block
 * wrapper (the fallthrough) aren't keyable by a single info string, so
 * they're dispatched explicitly after the map lookup.
 *
 * Needs `PreviewMarkdownDeps` (the per-fence collapse/running sets and the
 * run-button gate) unlike the other `install*` plugins, which is why its
 * signature carries a second argument.
 */
import type { MarkdownIt, Token } from 'markdown-it';
import { detectDataSource } from '../../../shared/vega/data-binding';
import { RUNNABLE_LANGUAGE_SET } from '../../../shared/compute/fences';
import { renderYouTubeFence } from './youtube-embed';
import { findSourceFenceBefore, renderComputeOutput } from '../preview/compute-output-render';
import type { PreviewMarkdownDeps } from '../preview/markdown-deps';

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

export function installFences(md: MarkdownIt, deps: PreviewMarkdownDeps): void {
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
        // the YAML frontmatter stripped (see `renderContent` in Preview.svelte).
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
}
