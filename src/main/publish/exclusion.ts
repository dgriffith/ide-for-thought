/**
 * Private-by-default exclusion rules (#246).
 *
 * Minerva holds personal thinking, half-formed arguments, and reading
 * notes. Accidentally publishing those is a reputation-damaging failure
 * mode, so the export pipeline drops anything that matches a private
 * signal unless the user explicitly overrides in the preview dialog
 * (that override lives on #283).
 *
 * The three signals, in order:
 *   1. Path under any `private/` or `.private/` folder.
 *   2. Frontmatter `private: true`.
 *   3. Tag `#private` (frontmatter `tags: [..., private, ...]` or an
 *      inline `#private` in the body).
 *
 * Each match returns a human-readable reason that lands in the preview's
 * "excluded" audit — no silent drops.
 */

/** Result of checking a single note against the exclusion rules. */
export interface ExclusionCheck {
  excluded: boolean;
  /** Populated only when `excluded` is true. */
  reason?: string;
}

/**
 * Check a note against every rule. The path check is cheap and runs
 * first so we can short-circuit without parsing frontmatter for anything
 * under `private/`.
 */
export function checkExclusion(
  relativePath: string,
  content: string,
): ExclusionCheck {
  if (isUnderPrivateFolder(relativePath)) {
    return { excluded: true, reason: `under ${privateFolderMatch(relativePath)}` };
  }
  const frontmatter = extractFrontmatterRaw(content);
  if (frontmatter) {
    if (isPrivateTrue(frontmatter)) {
      return { excluded: true, reason: 'frontmatter `private: true`' };
    }
    if (hasPrivateTag(frontmatter)) {
      return { excluded: true, reason: 'tagged #private' };
    }
  }
  if (hasInlinePrivateTag(content)) {
    return { excluded: true, reason: 'tagged #private' };
  }
  return { excluded: false };
}

// ── Path-based check ───────────────────────────────────────────────────────

/**
 * True when any segment of the relative path is `private` or `.private`.
 * Matches both `private/secret.md` and `notes/private/secret.md`.
 */
export function isUnderPrivateFolder(relativePath: string): boolean {
  const segments = relativePath.split('/');
  return segments.some((s) => s === 'private' || s === '.private');
}

function privateFolderMatch(relativePath: string): string {
  const segments = relativePath.split('/');
  for (const s of segments) {
    if (s === 'private' || s === '.private') return `${s}/`;
  }
  return 'private/';
}

// ── Frontmatter inspection ─────────────────────────────────────────────────

/**
 * Pull the raw frontmatter block without running YAML — we only need to
 * string-match two specific patterns. Avoids depending on the `yaml`
 * library from this pure-logic module and keeps the check robust to
 * malformed YAML elsewhere in the frontmatter.
 */
function extractFrontmatterRaw(content: string): string | null {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  return m ? m[1] : null;
}

/** Match `private: true` (any whitespace, case-insensitive on `true`). */
function isPrivateTrue(frontmatter: string): boolean {
  return /^\s*private\s*:\s*true\s*$/im.test(frontmatter);
}

/**
 * Match a `private` tag in any of the common YAML shapes:
 *     tags: private
 *     tags: [private]
 *     tags: [draft, private, todo]
 *     tags:
 *       - private
 *       - draft
 */
function hasPrivateTag(frontmatter: string): boolean {
  // Horizontal-whitespace-only after the colon so `\s*` doesn't gobble
  // a newline and pull in the first block-list item as a false positive.
  const tagsMatch = frontmatter.match(/^tags[ \t]*:[ \t]*(.*)$/im);
  if (!tagsMatch) return false;
  const rest = tagsMatch[1].trim();
  // Inline scalar or inline list.
  if (/^\[[^\]]*\]$/.test(rest) || /^[^\s[]/.test(rest)) {
    return /(^|[[,\s])private([,\s\]]|$)/.test(rest);
  }
  // Block list: scan subsequent lines until a key change.
  const lines = frontmatter.split(/\r?\n/);
  const tagsIdx = lines.findIndex((l) => /^tags\s*:/i.test(l));
  if (tagsIdx < 0) return false;
  for (let i = tagsIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*-\s*private\s*$/i.test(line)) return true;
    if (/^\S/.test(line)) break; // next top-level key
  }
  return false;
}

// ── Body inspection ────────────────────────────────────────────────────────

/**
 * An inline `#private` tag anywhere in the note body counts. Uses the
 * same delimiter regex the indexer already applies: `#tag` preceded by a
 * whitespace / newline / start-of-line so it doesn't match `##heading`
 * or URL fragments.
 */
export function hasInlinePrivateTag(content: string): boolean {
  // Strip frontmatter before scanning the body to avoid matching inside
  // commented-out YAML examples.
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  return /(^|[\s(])#private(\b|$)/m.test(body);
}
