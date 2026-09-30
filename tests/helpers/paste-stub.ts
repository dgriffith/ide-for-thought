/**
 * Ready-to-paste stubs for inventory-ratchet failure messages (#2381).
 *
 * The inventory ratchets under `tests/architecture/` — a doc must name every
 * X, a list must carry every Y — fail most often on a PR that did nothing
 * wrong: two sibling PRs each add an entry, the second merges, and main needs
 * an inventory line neither PR could have written (#2348). At that moment the
 * fix should be a paste, not a trip to the doc to reverse-engineer its format.
 *
 * So each such failure message ends with a block in the target's exact shape
 * (a Markdown table row, a deflist row, a heading + field skeleton, a map
 * entry). Placeholders are `<angle-bracketed prose>` — the parts only a human
 * can write — and everything else is literal.
 */

/** Wrap `body` in a clearly delimited block naming where it goes. */
export function pasteStub(where: string, body: string | readonly string[]): string {
  const text = typeof body === 'string' ? body : body.join('\n');
  return `\n\n──── paste into ${where} ────\n${text}\n──── end ────`;
}

/** One Markdown table row: `| a | b |`. */
export function markdownRow(cells: readonly string[]): string {
  return `| ${cells.join(' | ')} |`;
}

/**
 * One row of the docs site's `<div class="deflist">`, indented the way every
 * `website/docs/_content/*.html` page indents it (row at 6 spaces).
 */
export function deflistRow(key: string, value: string): string {
  return [
    '      <div class="row">',
    `        <div class="k">${key}</div>`,
    `        <div class="v">${value}</div>`,
    '      </div>',
  ].join('\n');
}
