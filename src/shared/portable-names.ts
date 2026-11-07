/**
 * File names that every platform Minerva runs on can write as written (#2983).
 *
 * Windows treats some names specially, on every volume and in every folder:
 * a device name (`CON`, `NUL`, `COM1`…, with or without an extension —
 * `nul.txt` opens the null device), a name ending in a dot or space (the
 * suffix is stripped, so `plugin.json.` IS `plugin.json`), and `:` (an NTFS
 * alternate data stream, not a file). A plugin archive or a draft that holds
 * one would install differently on Windows than on macOS, or write somewhere
 * else entirely — so they're refused everywhere, identically.
 */

const DEVICE = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\..*)?$/i;

/** Why one path segment isn't portable, or null when it is. */
export function nonPortableSegment(segment: string): string | null {
  if (segment.includes(':')) return `"${segment}" has a ":" (an alternate data stream on Windows)`;
  if (/[. ]$/.test(segment) && segment !== '.' && segment !== '..') return `"${segment}" ends in a dot or a space, which Windows drops`;
  if (DEVICE.test(segment)) return `"${segment}" is a device name on Windows`;
  return null;
}

/** The first non-portable segment of a `/`-separated path, or null. */
export function nonPortablePath(rel: string): string | null {
  for (const segment of rel.replace(/\/$/, '').split('/')) {
    const problem = nonPortableSegment(segment);
    if (problem) return problem;
  }
  return null;
}

/**
 * Remembers the paths seen so far and refuses one that differs from an
 * earlier one only in case or Unicode normalization: the default volumes on
 * Windows and macOS are case-insensitive, so the second would overwrite (or
 * fail to write over) the first.
 */
export class PathCollisions {
  private readonly seen = new Map<string, string>();

  /**
   * Null when `rel` is new; otherwise why it can't be written. Every folder
   * on the way is claimed too: `Types/a.md` and `types/b.md` are one folder
   * on macOS and Windows and two on Linux.
   */
  claim(rel: string): string | null {
    const segments = rel.replace(/\/$/, '').split('/');
    for (let i = 1; i <= segments.length; i++) {
      const prefix = segments.slice(0, i).join('/');
      const key = prefix.normalize('NFC').toLowerCase();
      const first = this.seen.get(key);
      if (first !== undefined && first !== prefix) return `"${prefix}" and "${first}" differ only in case or Unicode form, which most volumes treat as one name`;
      this.seen.set(key, prefix);
    }
    return null;
  }
}
