/**
 * A mindmap as Mermaid `mindmap` text (#2967): what Copy as Mermaid puts on
 * the clipboard, for pasting into another tool or a plain-markdown note.
 * Every node, folded or not; each label quoted, so brackets, parentheses and
 * colons in it are text, not Mermaid's node shapes.
 */
import type { MindmapTree } from './mindmap-layout';

/** A label as Mermaid's quoted node text: one line, its `"` as an entity. */
const quoted = (label: string) => `"${label.replace(/\s+/g, ' ').trim().replace(/"/g, '#quot;') || ' '}"`;

export function mindmapMermaid(root: MindmapTree): string {
  const lines = ['mindmap', `  root((${quoted(root.label)}))`];
  let n = 0;
  const walk = (t: MindmapTree, depth: number) => {
    for (const c of t.children) {
      lines.push(`${'  '.repeat(depth + 2)}n${++n}[${quoted(c.label)}]`);
      walk(c, depth + 1);
    }
  };
  walk(root, 0);
  return `${lines.join('\n')}\n`;
}
