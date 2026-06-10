import type { ToolParameter } from '../../../shared/tools/types';

/** Drop a trailing .md; basename as a fallback title for a picked note. */
function basenameTitle(relativePath: string): string {
  const base = relativePath.split('/').pop() ?? relativePath;
  return base.replace(/\.md$/i, '');
}

/**
 * Note-picker resolution (#516). For each `note`-type parameter that holds a
 * picked value (a relativePath), read the note and expose its body + title to
 * the prompt as the companion template vars `{{param.<id>.content}}` and
 * `{{param.<id>.title}}`. The picked path itself stays as `{{param.<id>}}`.
 *
 * Pure but for the injected `readFile`, so it unit-tests without Electron. A
 * read failure (the note was renamed/deleted between pick and run) leaves the
 * path + title in place and just omits the content — the skill prompt decides
 * how to handle a missing body.
 */
export async function resolveNoteParams(
  params: ToolParameter[] | undefined,
  values: Record<string, string>,
  readFile: (relativePath: string) => Promise<string>,
): Promise<Record<string, string>> {
  const out = { ...values };
  for (const p of params ?? []) {
    if (p.type !== 'note') continue;
    const rel = out[p.id];
    if (!rel) continue;
    out[`${p.id}.title`] = basenameTitle(rel);
    try {
      out[`${p.id}.content`] = await readFile(rel);
    } catch {
      // Picked note unreadable — keep path + title, omit content.
    }
  }
  return out;
}

/** Flatten a NoteFile tree to the markdown files, for the picker list. */
export function flattenNoteFiles(
  nodes: { name: string; relativePath: string; isDirectory: boolean; children?: unknown[] }[],
): { name: string; relativePath: string }[] {
  const out: { name: string; relativePath: string }[] = [];
  const walk = (ns: typeof nodes): void => {
    for (const n of ns) {
      if (n.isDirectory) {
        if (Array.isArray(n.children)) walk(n.children as typeof nodes);
      } else if (n.relativePath.toLowerCase().endsWith('.md')) {
        out.push({ name: n.name, relativePath: n.relativePath });
      }
    }
  };
  walk(nodes);
  return out;
}
