<script lang="ts">
  import MarkdownIt from 'markdown-it';
  import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs';
  import hljs from 'highlight.js';
  import 'highlight.js/styles/github-dark.min.css';
  import { getLinkType } from '../../../shared/link-types';
  import { api } from '../ipc/client';
  import { renderChart, type ChartHandle, type ChartConfig, type ChartSeries } from '../charts';

  interface Props {
    content: string;
    onNavigate: (target: string) => void;
    onTagSelect?: (tag: string) => void;
  }

  let { content, onNavigate, onTagSelect }: Props = $props();

  // Query result cache: query text → results (survives re-renders)
  const queryCache = new Map<string, { results: unknown[]; error?: string }>();

  // Cite-label cache: sourceId → resolved label text (survives re-renders)
  const citeLabelCache = new Map<string, string>();

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
    // Cite links get a placeholder class so the post-render effect can
    // swap the display text for "Title — Author (Year)" when the user
    // didn't supply their own |display override.
    const extraClasses = linkType.targetKind === 'source' ? ' cite-link' : '';
    const hasOverride = display !== target;
    const citeData = linkType.targetKind === 'source'
      ? ` data-source-id="${escapeAttr(target)}" data-display-override="${hasOverride ? '1' : '0'}"`
      : '';
    // Typed links render with a colored badge
    return `<a class="wiki-link typed-link${extraClasses}" data-target="${escapeAttr(target)}"${citeData} style="--link-color: ${linkType.color}"><span class="link-type-badge" style="background: ${linkType.color}">${escapeHtml(linkType.label)}</span><span class="link-display">${escapeHtml(display)}</span></a>`;
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

  let rendered = $derived(md.render(stripFrontmatter(content)));
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
    });
  });

  async function resolveCiteLabel(el: HTMLElement) {
    const sourceId = el.dataset.sourceId;
    if (!sourceId) return;
    // Don't overwrite user-supplied [[cite::id|display]] text.
    if (el.dataset.displayOverride === '1') return;

    const displayEl = el.querySelector<HTMLSpanElement>('.link-display');
    if (!displayEl) return;

    const cached = citeLabelCache.get(sourceId);
    if (cached) { displayEl.textContent = cached; return; }

    try {
      const idEsc = sourceId.replace(/"/g, '\\"');
      const sparql = `SELECT ?title ?creator ?issued WHERE {
        ?src minerva:sourceId "${idEsc}" .
        OPTIONAL { ?src dc:title ?title }
        OPTIONAL { ?src dc:creator ?creator }
        OPTIONAL { ?src dc:issued ?issued }
      } LIMIT 1`;
      const response = await api.graph.query(QUERY_PREFIXES + sparql);
      const row = response.results[0] as Record<string, string> | undefined;
      const label = formatCiteLabel(sourceId, row);
      citeLabelCache.set(sourceId, label);
      displayEl.textContent = label;
    } catch {
      // Fall back to the source-id already rendered.
    }
  }

  function formatCiteLabel(sourceId: string, row: Record<string, string> | undefined): string {
    if (!row) return sourceId;
    const title = row.title;
    const creator = row.creator;
    const year = row.issued ? row.issued.slice(0, 4) : '';
    const byline = creator && year ? `${creator} (${year})` : creator || (year ? `(${year})` : '');
    if (title && byline) return `${title} — ${byline}`;
    if (title) return title;
    if (byline) return byline;
    return sourceId;
  }

  async function executeQueryBlock(el: HTMLElement) {
    const query = el.dataset.query;
    const type = el.dataset.type;
    if (!query) return;

    let config: Record<string, string> = {};
    try { config = JSON.parse(el.dataset.config ?? '{}'); } catch { /* ignore */ }

    // Check cache first
    const cached = queryCache.get(query);
    if (cached) {
      renderQueryResults(el, type ?? 'list', config, cached.results, cached.error);
      return;
    }

    el.innerHTML = '<span class="query-loading">Loading...</span>';

    try {
      const prefixed = QUERY_PREFIXES + query;
      const response = await api.graph.query(prefixed);
      const results = response.results;
      queryCache.set(query, { results });
      renderQueryResults(el, type ?? 'list', config, results);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      queryCache.set(query, { results: [], error });
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
    }
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
<div class="preview" bind:this={previewEl} onclick={handleClick}>
  {@html rendered}
</div>

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
</style>
