/**
 * Inline typed-creation autocomplete (#1065) — the headline `/book` gesture.
 *
 * Typing `/` at a word boundary in the note editor body offers the registry's
 * types; picking one creates a typed note (template + scaffold, the #1064 path)
 * and inserts a resolving wiki-link, in one gesture. Modeled on the wiki-link
 * autocomplete; collision-free by construction — it only fires on a `/` sigil,
 * never inside `[[…]]` (that's the wiki-link source) and never on a path/URL
 * slash (the `/` must follow whitespace or a line start). The conversation
 * `/`-slash-commands live in a separate composer, not this CodeMirror editor.
 */
import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import type { EditorView } from '@codemirror/view';
import type { TypeInfo } from '../../../shared/objects/type-def';

/** The `/partial` sigil directly before the cursor, or null. `from` is the `/`. */
export function detectSlashPhase(before: string, pos: number): { from: number; prefix: string } | null {
  // `/word` at the very end, where the `/` starts a token (line start or after
  // whitespace) — so `http://x` and `a/b` paths don't trigger.
  const m = before.match(/(?:^|\s)\/([\p{L}\p{N}-]*)$/u);
  if (!m) return null;
  // Not inside an open `[[…]]` — that belongs to the wiki-link source.
  const openIdx = before.lastIndexOf('[[');
  if (openIdx >= 0 && before.lastIndexOf(']]') < openIdx) return null;
  const prefix = m[1] ?? '';
  return { from: pos - prefix.length - 1, prefix }; // -1 for the `/`
}

export interface TypeCreateAutocompleteOptions {
  /** Load the registry's types (cached after the first call). */
  loadTypes: () => Promise<TypeInfo[]>;
  /** Editor-side handler: delete the `/partial`, create/link, insert the link. */
  onPick: (type: TypeInfo, view: EditorView, from: number, to: number) => void;
}

export function typeCreateCompletionSource(opts: TypeCreateAutocompleteOptions) {
  let cache: TypeInfo[] | null = null;

  return async function source(ctx: CompletionContext): Promise<CompletionResult | null> {
    const before = ctx.state.doc.sliceString(Math.max(0, ctx.pos - 200), ctx.pos);
    const phase = detectSlashPhase(before, ctx.pos);
    if (!phase) return null;

    cache ??= await opts.loadTypes();
    const q = phase.prefix.toLowerCase();
    const matches = cache.filter((t) => t.id.startsWith(q) || t.label.toLowerCase().startsWith(q));
    if (matches.length === 0) return null;

    const options: Completion[] = matches.map((t) => ({
      label: `/${t.label}`,
      detail: `new ${t.label}`,
      type: 'class',
      apply: (view: EditorView, _c: Completion, from: number, to: number) => opts.onPick(t, view, from, to),
    }));
    return { from: phase.from, options, validFor: /^\/[\p{L}\p{N}-]*$/u };
  };
}
