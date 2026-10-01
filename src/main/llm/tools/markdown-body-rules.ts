/**
 * How to write a note body the model authors as Markdown — shared by
 * `propose_object_type` (a type's default body) and `propose_notes` (a note
 * started from one), so the two can't teach different habits.
 *
 * Written from what models actually produced: given "a default body for a
 * Museum type", every one of four types came back as a block of
 * `**Address:** …` / `**Website:** …` lines with nothing between them, which
 * renders as ONE run-on paragraph. Each rule below answers a mistake of that
 * kind, and the example is the shape that renders as intended.
 */
export const MARKDOWN_BODY_RULES =
  'It is rendered as Markdown (CommonMark + GitHub tables), so format it as ' +
  'Markdown, not as plain text:\n' +
  '- A single line break does NOT start a new line: consecutive lines join into one ' +
  'paragraph. Put label/value fields in a bullet list, one item per field ' +
  '(`- **Address:** {{address}}`), or in a table — never as bare consecutive lines.\n' +
  '- Leave a blank line before and after every heading, list, table, blockquote and ' +
  'code block.\n' +
  '- Start each list item with `- `; indent a nested item by two spaces.\n' +
  '- Don\'t rely on trailing spaces or `<br>` for line breaks.\n' +
  'Example:\n' +
  '```\n' +
  '- **Address:** {{address}}, {{city}}\n' +
  '- **Website:** {{website}}\n' +
  '- **Hours:** {{hours}}\n' +
  '\n' +
  '## Highlights\n' +
  '\n' +
  '## Notes\n' +
  '```';
