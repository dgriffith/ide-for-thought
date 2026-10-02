/**
 * A folder rename or move keeps folder-scoped views pointing at it (#2535,
 * epic #2530). A view's `folder` (#2531) is a path, so without this, renaming
 * `trip/prague` would leave every ```object-view embed saved from it showing
 * nothing. The rename pipeline (`main/notebase/rename.ts`) runs this over
 * every note in the same pass and the same write as its wiki-link rewrites,
 * so a rename and its undo treat the two alike. Open view tabs follow in the
 * renderer (`editor.svelte.ts`'s `retargetTypeViewFolders`).
 *
 * Only the `folder` value is touched — the spec's layout, key order and
 * spacing stay exactly as written (hand-written or saved). A spec whose
 * folder is a sibling sharing a prefix (`trip/prague-old`) is left alone.
 */
import { normalizeFolder } from './view-spec';

/** Where `folder` lands when `from` becomes `to`; `null` when it isn't under `from`. */
export function movedFolder(folder: string, from: string, to: string): string | null {
  const f = normalizeFolder(folder);
  const a = normalizeFolder(from);
  const b = normalizeFolder(to);
  if (f === null || a === null || b === null) return null;
  if (f === a) return b;
  if (f.startsWith(`${a}/`)) return b + f.slice(a.length);
  return null;
}

/** A top-level `"folder": "…"` member, whatever the spacing. */
const FOLDER_MEMBER = /("folder"\s*:\s*)("(?:[^"\\\n]|\\.)*")/g;

function rewriteSpec(body: string, from: string, to: string): string {
  let spec: unknown;
  try { spec = JSON.parse(body); } catch { return body; } // a broken spec renders an error; leave it
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) return body;
  const current = (spec as { folder?: unknown }).folder;
  if (typeof current !== 'string') return body;
  const next = movedFolder(current, from, to);
  if (next === null) return body;
  // Replace the member whose value is the parsed top-level folder. A filter
  // never has a `folder` key, but don't guess if two members say "folder".
  const matches = [...body.matchAll(FOLDER_MEMBER)].filter((m) => {
    try { return JSON.parse(m[2]!) === current; } catch { return false; }
  });
  if (matches.length !== 1) return body;
  const m = matches[0]!;
  const at = m.index + m[1]!.length;
  return body.slice(0, at) + JSON.stringify(next) + body.slice(at + m[2]!.length);
}

/**
 * Rewrite `folder` in every ```object-view fence of a note for a folder
 * rename/move `from` → `to`. Returns the content unchanged (same string) when
 * nothing points under `from`.
 */
export function rewriteViewFolders(content: string, from: string, to: string): string {
  if (!content.includes('object-view')) return content;
  const lines = content.split('\n');
  let open: { char: string; len: number; view: boolean; start: number } | null = null;
  let changed = false;
  for (let i = 0; i < lines.length; i++) {
    const m = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]!);
    if (open) {
      if (m && m[1]![0] === open.char && m[1]!.length >= open.len && m[2]!.trim() === '') {
        if (open.view) {
          const body = lines.slice(open.start + 1, i).join('\n');
          const next = rewriteSpec(body, from, to);
          if (next !== body) {
            lines.splice(open.start + 1, i - open.start - 1, ...next.split('\n'));
            changed = true;
          }
        }
        open = null;
      }
      continue;
    }
    if (m && !(m[1]![0] === '`' && m[2]!.includes('`'))) {
      const lang = m[2]!.trim().split(/\s+/)[0]?.toLowerCase();
      open = { char: m[1]![0]!, len: m[1]!.length, view: lang === 'object-view', start: i };
    }
  }
  return changed ? lines.join('\n') : content;
}
