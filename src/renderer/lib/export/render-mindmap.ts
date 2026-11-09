/**
 * A `:::mindmap` block in an export (#2966): the same walk the preview draws
 * (`graph:mindmap`, or the focus note's outline for `headings`), laid out
 * left to right or radial, as a still SVG in the export's light colours.
 * Every node is drawn — folding is the live map's.
 */
import { api } from '../ipc/client';
import { layoutMindmap } from '../../../shared/mindmap/mindmap-layout';
import { mindmapSvg, MINDMAP_EXPORT_COLORS } from '../../../shared/mindmap/mindmap-svg';
import { parseMindmapBlock, type MindmapNoteTree } from '../../../shared/mindmap/note-hierarchy';
import { parseOutline, type OutlineNode } from '../../../shared/outline/outline';
import { escapeHtml } from '../../../shared/text-escape';
import { mindmapDisplayTree } from '../components/mindmap/mindmap-display';
import { previewWikiResolver } from './wiki-resolver';

/** `:::mindmap` … `:::` → its body. */
export function mindmapDirectiveBody(source: string): string | null {
  const lines = source.replace(/\n$/, '').split('\n');
  if (!/^\s*:::mindmap\s*$/.test(lines[0] ?? '') || lines.length < 2 || lines[lines.length - 1]!.trim() !== ':::') return null;
  return lines.slice(1, -1).join('\n');
}

const fail = (message: string) => `<p class="query-error">${escapeHtml(message)}</p>`;

export async function renderMindmapForExport(source: string): Promise<string> {
  const body = mindmapDirectiveBody(source);
  if (body === null) throw new Error('not a mindmap block');
  const spec = parseMindmapBlock(body);
  if (!spec.focus) return fail('A :::mindmap block needs a focus note, as a [[link]] on a line of its own.');
  const path = (await previewWikiResolver())(spec.focus);
  if (!path) return fail(`No note is called “${spec.focus}”.`);
  let tree: MindmapNoteTree;
  if (spec.relation === 'headings') {
    const outline = parseOutline(await api.notebase.readFile(path));
    const build = (n: OutlineNode, id: string): MindmapNoteTree => ({
      id, label: n.kind === 'root' ? path.replace(/^.*\//, '').replace(/\.md$/, '') : n.text, path: null,
      children: n.children.map((c, i) => build(c, `${id}\u001f${i}`)),
    });
    tree = build(outline.root, path);
  } else {
    tree = (await api.graph.mindmap(path, { relation: spec.relation, direction: spec.direction, depth: spec.depth })).tree;
  }
  const display = mindmapDisplayTree(tree);
  const svg = mindmapSvg(layoutMindmap(display, { orientation: spec.layout }), MINDMAP_EXPORT_COLORS, { title: `Mindmap of ${display.label}` });
  return `<figure class="mindmap-export">${svg.replace('<svg ', '<svg style="max-width: 100%; height: auto;" ')}</figure>`;
}
