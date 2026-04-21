import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import { LINK_TYPES } from '../../../shared/link-types';
import type { SourceMetadata } from '../../../shared/types';
import { extractAnchors } from './note-anchors';

// ── Phase detection (pure) ─────────────────────────────────────────────────

export type CompletionPhase =
  | { kind: 'type-or-path'; innerStart: number; prefix: string }
  | { kind: 'path'; innerStart: number; typePrefix: string; prefix: string }
  | { kind: 'heading'; innerStart: number; targetPath: string; prefix: string }
  | { kind: 'block'; innerStart: number; targetPath: string; prefix: string }
  | { kind: 'none' };

/**
 * Inspect text before the cursor and decide what, if anything, should be
 * completed. `pos` is the absolute cursor position so we can return the
 * document `from` the caller needs.
 */
export function detectCompletionPhase(before: string, pos: number): CompletionPhase {
  // We only care about text after the most-recent `[[`. Bail if a `]]`
  // closed it, or if there's no `[[` at all.
  const openIdx = before.lastIndexOf('[[');
  if (openIdx < 0) return { kind: 'none' };
  const closeIdx = before.lastIndexOf(']]');
  if (closeIdx > openIdx) return { kind: 'none' };

  const inner = before.slice(openIdx + 2);
  // `[[` itself can't contain brackets or newlines in a well-formed link.
  if (/[\[\]\n]/.test(inner)) return { kind: 'none' };

  const innerStart = pos - inner.length;

  // Once the user types `|`, completion stops — that's the display text.
  const pipeIdx = inner.indexOf('|');
  if (pipeIdx >= 0) return { kind: 'none' };

  // Split off an optional `type::` prefix.
  const typeMatch = inner.match(/^([a-z][\w-]*)::/);
  let typePrefixLen = 0;
  let typePrefix = '';
  if (typeMatch) {
    typePrefixLen = typeMatch[0].length;
    typePrefix = typeMatch[1];
  }
  const pathAndAnchor = inner.slice(typePrefixLen);
  const hashIdx = pathAndAnchor.indexOf('#');

  if (hashIdx < 0) {
    // No anchor yet — either typing type (only if we don't already have one)
    // or typing the note path.
    if (!typePrefix) {
      return { kind: 'type-or-path', innerStart, prefix: pathAndAnchor };
    }
    return {
      kind: 'path',
      innerStart: innerStart + typePrefixLen,
      typePrefix,
      prefix: pathAndAnchor,
    };
  }

  // `#` is present — anchor phase. Path is everything before `#`.
  const targetPath = pathAndAnchor.slice(0, hashIdx);
  const afterHash = pathAndAnchor.slice(hashIdx + 1);
  if (afterHash.startsWith('^')) {
    return {
      kind: 'block',
      innerStart: innerStart + typePrefixLen + hashIdx + 2, // +1 for `#`, +1 for `^`
      targetPath,
      prefix: afterHash.slice(1),
    };
  }
  return {
    kind: 'heading',
    innerStart: innerStart + typePrefixLen + hashIdx + 1,
    targetPath,
    prefix: afterHash,
  };
}

// ── Option building ────────────────────────────────────────────────────────

/** Strip the `.md` extension — link targets are always extension-less. */
function normalizeTarget(path: string): string {
  return path.replace(/\.md$/, '');
}

function linkTypeOptions(): Completion[] {
  return LINK_TYPES
    .filter((lt) => lt.name !== 'references') // default type — no explicit prefix needed
    .map((lt) => ({
      label: `${lt.name}::`,
      detail: lt.label,
      type: 'keyword',
      boost: 10,
    }));
}

function notePathOptions(paths: string[]): Completion[] {
  return paths.map((p) => {
    const label = normalizeTarget(p);
    return {
      label,
      detail: p,
      type: 'namespace',
    };
  });
}

export function sourceOptions(sources: readonly SourceMetadata[]): Completion[] {
  return sources.map((s) => {
    const title = s.title ?? s.sourceId;
    const creators = s.creators.length > 0
      ? (s.creators.length === 1 ? s.creators[0]
        : s.creators.length === 2 ? `${s.creators[0]} and ${s.creators[1]}`
        : `${s.creators[0]} et al.`)
      : '';
    const byline = creators && s.year ? `${creators} · ${s.year}`
      : creators || s.year || '';
    // Put the source id into the label string (tail) so fuzzy-matching picks
    // up both title searches ("toulmin", "uses of argument") and direct id
    // searches ("toulmin-1958"). `apply` inserts only the id.
    return {
      label: `${title} — ${s.sourceId}`,
      apply: s.sourceId,
      detail: byline || undefined,
      type: 'class',
    };
  });
}

function headingOptions(anchors: { slug: string; text: string; level: number }[]): Completion[] {
  return anchors.map((a) => ({
    label: a.slug,
    detail: a.text,
    type: `heading${a.level}`,
  }));
}

function blockIdOptions(ids: string[]): Completion[] {
  return ids.map((id) => ({ label: id, type: 'property' }));
}

// ── Extension ──────────────────────────────────────────────────────────────

export interface LinkAutocompleteOptions {
  /** Returns the current list of note-file relativePaths in the thoughtbase. */
  getNotePaths: () => string[];
  /** Returns the current list of indexed Sources (for `[[cite::…]]`). */
  getSources: () => readonly SourceMetadata[];
  /** Fetch raw markdown for a note so we can scan its headings + block-ids. */
  readNote: (relativePath: string) => Promise<string>;
}

/**
 * Build a CompletionSource for `[[…]]` wiki-links. Plug this into the
 * existing `autocompletion({ override: [...] })` config in Editor.svelte
 * alongside other sources (tags, etc.).
 */
export function linkCompletionSource(opts: LinkAutocompleteOptions) {
  // Cache scanned anchors per path so consecutive keystrokes don't thrash.
  const anchorCache = new Map<string, Promise<ReturnType<typeof extractAnchors>>>();

  async function fetchAnchors(targetPath: string) {
    const fullPath = targetPath.endsWith('.md') ? targetPath : `${targetPath}.md`;
    let promise = anchorCache.get(fullPath);
    if (!promise) {
      promise = (async () => {
        try {
          const content = await opts.readNote(fullPath);
          return extractAnchors(content);
        } catch {
          return { headings: [], blockIds: [] };
        }
      })();
      anchorCache.set(fullPath, promise);
      // Evict after a short window — the user may be editing the target.
      setTimeout(() => anchorCache.delete(fullPath), 5_000);
    }
    return promise;
  }

  return async function source(ctx: CompletionContext): Promise<CompletionResult | null> {
    const before = ctx.state.doc.sliceString(Math.max(0, ctx.pos - 500), ctx.pos);
    const phase = detectCompletionPhase(before, ctx.pos);

    if (phase.kind === 'none') return null;

    const paths = opts.getNotePaths();

    if (phase.kind === 'type-or-path') {
      return {
        from: phase.innerStart,
        options: [...linkTypeOptions(), ...notePathOptions(paths)],
        validFor: /^[a-z0-9_\-\/\.: ]*$/i,
      };
    }

    if (phase.kind === 'path') {
      // Typed-link paths pick from a different universe depending on the
      // prefix: `[[cite::…]]` completes against Sources (title / creator /
      // source id all searchable), everything else stays on notes.
      if (phase.typePrefix === 'cite') {
        return {
          from: phase.innerStart,
          options: sourceOptions(opts.getSources()),
          // Source ids are lowercase alphanumerics + `.`, `_`, `-`; titles
          // additionally carry spaces and punctuation which the default
          // matcher can chew on.
          validFor: /^[a-z0-9_\-\. ]*$/i,
        };
      }
      return {
        from: phase.innerStart,
        options: notePathOptions(paths),
        validFor: /^[a-z0-9_\-\/\. ]*$/i,
      };
    }

    const anchors = await fetchAnchors(phase.targetPath);
    if (phase.kind === 'heading') {
      return {
        from: phase.innerStart,
        options: headingOptions(anchors.headings),
        validFor: /^[a-z0-9_\-]*$/i,
      };
    }
    // block
    return {
      from: phase.innerStart,
      options: blockIdOptions(anchors.blockIds),
      validFor: /^[a-z0-9_\-]*$/i,
    };
  };
}
