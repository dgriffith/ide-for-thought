/**
 * Render a `:::argument` block for an export (#2514, epic #2508) with the
 * preview's own `ArgumentMap`: the directive parsed by the preview's parser,
 * the focus link resolved with the same wiki-link index the preview builds
 * (every note path + the alias map), the same graph queries — then
 * snapshotted in the light theme.
 *
 * A static page has no use for the map's controls (outline/diagram toggle,
 * depth slider): they're removed, and the map shows the view and depth the
 * directive asked for. A diagram is drawn by #2513's export mermaid path
 * (light, the export page's font); node links resolve like `[[links]]`.
 */
import { mount, tick, unmount } from 'svelte';
import ArgumentMap from '../components/ArgumentMap.svelte';
import { api } from '../ipc/client';
import { getNotebaseStore } from '../stores/notebase.svelte';
import { flattenNotePaths } from '../app/text-helpers';
import { buildWikiLinkIndex, resolveWikiLinkTargetWithIndex } from '../../../shared/wiki-link-resolver';
import { splitQueryDirective } from '../preview/query-directive';
import { QUERY_PREFIXES } from '../preview/query-prefixes';
import { mermaidErrorHtml, renderMermaidSvgForExport } from '../markdown/mermaid-renderer';
import { snapshotLiveBlock } from './live-block-snapshot';
import { EXPORT_BLOCK_WIDTH_PX } from './render-object-view';
import { EXPORT_DIAGRAM_FONT } from './render-mermaid';

/** The focus query, every hop, defects, and a diagram — all bounded here. */
export const ARGUMENT_MAP_TIMEOUT_MS = 20_000;

/** `:::argument` … `:::` back into its focus reference and config. */
export function parseArgumentDirectiveSource(source: string): { focusRef: string; config: Record<string, string> } | null {
  const lines = source.replace(/\n$/, '').split('\n');
  if (!/^\s*:::argument\s*$/.test(lines[0] ?? '') || lines.length < 2 || lines[lines.length - 1]!.trim() !== ':::') return null;
  const { query, config } = splitQueryDirective(lines.slice(1, -1).join('\n').trim());
  return { focusRef: query, config };
}

export async function renderArgumentMapForExport(source: string): Promise<string> {
  const directive = parseArgumentDirectiveSource(source);
  if (!directive) throw new Error('not an argument block');

  // The preview's resolver, over the same inputs App hands the preview.
  const aliases = await api.graph.aliasEntries();
  const index = buildWikiLinkIndex(
    flattenNotePaths(getNotebaseStore().files).map((relativePath) => ({ relativePath, isDirectory: false })),
    Object.fromEntries(aliases.map((a) => [a.alias.toLowerCase(), a.relativePath])),
  );

  const host = document.createElement('div');
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = `position:fixed;left:-100000px;top:0;width:${EXPORT_BLOCK_WIDTH_PX}px;pointer-events:none;`;
  const themed = document.createElement('div');
  themed.setAttribute('data-theme', 'light');
  const preview = document.createElement('div');
  preview.className = 'preview';
  const block = document.createElement('div');
  block.className = 'argument-map-block';
  block.setAttribute('data-argument-map-rendered', 'ok');
  preview.appendChild(block);
  themed.appendChild(preview);
  host.appendChild(themed);
  document.body.appendChild(host);

  const depth = directive.config.depth ? Number.parseInt(directive.config.depth, 10) : undefined;
  const view = directive.config.view === 'diagram' || directive.config.view === 'outline' ? directive.config.view : undefined;
  let instance: ReturnType<typeof mount> | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await new Promise<void>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('the argument map took too long to load')), ARGUMENT_MAP_TIMEOUT_MS);
      instance = mount(ArgumentMap, {
        target: block,
        props: {
          focusRef: directive.focusRef,
          queryPrefixes: QUERY_PREFIXES,
          resolvePath: (t: string) => resolveWikiLinkTargetWithIndex(t, index),
          onNavigate: () => {},
          ...(depth && Number.isFinite(depth) ? { initialDepth: depth } : {}),
          ...(view ? { initialView: view } : {}),
          onSettled: () => resolve(),
          renderDiagramSvg: async (src: string) => {
            try {
              return await renderMermaidSvgForExport(src, themed, EXPORT_DIAGRAM_FONT);
            } catch (err) {
              return mermaidErrorHtml(err instanceof Error ? err.message : String(err));
            }
          },
        },
      });
    });
    await tick();
    for (const el of Array.from(block.querySelectorAll('.argument-map-controls'))) el.remove();
    return snapshotLiveBlock(themed);
  } finally {
    clearTimeout(timer);
    if (instance) void unmount(instance);
    host.remove();
  }
}
