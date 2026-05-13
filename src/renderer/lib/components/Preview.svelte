<script lang="ts">
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
  import { installMath } from '../markdown/math-plugin';
  import { installCallouts } from '../markdown/callout-plugin';
  import { hydrateMermaidBlocks, invalidateMermaidTheme } from '../markdown/mermaid-renderer';
  import { getLinkType } from '../../../shared/link-types';
  import { slugify } from '../../../shared/slug';
  import { api } from '../ipc/client';
  import { normalizeSqlRows } from '../editor/sql-result';
  import { renderChart, type ChartHandle, type ChartConfig, type ChartSeries } from '../charts';
  import { sanitizeComputeOutputHtml } from '../compute-output-sanitize';
  import { getToolInfosByCategory } from '../tools/tool-registry';
  import mdFootnote from 'markdown-it-footnote';
  import { findRunnableFences, planOutputEdit, codeOf } from '../editor/output-block';
  import type { CellResult } from '../ipc/client';

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
  }: Props = $props();

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

  const RUNNABLE_LANGS = new Set(['python', 'py', 'python3', 'sparql', 'sql']);

  // Tool lists for the right-click menu's Learning / Analysis submenus.
  // Loaded once at mount — the registry is project-stable.
  const analysisTools = getToolInfosByCategory('analysis');
  const learningTools = getToolInfosByCategory('learning');

  // Query result cache: query text → results (survives re-renders)
  const queryCache = new Map<string, { results: unknown[]; error?: string }>();

  // Cite/quote metadata caches: id → resolved bundle (survives re-renders)
  interface CiteMeta {
    title?: string;
    creators: string[];
    year?: string;
    doi?: string;
    uri?: string;
  }
  interface QuoteMeta {
    citedText?: string;
    sourceTitle?: string;
    sourceCreator?: string;
    sourceYear?: string;
    page?: string;
    pageRange?: string;
    locationText?: string;
  }
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

  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true,
    highlight(str: string, lang: string) {
      if (lang && hljs.getLanguage(lang)) {
        try {
          return hljs.highlight(str, { language: lang }).value;
        } catch { /* fall through */ }
      }
      return '';
    },
  });
  installMath(md);
  installCallouts(md);
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
    if (slug) tokens[idx].attrSet('id', slug);
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
        tokens[idx].attrSet('id', `^${m[1]}`);
        // Strip the marker from what renders.
        inline.content = inline.content.replace(BLOCK_ID_RE, '');
        if (inline.children) {
          for (let i = inline.children.length - 1; i >= 0; i--) {
            const child = inline.children[i];
            if (child.type === 'text') {
              const stripped = child.content.replace(BLOCK_ID_RE, '');
              if (stripped !== child.content) { child.content = stripped; break; }
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
    while (k < tokens.length && tokens[k].type !== 'inline' && tokens[k].type !== 'list_item_close') k++;
    const inlineTok = k < tokens.length && tokens[k].type === 'inline' ? tokens[k] : null;
    if (inlineTok) {
      const m = inlineTok.content.match(TASK_ITEM_RE);
      if (m) {
        const checked = m[1] === 'x' || m[1] === 'X';
        // `map[0]` is 0-indexed within whatever source was passed to
        // `md.render` — which is the frontmatter-stripped content below.
        // Add the env-carried offset so the checkbox's data-task-line
        // points at the line index in the original note.
        const rawLine = tokens[idx].map?.[0] ?? -1;
        const line = rawLine >= 0 ? rawLine + ((env as { lineOffset?: number })?.lineOffset ?? 0) : -1;
        tokens[idx].attrSet('data-task-line', String(line));
        tokens[idx].attrJoin('class', 'task-list-item');
        // Strip the `[ ]` prefix from the inline's aggregate content and
        // from its first text child so the rendered output doesn't repeat it.
        inlineTok.content = inlineTok.content.replace(TASK_ITEM_RE, '');
        if (inlineTok.children) {
          for (let i = 0; i < inlineTok.children.length; i++) {
            if (inlineTok.children[i].type === 'text') {
              inlineTok.children[i].content = inlineTok.children[i].content.replace(TASK_ITEM_RE, '');
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
  md.inline.ruler.push('wiki_link', (state, silent) => {
    const src = state.src.slice(state.pos);
    // Match typed: [[type::target|display]] or [[type::target]]
    // Or plain: [[target|display]] or [[target]]
    const match = src.match(/^\[\[(?:([a-z][\w-]*)::)?((?:[^\]|])+?)(?:\|((?:[^\]])+?))?\]\]/);
    if (!match) return false;
    if (!silent) {
      const token = state.push('wiki_link', '', 0);
      const linkTypeName = match[1] ?? 'references';
      const target = match[2].trim();
      const display = match[3]?.trim() ?? target;
      token.meta = { target, display, linkType: linkTypeName };
    }
    state.pos += match[0].length;
    return true;
  });

  md.renderer.rules.wiki_link = (tokens, idx) => {
    const { target, display, linkType: typeName } = tokens[idx].meta;
    const linkType = getLinkType(typeName);
    if (typeName === 'references') {
      // Plain links render as before
      return `<a class="wiki-link" data-target="${escapeAttr(target)}">${escapeHtml(display)}</a>`;
    }
    // Cite/quote links get a placeholder class so the post-render effect can
    // swap the display text for resolved metadata when the user didn't supply
    // their own |display override.
    const hasOverride = display !== target;
    let extraClasses = '';
    let resolveData = '';
    if (linkType.targetKind === 'source') {
      extraClasses = ' cite-link';
      resolveData = ` data-source-id="${escapeAttr(target)}" data-display-override="${hasOverride ? '1' : '0'}"`;
    } else if (linkType.targetKind === 'excerpt') {
      extraClasses = ' quote-link';
      resolveData = ` data-excerpt-id="${escapeAttr(target)}" data-display-override="${hasOverride ? '1' : '0'}"`;
    }
    // Typed links render with a colored badge
    return `<a class="wiki-link typed-link${extraClasses}" data-target="${escapeAttr(target)}"${resolveData} style="--link-color: ${linkType.color}"><span class="link-type-badge" style="background: ${linkType.color}">${escapeHtml(linkType.label)}</span><span class="link-display">${escapeHtml(display)}</span></a>`;
  };

  // Tag plugin: #tag (but not inside URLs or after non-whitespace)
  md.inline.ruler.push('note_tag', (state, silent) => {
    // Must be at start or preceded by whitespace
    if (state.pos > 0 && state.src[state.pos - 1] !== ' ' && state.src[state.pos - 1] !== '\n') return false;

    const src = state.src.slice(state.pos);
    const match = src.match(/^#([a-zA-Z][\w-/]*)/);
    if (!match) return false;
    if (!silent) {
      const token = state.push('note_tag', '', 0);
      token.meta = { tag: match[1] };
    }
    state.pos += match[0].length;
    return true;
  });

  md.renderer.rules.note_tag = (tokens, idx) => {
    const { tag } = tokens[idx].meta;
    return `<span class="note-tag" data-tag="${escapeAttr(tag)}">#${escapeHtml(tag)}</span>`;
  };

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
    const tok = tokens[idx];
    const srcIdx = tok.attrIndex('src');
    if (srcIdx < 0) return self.renderToken(tokens, idx, options);
    const src = tok.attrs![srcIdx][1];
    if (/^(?:https?:|data:|file:|blob:|mailto:)/i.test(src) || src.startsWith('//')) {
      // Absolute / data URL — render normally.
      return self.renderToken(tokens, idx, options);
    }
    const rel = resolveRelativeImagePath(src, notePath);
    const altIdx = tok.attrIndex('alt');
    const alt = altIdx >= 0 ? tok.attrs![altIdx][1] : (tok.content ?? '');
    const titleIdx = tok.attrIndex('title');
    const title = titleIdx >= 0 ? ` title="${escapeAttr(tok.attrs![titleIdx][1])}"` : '';
    return `<img class="local-image" data-rel="${escapeAttr(rel)}" alt="${escapeAttr(alt)}"${title} />`;
  };

  // Compute-cell output blocks (#238). A ```output fence below an executable
  // fence carries the JSON payload the executor produced; render it as a
  // shape-specific artifact (table / error / text / pretty JSON) rather
  // than as a generic highlighted code block. Users editing the note in
  // source view still see the raw JSON and can delete the block to re-run.
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const tok = tokens[idx];
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
    if (info === 'output') {
      const source = findSourceFenceBefore(tokens, idx);
      return renderComputeOutput(tok.content, source);
    }
    if (info === 'mermaid') {
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

    // Runnable fences (python / sparql / sql) get a toolbar with a ▶
    // run button (when the host wired `onRunCell` + `onApplyCellOutputEdit`)
    // and a collapse toggle. The default highlighted-code body is
    // wrapped inside `.fence-body` so the toggle can hide it.
    const isRunnable = RUNNABLE_LANGS.has(info);
    if (isRunnable && openingLine !== null) {
      const isCollapsed = collapsedFences.has(openingLine);
      const isRunning = runningFences.has(openingLine);
      const canRun = !!(onRunCell && onApplyCellOutputEdit && notePath);
      const defaultRender = defaultFence
        ? defaultFence(tokens, idx, options, env, self)
        : self.renderToken(tokens, idx, options);
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

    return defaultFence
      ? defaultFence(tokens, idx, options, env, self)
      : self.renderToken(tokens, idx, options);
  };

  /**
   * Walk backwards from the output fence token to find the executable
   * fence that produced it. Returns null when anything other than
   * whitespace sits between the two — a loose sanity check that keeps
   * us from wiring a Save-as-note action to the wrong source when users
   * paste an isolated output block.
   */
  function findSourceFenceBefore(tokens: Token[], idx: number): { language: string; code: string } | null {
    const RUNNABLE = new Set(['sparql', 'sql', 'python']);
    for (let i = idx - 1; i >= 0; i--) {
      const t = tokens[i];
      if (t.type === 'fence') {
        const lang = (t.info ?? '').trim().split(/\s+/)[0]?.toLowerCase() ?? '';
        if (RUNNABLE.has(lang)) {
          return { language: lang, code: (t.content ?? '').replace(/\n$/, '') };
        }
        return null;
      }
      // Any heading / paragraph / blockquote between the two fences means
      // the output block isn't adjacent to a runnable source — bail.
      if (t.type === 'paragraph_open' || t.type === 'heading_open' ||
          t.type === 'blockquote_open' || t.type === 'bullet_list_open' ||
          t.type === 'ordered_list_open') {
        return null;
      }
    }
    return null;
  }

  /**
   * Resolve a relative `![](src)` reference against the note's
   * directory and normalise so `..` segments collapse. Returns a
   * project-rooted relative path (no leading `/`).
   */
  function resolveRelativeImagePath(src: string, fromNote: string | null | undefined): string {
    // Split off the note's parent directory. The regex form
    // `/\/[^/]*$/` would silently fall back to the full string when
    // there's no slash — i.e. for a project-root note like
    // `graph.md`, `noteDir` would become `graph.md` and downstream
    // resolution would treat the file itself as a directory (the
    // ENOTDIR symptom). Use a guarded lastIndexOf instead.
    const lastSlash = fromNote ? fromNote.lastIndexOf('/') : -1;
    const noteDir = lastSlash > 0 && fromNote ? fromNote.slice(0, lastSlash) : '';
    const baseSegments = noteDir ? noteDir.split('/') : [];
    const srcSegments = src.split('/');
    const out: string[] = [...baseSegments];
    for (const seg of srcSegments) {
      if (seg === '' || seg === '.') continue;
      if (seg === '..') {
        if (out.length > 0) out.pop();
        continue;
      }
      out.push(seg);
    }
    return out.join('/');
  }

  /**
   * Cache of {projectRelPath → data URL} for images referenced from
   * the rendered note. Survives re-renders so panning around a long
   * doc doesn't keep refetching the same `<img>` over and over.
   * Cleared when the active note changes (the path-keyed cache stays
   * project-scoped automatically since paths include the note dir).
   */
  const imageDataUrlCache = new Map<string, string>();

  /** MIME guess from a relative-path extension; data URLs need it explicit. */
  function mimeFromPath(rel: string): string {
    const ext = rel.toLowerCase().match(/\.([^./\\]+)$/)?.[1] ?? '';
    if (ext === 'png') return 'image/png';
    if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
    if (ext === 'gif') return 'image/gif';
    if (ext === 'webp') return 'image/webp';
    if (ext === 'svg') return 'image/svg+xml';
    if (ext === 'avif') return 'image/avif';
    return 'application/octet-stream';
  }

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

  function renderComputeOutput(content: string, source: { language: string; code: string } | null): string {
    let payload: unknown;
    try {
      payload = JSON.parse(content.trim());
    } catch {
      return `<pre class="compute-output compute-output-raw">${escapeHtml(content)}</pre>`;
    }
    const p = payload as { type?: string } & Record<string, unknown>;
    let inner: string;
    let saveable = false;
    if (!p || typeof p !== 'object' || typeof p.type !== 'string') {
      inner = `<pre class="compute-output compute-output-json">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`;
    } else if (p.type === 'error') {
      const message = typeof p.message === 'string' ? p.message : JSON.stringify(p.message);
      inner = `<div class="compute-output compute-output-error">${escapeHtml(message)}</div>`;
      // Errors aren't worth saving as notes; skip the overflow menu.
    } else if (p.type === 'text') {
      const value = typeof p.value === 'string' ? p.value : JSON.stringify(p.value);
      inner = `<pre class="compute-output compute-output-text">${escapeHtml(value)}</pre>`;
      saveable = true;
    } else if (p.type === 'table' && Array.isArray(p.columns) && Array.isArray(p.rows)) {
      const columns = p.columns as string[];
      const rows = p.rows as Array<Array<string | number | boolean | null>>;
      const totalRows = typeof p.totalRows === 'number' ? p.totalRows : null;
      const truncated = p.truncated === true;
      const headers = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
      const body = rows.map((r) => {
        const cells = r.map((v) => `<td>${escapeHtml(v == null ? '' : String(v))}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      // Truncation footer (#243): when the kernel capped rows, surface
      // the gap so the user knows there's more data than they can see
      // and can re-run with `df.tail(...)` / `.iloc[]` if they need it.
      const footer = truncated && totalRows
        ? `<p class="compute-output-truncation">Showing ${rows.length} of ${totalRows} rows · ${totalRows - rows.length} more hidden</p>`
        : '';
      inner = `<div class="compute-output-table-wrap"><table class="compute-output compute-output-table"><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>${footer}</div>`;
      saveable = true;
    } else if (p.type === 'json') {
      inner = `<pre class="compute-output compute-output-json">${escapeHtml(JSON.stringify(p.value, null, 2))}</pre>`;
      saveable = true;
    } else if (p.type === 'image' && (p.mime === 'image/png' || p.mime === 'image/svg+xml')) {
      // Inline image (#243). PNG → data URL with base64 payload; SVG →
      // raw markup wrapped in a div so the host stylesheet can scope it.
      // Click-to-zoom toggles a `.zoomed` class via the global compute
      // output click handler (App.svelte) — same affordance as save-as-note.
      const data = typeof p.data === 'string' ? p.data : '';
      if (p.mime === 'image/png') {
        inner = `<img class="compute-output compute-output-image" src="data:image/png;base64,${escapeAttr(data)}" alt="cell output" />`;
      } else {
        // SVG: insert raw markup. SVG is rendered inline, so any embedded
        // <script> would execute. Sanitize with the same DOMPurify config
        // the html branch uses.
        const safe = sanitizeComputeOutputHtml(data);
        inner = `<div class="compute-output compute-output-svg">${safe}</div>`;
      }
      saveable = true;
    } else if (p.type === 'html' && typeof p.html === 'string') {
      // _repr_html_ output (Seaborn styled tables, IPython.display.HTML, …).
      // DOMPurify with a strict allowlist — no <script>, no <iframe>,
      // no event handlers — so a malformed _repr_html_ from a user-side
      // library can't escape the output container.
      const safe = sanitizeComputeOutputHtml(p.html);
      inner = `<div class="compute-output compute-output-html">${safe}</div>`;
      saveable = true;
    } else {
      // Unknown type — show the raw JSON so the user can tell what came back.
      inner = `<pre class="compute-output compute-output-json">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>`;
    }

    // Wrap the rendered output with a ⋯ overflow-menu button when we have
    // enough context to offer save/copy actions — the output payload
    // parses cleanly, its type is saveable, and we found the source
    // fence it came from (so we know what cell to attribute back).
    if (saveable && source) {
      const outputB64 = btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
      const codeB64 = btoa(unescape(encodeURIComponent(source.code)));
      return `<div class="compute-output-wrap" data-source-language="${escapeAttr(source.language)}" data-source-code-b64="${outputB64.length > 0 ? codeB64 : ''}" data-output-b64="${outputB64}">
        <button class="compute-output-menu-btn" type="button" title="Output options">⋯</button>
        ${inner}
      </div>`;
    }
    return inner;
  }

  // Query directive plugin: :::query-list ... :::
  md.block.ruler.before('fence', 'query_directive', (state: StateBlock, startLine: number, endLine: number, silent: boolean) => {
    const startPos = state.bMarks[startLine] + state.tShift[startLine];
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
      const pos = state.bMarks[nextLine] + state.tShift[nextLine];
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
    token.meta = { type: directiveType, config };
    token.map = [startLine, nextLine + 1];
    state.line = nextLine + 1;
    return true;
  });

  md.renderer.rules.query_directive = (tokens: Token[], idx: number) => {
    const query = tokens[idx].content;
    const { type, config } = tokens[idx].meta as { type: string; config: Record<string, unknown> };
    const configJson = Object.keys(config).length > 0 ? escapeAttr(JSON.stringify(config)) : '';
    return `<div class="query-block" data-type="${escapeAttr(type)}" data-query="${escapeAttr(query)}"${configJson ? ` data-config="${configJson}"` : ''}><span class="query-loading">Loading...</span></div>`;
  };

  function escapeHtml(str: string): string {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeAttr(str: string): string {
    return escapeHtml(str).replace(/"/g, '&quot;');
  }

  function stripFrontmatter(text: string): string {
    return text.replace(/^---\n[\s\S]*?\n---\n?/, '');
  }

  function countFrontmatterLines(text: string): number {
    const m = text.match(/^---\n[\s\S]*?\n---\n?/);
    if (!m) return 0;
    return (m[0].match(/\n/g) ?? []).length;
  }

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
    return md.render(stripped, { lineOffset });
  }

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
      .replace(/^([ \t]*#.*)$/gm, '<span class="ttl-comment">$1</span>')
      .replace(/(@(?:prefix|base|keywords)\b)/g, '<span class="ttl-directive">$1</span>')
      .replace(/(&lt;[^&\s]*?&gt;)/g, '<span class="ttl-iri">$1</span>');
    return `<pre class="ttl-source">${highlighted}</pre>`;
  }

  const RENDER_DEBOUNCE_MS = 120;
  let rendered = $state(renderContent(content));
  let lastRendered = content;
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
      // Mermaid hydration (#467) — lazy-loads the library on first use,
      // replaces .mermaid-block placeholders with rendered SVG, surfaces
      // parse errors inline.
      if (previewEl) void hydrateMermaidBlocks(previewEl);
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
    if (previewEl) void hydrateMermaidBlocks(previewEl);
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
        if (id) refs.push({ kind: 'cite', id });
      } else {
        const id = el.dataset.excerptId;
        if (id) refs.push({ kind: 'quote', id });
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
      const el = links[i];
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
        target.scrollIntoView({ block: 'start', behavior: 'auto' });
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

  function collapseCiteRows(rows: Array<Record<string, string>>): CiteMeta {
    const meta: CiteMeta = { creators: [] };
    const creatorSet = new Set<string>();
    for (const row of rows) {
      if (row.title && !meta.title) meta.title = row.title;
      if (row.creator && !creatorSet.has(row.creator)) {
        creatorSet.add(row.creator);
        meta.creators.push(row.creator);
      }
      if (row.issued && !meta.year) meta.year = row.issued.slice(0, 4);
      if (row.doi && !meta.doi) meta.doi = row.doi;
      if (row.uri && !meta.uri) meta.uri = row.uri;
    }
    return meta;
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
        citedText: row.citedText,
        sourceTitle: row.sourceTitle,
        sourceCreator: row.sourceCreator,
        sourceYear: row.sourceIssued?.slice(0, 4),
        page: row.page,
        pageRange: row.pageRange,
        locationText: row.locationText,
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
    try { config = JSON.parse(el.dataset.config ?? '{}'); } catch { /* ignore */ }

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
          queryCache.set(cacheKey, { results: [], error: response.error });
          renderQueryResults(el, type ?? 'list', config, [], response.error);
          return;
        }
        results = normalizeSqlRows(response.columns, response.rows);
      } else {
        const response = await api.graph.query(QUERY_PREFIXES + query);
        results = response.results as Record<string, string>[];
      }
      queryCache.set(cacheKey, { results });
      renderQueryResults(el, type ?? 'list', config, results);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      queryCache.set(cacheKey, { results: [], error });
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
    const allCols = Object.keys(rows[0]);
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

    const allCols = Object.keys(rows[0]);
    const xCol = config.x ?? allCols[0];
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
      title: config.title,
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

  function handleClick(e: MouseEvent) {
    const el = e.target as HTMLElement;

    if (
      el instanceof HTMLInputElement &&
      el.type === 'checkbox' &&
      el.dataset.taskLine !== undefined
    ) {
      const line = parseInt(el.dataset.taskLine, 10);
      if (!Number.isNaN(line)) onTaskToggle?.(line);
      // Don't preventDefault — the native toggle gives an instant flicker-free
      // response. The content re-render will land the DOM in the same state.
      return;
    }

    const citeLink = el.closest<HTMLElement>('.cite-link');
    if (citeLink) {
      e.preventDefault();
      const sourceId = citeLink.dataset.sourceId;
      if (sourceId && onOpenSource) onOpenSource(sourceId);
      return;
    }

    const quoteLink = el.closest<HTMLElement>('.quote-link');
    if (quoteLink) {
      e.preventDefault();
      const excerptId = quoteLink.dataset.excerptId;
      if (excerptId && onOpenExcerpt) onOpenExcerpt(excerptId);
      return;
    }

    const wikiLink = el.closest<HTMLElement>('.wiki-link');
    if (wikiLink) {
      e.preventDefault();
      const linkTarget = wikiLink.dataset.target;
      if (linkTarget) onNavigate(linkTarget);
      return;
    }

    const tagEl = el.closest<HTMLElement>('.note-tag');
    if (tagEl) {
      e.preventDefault();
      const tag = tagEl.dataset.tag;
      if (tag && onTagSelect) onTagSelect(tag);
      return;
    }

    // Compute-output overflow menu (#244).
    const menuBtn = el.closest<HTMLElement>('.compute-output-menu-btn');
    if (menuBtn) {
      e.preventDefault();
      e.stopPropagation();
      const wrap = menuBtn.closest<HTMLElement>('.compute-output-wrap');
      if (!wrap) return;
      openOutputMenu(menuBtn, wrap);
      return;
    }

    // Click-to-zoom on inline compute output images (#243). Toggles
    // a `.zoomed` class so the stylesheet flips between thumbnail and
    // full-size views without a modal dialog.
    const outputImg = el.closest<HTMLElement>('.compute-output-image');
    if (outputImg && outputImg instanceof HTMLImageElement) {
      e.preventDefault();
      outputImg.classList.toggle('zoomed');
      return;
    }

    // Fence toolbar — collapse toggle + run button.
    const fenceBtn = el.closest<HTMLElement>('[data-fence-action]');
    if (fenceBtn) {
      e.preventDefault();
      e.stopPropagation();
      const action = fenceBtn.getAttribute('data-fence-action');
      const block = fenceBtn.closest<HTMLElement>('.fence-block');
      const lineAttr = block?.getAttribute('data-fence-line');
      const openingLine = lineAttr ? parseInt(lineAttr, 10) : NaN;
      if (!block || Number.isNaN(openingLine)) return;
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
        return;
      }
      if (action === 'run') {
        void runFenceAt(openingLine);
        return;
      }
    }

    // Internal anchor click (footnote ref ↔ body, heading anchor jumps,
    // etc.). The browser's native handling would scroll instantly and
    // also tack `#fn1` onto the URL hash — neither great for an
    // Electron renderer where the URL is `file:` or `chrome-error:`.
    // Intercept, smooth-scroll the matching id into view, no hash
    // mutation.
    const anchorEl = el.closest<HTMLAnchorElement>('a[href^="#"]');
    if (anchorEl) {
      const href = anchorEl.getAttribute('href') ?? '';
      const id = href.slice(1);
      if (id) {
        const target = previewEl?.querySelector<HTMLElement>(`#${CSS.escape(id)}`);
        if (target) {
          e.preventDefault();
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          // Brief highlight so the user's eye locks onto the landing
          // spot — especially useful for footnote bodies that may be
          // visually adjacent to their neighbors.
          target.classList.add('anchor-landing');
          setTimeout(() => target.classList.remove('anchor-landing'), 1200);
        }
      }
      return;
    }
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
    const fences = findRunnableFences(content, RUNNABLE_LANGS);
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
    noteMenu = { x: e.clientX, y: e.clientY };
    const close = (ev: MouseEvent) => {
      const t = ev.target as HTMLElement | null;
      if (t?.closest('.note-context-menu')) return;
      noteMenu = null;
      window.removeEventListener('click', close);
    };
    setTimeout(() => window.addEventListener('click', close), 0);
  }

  function runMenuAction(fn: (() => void) | undefined): void {
    if (fn) fn();
    noteMenu = null;
  }

  function adjustNoteSubmenu(event: MouseEvent): void {
    // Flip a submenu up/left if its default position (right of + below
    // the parent item) would extend past the viewport. Mirrors
    // Editor.svelte's adjustSubmenu.
    const item = event.currentTarget as HTMLElement;
    const submenu = item.querySelector<HTMLElement>(':scope > .submenu');
    if (!submenu) return;
    submenu.style.top = '';
    submenu.style.bottom = '';
    submenu.style.left = '';
    submenu.style.right = '';
    requestAnimationFrame(() => {
      const rect = submenu.getBoundingClientRect();
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      const MARGIN = 8;
      if (rect.bottom > vh - MARGIN) {
        submenu.style.top = 'auto';
        submenu.style.bottom = '-4px';
      }
      if (rect.right > vw - MARGIN) {
        submenu.style.left = 'auto';
        submenu.style.right = '100%';
      }
    });
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
        source: { language, code },
        output,
      };
      const close = (ev: MouseEvent) => {
        const target = ev.target as HTMLElement | null;
        if (target?.closest('.compute-output-menu')) return;
        outputMenu = null;
        window.removeEventListener('click', close);
      };
      setTimeout(() => window.addEventListener('click', close), 0);
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

  /**
   * RFC-4180-ish CSV: quote fields containing commas, quotes, or
   * newlines; double internal quotes; CRLF row terminator. Pasted into
   * Excel / Numbers / Sheets it parses back to the original table.
   */
  function tableToCsv(
    columns: string[],
    rows: Array<Array<string | number | boolean | null>>,
  ): string {
    const escape = (v: string | number | boolean | null): string => {
      if (v == null) return '';
      const s = String(v);
      if (/[",\r\n]/.test(s)) {
        return '"' + s.replace(/"/g, '""') + '"';
      }
      return s;
    };
    const lines = [columns.map(escape).join(','), ...rows.map((r) => r.map(escape).join(','))];
    return lines.join('\r\n');
  }

  function outputToMarkdownClipboard(output: import('../../../shared/compute/types').CellOutput): string {
    if (output.type === 'table') {
      if (output.columns.length === 0) return '*(empty result)*';
      const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
      const header = `| ${output.columns.map(esc).join(' | ')} |`;
      const divider = `| ${output.columns.map(() => '---').join(' | ')} |`;
      const body = output.rows.map((r) =>
        `| ${r.map((v) => esc(v == null ? '' : String(v))).join(' | ')} |`,
      );
      return [header, divider, ...body].join('\n');
    }
    if (output.type === 'text') return '```\n' + output.value.replace(/\n$/, '') + '\n```';
    if (output.type === 'json') return '```json\n' + JSON.stringify(output.value, null, 2) + '\n```';
    return '```\n' + JSON.stringify(output) + '\n```';
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
    } catch { return; }
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

  /**
   * Clone the footnote-body `<li>` minus its back-arrow anchor and the
   * surrounding `<p>` wrapper, leaving the bare body text. markdown-it-
   * footnote always wraps the body in one or more `<p>` elements with
   * a trailing `<a class="footnote-backref">↩</a>`; stripping the
   * backref and reusing the cleaned innerHTML keeps the tooltip a faithful
   * mini-render of the footnote prose (links, emphasis, code spans
   * all preserved).
   */
  function buildFootnoteTooltip(body: HTMLElement): string {
    const clone = body.cloneNode(true) as HTMLElement;
    for (const bk of clone.querySelectorAll('.footnote-backref')) bk.remove();
    return `<div class="tt-footnote">${clone.innerHTML.trim()}</div>`;
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

  function buildCiteTooltip(meta: CiteMeta): string {
    const parts: string[] = [];
    if (meta.title) parts.push(`<div class="tt-title">${escapeHtml(meta.title)}</div>`);
    const byline = formatFullByline(meta.creators, meta.year);
    if (byline) parts.push(`<div class="tt-byline">${escapeHtml(byline)}</div>`);
    if (meta.doi) parts.push(`<div class="tt-meta">DOI: ${escapeHtml(meta.doi)}</div>`);
    else if (meta.uri) parts.push(`<div class="tt-meta">${escapeHtml(meta.uri)}</div>`);
    return parts.join('') || `<div class="tt-meta">No metadata available</div>`;
  }

  function buildQuoteTooltip(meta: QuoteMeta): string {
    const parts: string[] = [];
    if (meta.citedText) {
      parts.push(`<div class="tt-quote">“${escapeHtml(meta.citedText)}”</div>`);
    }
    const src = meta.sourceTitle;
    const creator = meta.sourceCreator;
    const year = meta.sourceYear;
    const byline = [src, creator && year ? `${creator} (${year})` : creator || (year ? `(${year})` : '')]
      .filter(Boolean).join(' — ');
    if (byline) parts.push(`<div class="tt-byline">— ${escapeHtml(byline)}</div>`);
    const loc = meta.pageRange ? `pp. ${meta.pageRange}`
      : meta.page ? `p. ${meta.page}`
      : meta.locationText ? meta.locationText
      : '';
    if (loc) parts.push(`<div class="tt-meta">${escapeHtml(loc)}</div>`);
    return parts.join('') || `<div class="tt-meta">No excerpt metadata available</div>`;
  }

  function formatFullByline(creators: string[], year?: string): string {
    const who = creators.length === 0 ? ''
      : creators.length <= 3 ? creators.join(', ')
      : `${creators.slice(0, 3).join(', ')}, …`;
    if (who && year) return `${who} · ${year}`;
    return who || (year ?? '');
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div
  class="preview"
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
        <span class="submenu-trigger">Learning &#x25B8;</span>
        <div class="submenu">
          {#each learningTools as tool}
            <button onclick={() => runMenuAction(() => onToolInvoke?.(tool.id))}>{tool.name}</button>
          {/each}
        </div>
      </div>
    {/if}
    {#if onToolInvoke && analysisTools.length > 0}
      <div class="submenu-item" onmouseenter={adjustNoteSubmenu}>
        <span class="submenu-trigger">Analysis &#x25B8;</span>
        <div class="submenu">
          {#each analysisTools as tool}
            <button onclick={() => runMenuAction(() => onToolInvoke?.(tool.id))}>{tool.name}</button>
          {/each}
        </div>
      </div>
    {/if}
    {#if onToolInvoke}
      <div class="submenu-item" onmouseenter={adjustNoteSubmenu}>
        <span class="submenu-trigger">Research &#x25B8;</span>
        <div class="submenu">
          <button onclick={() => runMenuAction(() => onToolInvoke?.('research.decompose-into-claims'))}>Decompose into Claims</button>
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
        <span class="submenu-trigger">Open In &#x25B8;</span>
        <div class="submenu">
          <button onclick={() => { if (notePath) void api.shell.revealFile(notePath); noteMenu = null; }}>Reveal in Finder</button>
          <button onclick={() => { if (notePath) void api.shell.openInDefault(notePath); noteMenu = null; }}>Open in Default App</button>
          <button onclick={() => { if (notePath) void api.shell.openInTerminal(notePath); noteMenu = null; }}>Open in Terminal</button>
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
    font-family: 'SF Mono', 'Fira Code', monospace;
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

  .preview :global(h1) {
    font-size: 28px;
    font-weight: 600;
    margin: 0 0 16px;
    padding-bottom: 8px;
    border-bottom: 1px solid var(--border);
  }

  .preview :global(h2) {
    font-size: 22px;
    font-weight: 600;
    margin: 24px 0 12px;
  }

  .preview :global(h3) {
    font-size: 18px;
    font-weight: 600;
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

  .preview :global(.wiki-link) {
    color: var(--accent);
    cursor: pointer;
    border-bottom: 1px dashed var(--accent);
  }

  .preview :global(.wiki-link:hover) {
    opacity: 0.8;
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
    background: var(--bg-button);
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 13px;
    font-family: 'SF Mono', 'Fira Code', monospace;
  }

  .preview :global(pre) {
    background: var(--bg-code, var(--bg-titlebar));
    padding: 16px;
    border-radius: 8px;
    overflow-x: auto;
    margin: 0 0 16px;
  }

  .preview :global(pre code) {
    background: none;
    padding: 0;
    font-size: 13px;
  }

  .preview :global(blockquote) {
    border-left: 3px solid var(--accent);
    margin: 0 0 12px;
    padding: 4px 16px;
    color: var(--text-muted);
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
  .preview :global(.footnote-ref a:hover) { text-decoration: underline; }
  .preview :global(.footnote-backref) {
    text-decoration: none;
    color: var(--accent);
    margin-left: 4px;
  }
  .preview :global(.footnote-backref:hover) { text-decoration: underline; }
  /* Anchor-landing flash — set on the target element for ~1.2s
     after a smooth-scroll jump. Pulses the background so the user's
     eye locks onto the destination even if the scroll was short. */
  .preview :global(.anchor-landing) {
    animation: anchor-landing-pulse 1.2s ease-out;
  }
  @keyframes anchor-landing-pulse {
    0%   { background: var(--accent); color: var(--bg); }
    100% { background: transparent; color: inherit; }
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
  .note-context-menu button:hover { background: var(--bg-button); }
  .note-context-menu .submenu-item { position: relative; }
  .note-context-menu .submenu-trigger {
    display: block;
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
  .note-context-menu .submenu-item:hover > .submenu { display: block; }
  .note-context-menu .separator {
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }
</style>
