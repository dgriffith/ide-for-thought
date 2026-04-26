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
  import { getLinkType } from '../../../shared/link-types';
  import { slugify } from '../../../shared/slug';
  import { api } from '../ipc/client';
  import { normalizeSqlRows } from '../editor/sql-result';
  import { renderChart, type ChartHandle, type ChartConfig, type ChartSeries } from '../charts';

  interface Props {
    content: string;
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
  }

  let { content, onNavigate, onTagSelect, onOpenSource, onOpenExcerpt, pendingAnchor = null, onAnchorResolved, onTaskToggle, onSaveCellOutput }: Props = $props();

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

  // Compute-cell output blocks (#238). A ```output fence below an executable
  // fence carries the JSON payload the executor produced; render it as a
  // shape-specific artifact (table / error / text / pretty JSON) rather
  // than as a generic highlighted code block. Users editing the note in
  // source view still see the raw JSON and can delete the block to re-run.
  const defaultFence = md.renderer.rules.fence;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const tok = tokens[idx];
    if (tok.info.trim() === 'output') {
      const source = findSourceFenceBefore(tokens, idx);
      return renderComputeOutput(tok.content, source);
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
      const headers = columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('');
      const body = rows.map((r) => {
        const cells = r.map((v) => `<td>${escapeHtml(v == null ? '' : String(v))}</td>`).join('');
        return `<tr>${cells}</tr>`;
      }).join('');
      inner = `<table class="compute-output compute-output-table"><thead><tr>${headers}</tr></thead><tbody>${body}</tbody></table>`;
      saveable = true;
    } else if (p.type === 'json') {
      inner = `<pre class="compute-output compute-output-json">${escapeHtml(JSON.stringify(p.value, null, 2))}</pre>`;
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

  md.renderer.rules.query_directive = (tokens: any[], idx: number) => {
    const query = tokens[idx].content;
    const { type, config } = tokens[idx].meta;
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
    const stripped = stripFrontmatter(c);
    const lineOffset = countFrontmatterLines(c);
    return md.render(stripped, { lineOffset });
  }

  const RENDER_DEBOUNCE_MS = 120;
  let rendered = $state(renderContent(content));
  let lastRendered = content;
  let renderTimer: ReturnType<typeof setTimeout> | null = null;

  $effect(() => {
    // Track content reactively; bail if nothing actually changed since
    // the last render commit (avoids re-running for derived state that
    // happens to share a frame).
    const c = content;
    if (c === lastRendered) return;

    if (renderTimer) clearTimeout(renderTimer);
    renderTimer = setTimeout(() => {
      rendered = renderContent(c);
      lastRendered = c;
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
    });
  });

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

  function applyCiteMeta(el: HTMLElement, displayEl: HTMLSpanElement, sourceId: string, meta: CiteMeta) {
    el.dataset.tooltipKind = 'cite';
    el.dataset.tooltipPayload = JSON.stringify(meta);
    if (el.dataset.displayOverride !== '1') {
      displayEl.textContent = formatCiteLabel(sourceId, meta);
    }
  }

  function formatCiteLabel(sourceId: string, meta: CiteMeta): string {
    const title = meta.title;
    const byline = formatByline(meta.creators, meta.year);
    if (title && byline) return `${title} — ${byline}`;
    if (title) return title;
    if (byline) return byline;
    return sourceId;
  }

  function formatByline(creators: string[], year?: string): string {
    const who = creators.length === 0 ? ''
      : creators.length === 1 ? creators[0]
      : creators.length === 2 ? `${creators[0]} and ${creators[1]}`
      : `${creators[0]} et al.`;
    if (who && year) return `${who} (${year})`;
    if (who) return who;
    if (year) return `(${year})`;
    return '';
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

  function applyQuoteMeta(el: HTMLElement, displayEl: HTMLSpanElement, excerptId: string, meta: QuoteMeta) {
    el.dataset.tooltipKind = 'quote';
    el.dataset.tooltipPayload = JSON.stringify(meta);
    if (el.dataset.displayOverride !== '1') {
      displayEl.textContent = formatQuoteLabel(excerptId, meta);
    }
  }

  function formatQuoteLabel(excerptId: string, meta: QuoteMeta): string {
    const quoted = meta.citedText;
    const src = meta.sourceTitle || meta.sourceCreator;
    const snippet = quoted ? truncate(quoted, 80) : '';
    if (snippet && src) return `“${snippet}” — ${src}`;
    if (snippet) return `“${snippet}”`;
    if (src) return src;
    return excerptId;
  }

  function truncate(s: string, max: number): string {
    if (s.length <= max) return s;
    return s.slice(0, max - 1).trimEnd() + '…';
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
    }
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
    const el = (e.target as HTMLElement | null)?.closest<HTMLElement>('.cite-link, .quote-link');
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
    const leaving = (e.target as HTMLElement | null)?.closest<HTMLElement>('.cite-link, .quote-link');
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
  onmouseover={handleMouseOver}
  onmouseout={handleMouseOut}
>
  {@html rendered}
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
</style>
