/**
 * A block-level link rendered for export (#2526, epic #2508) the way the
 * preview renders it: the paragraph through the preview's own wiki-link
 * plugin, then the preview's own `hydrateTypedCards` — a typed note becomes
 * its object card (cover + card fields), a `[[quote::id]]` its excerpt card —
 * snapshotted in the light theme.
 *
 * When the preview wouldn't make a card (an untyped note, an unresolvable
 * link) this returns '' and the export renders the paragraph as an ordinary
 * link under its own link policy, exactly as before.
 */
import MarkdownIt from 'markdown-it';
import { installWikiLinks } from '../markdown/inline-tokens-plugin';
import { hydrateTypedCards } from '../preview/typed-link-render';
import { QUERY_PREFIXES } from '../preview/query-prefixes';
import { snapshotLiveBlock } from './live-block-snapshot';
import { EXPORT_BLOCK_WIDTH_PX } from './render-object-view';
import { previewWikiResolver } from './wiki-resolver';

export async function renderCardForExport(source: string): Promise<string> {
  const md = new MarkdownIt();
  installWikiLinks(md);

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${EXPORT_BLOCK_WIDTH_PX}px;pointer-events:none;`;
  const themed = document.createElement('div');
  themed.setAttribute('data-theme', 'light');
  const preview = document.createElement('div');
  preview.className = 'preview';
  preview.innerHTML = md.render(source);
  themed.appendChild(preview);
  host.appendChild(themed);
  document.body.appendChild(host);
  try {
    await hydrateTypedCards({
      previewEl: preview,
      typePropsCache: new Map(),
      quoteMetaCache: new Map(),
      queryPrefixes: QUERY_PREFIXES,
      resolvePath: await previewWikiResolver(),
    });
    // No card made → the export's own rendering of the plain link.
    if (!preview.querySelector('[data-typed-card]')) return '';
    return snapshotLiveBlock(themed);
  } finally {
    host.remove();
  }
}
