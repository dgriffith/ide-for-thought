/**
 * Minerva's custom inline markdown-it tokens (#672), extracted from Preview.svelte
 * to match the existing install-plugin pattern (installMath / installCallouts / …):
 *
 *  - wiki links: `[[target]]`, `[[target|display]]`, `[[type::target|display]]`
 *  - note tags:  `#tag`
 *
 * Pure token → HTML; the rendered markup carries data-attributes the Preview's
 * post-render passes use to resolve cite/quote labels and wire click handling.
 */

import type MarkdownIt from 'markdown-it';
import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs';
import { getLinkType } from '../../../shared/link-types';
import { escapeHtml, escapeAttr } from '../preview/text';

/**
 * Transclusion embeds (#906) — a line that is solely `![[target]]`,
 * `![[target#Heading]]`, or `![[target^block]]` becomes a block-level
 * placeholder the Preview's post-render pass fills with the embedded
 * content. A block rule (not inline) so the embedded content isn't
 * trapped inside a `<p>`, and so mid-sentence `![[x]]` is left alone.
 */
export function installTransclusions(md: MarkdownIt): void {
  md.block.ruler.before('fence', 'transclusion', (state: StateBlock, startLine: number, _endLine: number, silent: boolean) => {
    const pos = state.bMarks[startLine]! + state.tShift[startLine]!;
    const max = state.eMarks[startLine]!;
    const line = state.src.slice(pos, max).trim();
    const match = line.match(/^!\[\[([^\]]+?)\]\]$/);
    if (!match) return false;
    if (silent) return true;
    state.line = startLine + 1;
    const token = state.push('transclusion', 'div', 0);
    token.map = [startLine, state.line];
    token.meta = { embed: match[1]!.trim() };
    token.block = true;
    return true;
  });

  md.renderer.rules.transclusion = (tokens, idx) => {
    const { embed } = tokens[idx]!.meta as { embed: string };
    return `<div class="transclusion" data-embed="${escapeAttr(embed)}">`
      + `<div class="transclusion-loading">${escapeHtml(embed)}</div></div>\n`;
  };
}

/** `[[…]]` wiki links — plain, with display override, and typed (`type::`). */
export function installWikiLinks(md: MarkdownIt): void {
  md.inline.ruler.push('wiki_link', (state, silent) => {
    const src = state.src.slice(state.pos);
    // [[type::target|display]] / [[type::target]] / [[target|display]] / [[target]]
    const match = src.match(/^\[\[(?:([a-z][\w-]*)::)?((?:[^\]|])+?)(?:\|((?:[^\]])+?))?\]\]/);
    if (!match) return false;
    if (!silent) {
      const token = state.push('wiki_link', '', 0);
      const linkTypeName = match[1] ?? 'references';
      const target = match[2]!.trim();
      const display = match[3]?.trim() ?? target;
      token.meta = { target, display, linkType: linkTypeName };
    }
    state.pos += match[0].length;
    return true;
  });

  md.renderer.rules.wiki_link = (tokens, idx) => {
    const { target, display, linkType: typeName } = tokens[idx]!.meta as {
      target: string;
      display: string;
      linkType: string;
    };
    const linkType = getLinkType(typeName);
    if (typeName === 'references') {
      // Plain links render as a bare wiki-link.
      return `<a class="wiki-link" data-target="${escapeAttr(target)}">${escapeHtml(display)}</a>`;
    }
    // Cite/quote links get a placeholder class so the post-render effect can swap
    // the display text for resolved metadata when the user didn't supply their
    // own |display override.
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
    // Typed links render with a colored badge.
    return `<a class="wiki-link typed-link${extraClasses}" data-target="${escapeAttr(target)}"${resolveData} style="--link-color: ${linkType.color}"><span class="link-type-badge" style="background: ${linkType.color}">${escapeHtml(linkType.label)}</span><span class="link-display">${escapeHtml(display)}</span></a>`;
  };
}

/** `#tag` note tags — at line start or after whitespace (not mid-URL). */
export function installNoteTags(md: MarkdownIt): void {
  md.inline.ruler.push('note_tag', (state, silent) => {
    // Must be at start or preceded by whitespace.
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
    const { tag } = tokens[idx]!.meta as { tag: string };
    return `<span class="note-tag" data-tag="${escapeAttr(tag)}">#${escapeHtml(tag)}</span>`;
  };
}
