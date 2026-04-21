import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

interface Config {
  style: 'increment' | 'same';
}

registerRule<Config>({
  id: 'ordered-list-style',
  category: 'content',
  title: 'Ordered list numbering',
  description:
    'Normalise ordered-list numbering. `increment` renumbers 1, 2, 3, … per list; `same` writes every item as `1.` (markdown renumbers at render time).',
  defaultConfig: { style: 'increment' },
  apply(content, config, cache) {
    return transformUnprotected(content, cache, (seg) => {
      if (config.style === 'same') {
        return seg.replace(/^([ \t]*)\d+([.)])([ \t]+)/gm, '$11$2$3');
      }
      return renumberIncrementally(seg);
    });
  },
});

function renumberIncrementally(seg: string): string {
  const lines = splitLinesKeepTerminator(seg);
  const counters = new Map<number, number>(); // indent → next counter value
  const LIST = /^([ \t]*)(\d+)([.)])([ \t]+)/;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const body = raw.replace(/\r?\n$/, '');
    const m = LIST.exec(body);

    if (m) {
      const indent = m[1];
      const indentLen = indent.length;
      // Any deeper-indented lists are done — drop their counters.
      for (const k of [...counters.keys()]) {
        if (k > indentLen) counters.delete(k);
      }
      const next = (counters.get(indentLen) ?? 0) + 1;
      counters.set(indentLen, next);
      const punct = m[3];
      const sep = m[4];
      const terminator = raw.slice(body.length);
      const tail = body.slice(m[0].length);
      lines[i] = `${indent}${next}${punct}${sep}${tail}${terminator}`;
      continue;
    }

    if (/^\s*$/.test(body)) continue; // blank line — preserve state (list may continue)
    counters.clear(); // any non-list, non-blank line ends every open list
  }
  return lines.join('');
}

function splitLinesKeepTerminator(content: string): string[] {
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
