<script lang="ts">
  import MarkdownIt from 'markdown-it';
  import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs';
  import hljs from 'highlight.js';
  import 'highlight.js/styles/github-dark.min.css';
  import { getLinkType } from '../../../shared/link-types';
  import { api } from '../ipc/client';

  interface Props {
    content: string;
    onNavigate: (target: string) => void;
    onTagSelect?: (tag: string) => void;
  }

  let { content, onNavigate, onTagSelect }: Props = $props();

  // Query result cache: query text → results (survives re-renders)
  const queryCache = new Map<string, { results: unknown[]; error?: string }>();

  const QUERY_PREFIXES = `PREFIX minerva: <https://minerva.dev/ontology#>
PREFIX dc: <http://purl.org/dc/terms/>
PREFIX rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX xsd: <http://www.w3.org/2001/XMLSchema#>
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
    // Typed links render with a colored badge
    return `<a class="wiki-link typed-link" data-target="${escapeAttr(target)}" style="--link-color: ${linkType.color}"><span class="link-type-badge" style="background: ${linkType.color}">${escapeHtml(linkType.label)}</span>${escapeHtml(display)}</a>`;
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

    // Extract query content between the fences
    const contentStart = state.bMarks[startLine + 1];
    const contentEnd = state.bMarks[nextLine];
    const queryContent = state.src.slice(contentStart, contentEnd).trim();

    const token = state.push('query_directive', 'div', 0);
    token.content = queryContent;
    token.meta = { type: directiveType };
    token.map = [startLine, nextLine + 1];
    state.line = nextLine + 1;
    return true;
  });

  md.renderer.rules.query_directive = (tokens: any[], idx: number) => {
    const query = tokens[idx].content;
    const type = tokens[idx].meta.type;
    return `<div class="query-block" data-type="${escapeAttr(type)}" data-query="${escapeAttr(query)}"><span class="query-loading">Loading...</span></div>`;
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

  // After render, find query-block placeholders and execute queries
  $effect(() => {
    rendered; // track dependency on rendered HTML
    requestAnimationFrame(() => {
      const blocks = previewEl?.querySelectorAll('.query-block');
      blocks?.forEach((el) => executeQueryBlock(el as HTMLElement));
    });
  });

  async function executeQueryBlock(el: HTMLElement) {
    const query = el.dataset.query;
    const type = el.dataset.type;
    if (!query) return;

    // Check cache first
    const cached = queryCache.get(query);
    if (cached) {
      renderQueryResults(el, type ?? 'list', cached.results, cached.error);
      return;
    }

    el.innerHTML = '<span class="query-loading">Loading...</span>';

    try {
      const prefixed = QUERY_PREFIXES + query;
      const response = await api.graph.query(prefixed);
      const results = response.results;
      queryCache.set(query, { results });
      renderQueryResults(el, type ?? 'list', results);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      queryCache.set(query, { results: [], error });
      renderQueryResults(el, type ?? 'list', [], error);
    }
  }

  function renderQueryResults(el: HTMLElement, type: string, results: unknown[], error?: string) {
    if (error) {
      el.innerHTML = `<p class="query-error">${escapeHtml(error)}</p>`;
      return;
    }

    if (type === 'list') {
      const items = (results as Record<string, string>[]).map((r) => {
        const title = r.title ?? r.name ?? r.label ?? r.path ?? 'Untitled';
        const path = r.path ?? '';
        if (path) {
          return `<li><a class="wiki-link" data-target="${escapeAttr(path)}">${escapeHtml(title)}</a></li>`;
        }
        return `<li>${escapeHtml(title)}</li>`;
      });
      el.innerHTML = items.length > 0
        ? `<ul class="query-result-list">${items.join('')}</ul>`
        : '<p class="query-empty">No results</p>';
    } else {
      el.innerHTML = `<p class="query-error">Unknown directive type: ${escapeHtml(type)}</p>`;
    }
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
    background: var(--bg-titlebar);
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
</style>
