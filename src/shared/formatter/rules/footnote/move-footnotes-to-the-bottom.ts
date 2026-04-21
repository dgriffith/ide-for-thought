import { registerRule } from '../../registry';
import { transformUnprotected } from '../helpers';

/**
 * A footnote definition is `[^name]: text` at line start, plus any
 * subsequent lines that are indented (continuation). An un-indented line
 * (or a blank line followed by an un-indented line — handled implicitly
 * since the next non-continuation line terminates the block) ends the
 * definition block.
 */
const DEF_START = /^[ \t]*\[\^[^\]\s]+\]:/;
const CONTINUATION = /^[ \t]+\S/;

registerRule({
  id: 'move-footnotes-to-the-bottom',
  category: 'footnote',
  title: 'Move footnotes to the bottom',
  description:
    'Collect every `[^name]: …` definition (including indented continuation lines) and re-emit them in a block at the very end of the document, in document order.',
  defaultConfig: {},
  apply(content, _cfg, cache) {
    return transformUnprotected(content, cache, (seg) => moveFootnotesToEnd(seg));
  },
});

function moveFootnotesToEnd(seg: string): string {
  const lines = splitLinesKeepTerminator(seg);
  const defs: string[] = [];
  const kept: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const body = stripTerminator(lines[i]);
    if (DEF_START.test(body)) {
      const block: string[] = [lines[i]];
      let j = i + 1;
      while (j < lines.length) {
        const nextBody = stripTerminator(lines[j]);
        if (CONTINUATION.test(nextBody)) {
          block.push(lines[j]);
          j++;
        } else {
          break;
        }
      }
      defs.push(block.join(''));
      i = j;
      // Consume one trailing blank line so removing a def that was flanked
      // by blanks doesn't leave two blanks in a row in its place.
      if (i < lines.length && /^\s*$/.test(stripTerminator(lines[i]))) i++;
    } else {
      kept.push(lines[i]);
      i++;
    }
  }

  if (defs.length === 0) return seg;

  const keptJoined = kept.join('');
  // Trim trailing whitespace from the kept body so we control the
  // separator explicitly.
  const keptTrimmed = keptJoined.replace(/\s+$/, '');
  const defsJoined = defs.map((d) => (d.endsWith('\n') ? d : d + '\n')).join('');
  if (keptTrimmed.length === 0) return defsJoined;
  return `${keptTrimmed}\n\n${defsJoined}`;
}

function splitLinesKeepTerminator(seg: string): string[] {
  const out: string[] = [];
  let i = 0;
  const n = seg.length;
  while (i < n) {
    let j = i;
    while (j < n && seg[j] !== '\n') j++;
    if (j < n) j++;
    out.push(seg.slice(i, j));
    i = j;
  }
  return out;
}

function stripTerminator(line: string): string {
  return line.replace(/\r?\n$/, '');
}
