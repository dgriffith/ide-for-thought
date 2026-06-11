/**
 * Pure HTML/text-escaping + frontmatter helpers extracted from
 * Preview.svelte (#672). No DOM, no reactivity — just string transforms,
 * so they're trivially unit-testable and shared by the other preview
 * modules.
 */

export function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function escapeAttr(str: string): string {
  return escapeHtml(str).replace(/"/g, '&quot;');
}

export function stripFrontmatter(text: string): string {
  return text.replace(/^---\n[\s\S]*?\n---\n?/, '');
}

export function countFrontmatterLines(text: string): number {
  const m = text.match(/^---\n[\s\S]*?\n---\n?/);
  if (!m) return 0;
  return (m[0].match(/\n/g) ?? []).length;
}
