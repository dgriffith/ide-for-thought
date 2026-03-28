<script lang="ts">
  import MarkdownIt from 'markdown-it';
  import hljs from 'highlight.js';
  import 'highlight.js/styles/github-dark.min.css';

  interface Props {
    content: string;
    onNavigate: (target: string) => void;
    onTagSelect?: (tag: string) => void;
  }

  let { content, onNavigate, onTagSelect }: Props = $props();

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

  // Wiki-link plugin: [[target]] or [[target|display]]
  md.inline.ruler.push('wiki_link', (state, silent) => {
    const src = state.src.slice(state.pos);
    const match = src.match(/^\[\[([^\]]+)\]\]/);
    if (!match) return false;
    if (!silent) {
      const token = state.push('wiki_link', '', 0);
      const parts = match[1].split('|');
      token.meta = {
        target: parts[0].trim(),
        display: (parts[1] ?? parts[0]).trim(),
      };
    }
    state.pos += match[0].length;
    return true;
  });

  md.renderer.rules.wiki_link = (tokens, idx) => {
    const { target, display } = tokens[idx].meta;
    return `<a class="wiki-link" data-target="${escapeAttr(target)}">${escapeHtml(display)}</a>`;
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
<div class="preview" onclick={handleClick}>
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
</style>
