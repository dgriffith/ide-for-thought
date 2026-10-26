/**
 * Whether a proposal changes the thoughtbase guide (#2837). `thoughtbase.md`
 * at the root goes into every conversation's system prompt here
 * (`main/llm/thoughtbase-doc.ts`), so an approved change to it stays in effect
 * for every conversation after. Every place a proposal is reviewed — the
 * conversation's draft cards and the Proposals panel — asks this one helper
 * and shows the same quiet line. Information, not a gate.
 *
 * Decided from the path the change RESULTS in: a note written, rewritten,
 * moved or renamed to the guide writes it; one moved, renamed or deleted
 * away from it turns it off. Matched exactly at the root, case-folded,
 * since the default macOS volume is case-insensitive and `Thoughtbase.md` is
 * the same file there.
 */
import { THOUGHTBASE_DOC_FILENAME } from './thoughtbase';

/** A path as written, resolved: forward slashes, `.` and `..` segments applied. Null when it climbs out. */
function resolve(rel: string): string | null {
  const out: string[] = [];
  for (const seg of rel.replace(/\\/g, '/').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.join('/');
}

/** Whether `rel` names the guide: `thoughtbase.md` at the root, in any case. */
export function isThoughtbaseGuidePath(rel: string | null | undefined): boolean {
  if (typeof rel !== 'string') return false;
  const resolved = resolve(rel);
  return resolved !== null && resolved.toLowerCase() === THOUGHTBASE_DOC_FILENAME.toLowerCase();
}

/** What a change does to the guide: writes it, turns it off, or neither. */
export type GuideEffect = 'writes' | 'removes' | null;

/** The one line a review shows for each effect. */
export const GUIDE_MARKER_TEXT: Record<Exclude<GuideEffect, null>, string> = {
  writes: 'Thoughtbase guide: the assistant reads this in every conversation here.',
  removes: 'Thoughtbase guide: this turns the guide off, so the assistant stops reading it in conversations here.',
};

/** A move or rename: writes the guide when it lands there, turns it off when it leaves. */
export function guideEffectOfMove(fromPath: string, toPath: string): GuideEffect {
  if (isThoughtbaseGuidePath(toPath) && !isThoughtbaseGuidePath(fromPath)) return 'writes';
  if (isThoughtbaseGuidePath(fromPath) && !isThoughtbaseGuidePath(toPath)) return 'removes';
  return null;
}

/** The fields of a proposal payload this reads; the rest are ignored. */
export interface GuidePayloadLike {
  kind: string;
  relativePath?: unknown;
  path?: unknown;
  fromPath?: unknown;
  toPath?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** What one filed payload does to the guide. */
export function guideEffectOfPayload(p: GuidePayloadLike): GuideEffect {
  switch (p.kind) {
    case 'note': return isThoughtbaseGuidePath(str(p.relativePath)) ? 'writes' : null;
    case 'note-rewrite': return isThoughtbaseGuidePath(str(p.path)) ? 'writes' : null;
    case 'note-delete': return isThoughtbaseGuidePath(str(p.path)) ? 'removes' : null;
    case 'note-refactor': return guideEffectOfMove(str(p.fromPath), str(p.toPath));
    default: return null;
  }
}

/** What a whole proposal does to the guide: writing it outranks turning it off. */
export function guideEffectOfPayloads(payloads: readonly GuidePayloadLike[]): GuideEffect {
  const effects = payloads.map(guideEffectOfPayload);
  return effects.includes('writes') ? 'writes' : effects.includes('removes') ? 'removes' : null;
}
