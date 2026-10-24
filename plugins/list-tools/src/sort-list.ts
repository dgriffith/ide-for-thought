/**
 * Sort a Markdown list (#2643): the List Tools plugin's "Sort List in
 * Selection". Pure: text in, text out.
 *
 * The items sorted are the list's outermost ones — those at the smallest
 * indent in the text. Each carries everything under it (nested items,
 * continuation lines) along, so sorting never splits an item from its
 * children. Text before the first item stays first, blank lines after the
 * last stay last. Items compare by their text, ignoring case, a checkbox and
 * the marker, with numbers in numeric order ("item 2" before "item 10"). An
 * ordered list is renumbered from its first number.
 */

const ITEM = /^(\s*)([-*+]|\d+[.)])(\s+)(\[[ xX]\]\s+)?(.*)$/;

interface Item {
  lines: string[];
  key: string;
}

/** `text` with its outermost list items sorted, or null when it holds fewer than two. */
export function sortList(text: string): string | null {
  const endsWithNewline = text.endsWith('\n');
  const lines = (endsWithNewline ? text.slice(0, -1) : text).split('\n');
  const indents = lines.flatMap((l) => {
    const m = ITEM.exec(l);
    return m ? [m[1]!.length] : [];
  });
  if (indents.length < 2) return null;
  const base = Math.min(...indents);

  const head: string[] = [];
  const items: Item[] = [];
  for (const line of lines) {
    const m = ITEM.exec(line);
    if (m && m[1]!.length === base) {
      items.push({ lines: [line], key: m[5]!.trim() });
    } else if (items.length === 0) {
      head.push(line);
    } else {
      items[items.length - 1]!.lines.push(line);
    }
  }
  if (items.length < 2) return null;

  // Blank lines after the last item belong after the list, not to that item.
  const tail: string[] = [];
  const last = items[items.length - 1]!;
  while (last.lines.length > 1 && last.lines[last.lines.length - 1]!.trim() === '') tail.unshift(last.lines.pop()!);
  // Every item ends the way the last one did, so a blank line between items stays between them.
  const gap = items.slice(0, -1).every((i) => i.lines[i.lines.length - 1]!.trim() === '');
  if (gap) for (const i of items.slice(0, -1)) i.lines.pop();

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const sorted = items.map((item, at) => ({ item, at })).sort((a, b) => collator.compare(a.item.key, b.item.key) || a.at - b.at);

  const first = ITEM.exec(items[0]!.lines[0]!)!;
  const ordered = /^\d/.test(first[2]!);
  const start = ordered ? Number.parseInt(first[2]!, 10) : 0;
  const out = sorted.flatMap(({ item }, n) => {
    const [line, ...rest] = item.lines;
    const renumbered = ordered ? line!.replace(ITEM, (_all, ind: string, marker: string, space: string, box: string | undefined, body: string) =>
      `${ind}${start + n}${marker.slice(-1)}${space}${box ?? ''}${body}`) : line!;
    return [renumbered, ...rest, ...(gap && n < sorted.length - 1 ? [''] : [])];
  });
  const result = [...head, ...out, ...tail].join('\n');
  return endsWithNewline ? `${result}\n` : result;
}
