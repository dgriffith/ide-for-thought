import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

const LIST_ITEM = /^[ \t]*(?:[-*+]|\d+[.)])(?:[ \t]+\[[ xX]\])?[ \t]+\S/;

registerRule({
  id: 'remove-empty-lines-between-list-markers-and-checklists',
  category: 'spacing',
  title: 'Compact list items',
  description:
    'Remove blank lines separating adjacent list items (including checklists) so the list renders as a continuous block.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    return transformUnprotected(content, cache, (seg) => {
      const lines = splitLinesWithTerminators(seg);
      const out: string[] = [];
      let i = 0;
      while (i < lines.length) {
        const cur = lines[i];
        if (isListItemLine(cur)) {
          out.push(cur);
          let j = i + 1;
          while (j < lines.length && isBlankLine(lines[j])) j++;
          if (j > i + 1 && j < lines.length && isListItemLine(lines[j])) {
            // Skip the blanks; jump straight to the next list-item line.
            i = j;
            continue;
          }
        } else {
          out.push(cur);
        }
        i++;
      }
      return out.join('');
    });
  },
});

function splitLinesWithTerminators(content: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = content.length;
  while (i < n) {
    let j = i;
    while (j < n && content[j] !== '\n') j++;
    if (j < n) j++;
    out.push(content.slice(i, j));
    i = j;
  }
  return out;
}

function isListItemLine(line: string): boolean {
  // Strip terminator for the predicate check.
  const body = line.replace(/\r?\n$/, '');
  return LIST_ITEM.test(body);
}

function isBlankLine(line: string): boolean {
  return /^[ \t]*\r?\n?$/.test(line);
}
