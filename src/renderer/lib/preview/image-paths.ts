/**
 * Pure relative-image-path resolution + MIME guessing extracted from
 * Preview.svelte (#672, #244 image rendering). No DOM, no reactivity.
 */

/**
 * Resolve a relative `![](src)` reference against the note's
 * directory and normalise so `..` segments collapse. Returns a
 * project-rooted relative path (no leading `/`).
 */
export function resolveRelativeImagePath(src: string, fromNote: string | null | undefined): string {
  // Split off the note's parent directory. The regex form
  // `/\/[^/]*$/` would silently fall back to the full string when
  // there's no slash — i.e. for a project-root note like
  // `graph.md`, `noteDir` would become `graph.md` and downstream
  // resolution would treat the file itself as a directory (the
  // ENOTDIR symptom). Use a guarded lastIndexOf instead.
  const lastSlash = fromNote ? fromNote.lastIndexOf('/') : -1;
  const noteDir = lastSlash > 0 && fromNote ? fromNote.slice(0, lastSlash) : '';
  const baseSegments = noteDir ? noteDir.split('/') : [];
  const srcSegments = src.split('/');
  const out: string[] = [...baseSegments];
  for (const seg of srcSegments) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length > 0) out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join('/');
}

/** MIME guess from a relative-path extension; data URLs need it explicit. */
export function mimeFromPath(rel: string): string {
  const ext = rel.toLowerCase().match(/\.([^./\\]+)$/)?.[1] ?? '';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'avif') return 'image/avif';
  return 'application/octet-stream';
}
