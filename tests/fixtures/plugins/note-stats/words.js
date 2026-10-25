// Words in some Markdown: its frontmatter left out, runs of letters and digits counted.
export function countWords(text) {
  const body = text.replace(/^---\n[\s\S]*?\n---\n/, '');
  return (body.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
}
