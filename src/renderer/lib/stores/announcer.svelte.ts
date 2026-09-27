/**
 * Screen-reader announcer (#2374).
 *
 * ONE app-level pair of live regions, rendered once by `LiveAnnouncer.svelte`
 * (mounted in `FeatureDialogHost`), fed by this store. Surfaces that change
 * something a sighted user notices out of the corner of their eye — a reply
 * finishing, proposals arriving, an index rebuild ending — call `announce()`
 * rather than growing their own `aria-live` element.
 *
 * Why one region instead of one per surface: a live region is only reliably
 * spoken when it is ALREADY in the DOM and its text then changes. A region
 * rendered inside an `{#if}` together with its message (which is how the toast
 * stack, the busy overlay and the proposals success banner all used to work) is
 * inserted pre-filled and is silently skipped by several screen-reader/browser
 * pairs. An always-mounted region that only ever has its text swapped avoids
 * that entirely, and gives one place to hold the restraint rules:
 *
 *   - Announce transitions, never progress. Callers announce a start and an
 *     end; nothing here throttles a caller that announces per token or per
 *     tick, so don't.
 *   - `polite` by default. `assertive` is for failures the user is waiting on
 *     (a conversation turn that errored), not for good news.
 *   - The same text twice in a row is still announced: an unchanged text node
 *     is not a mutation, so a repeat gets a trailing no-break space.
 */

export type Politeness = 'polite' | 'assertive';

let polite = $state('');
let assertive = $state('');

/** Longest message we'll hand a screen reader. A full LLM reply can be pages;
 *  the announcement is a cue, and the transcript is one keystroke away. */
export const MAX_ANNOUNCEMENT_CHARS = 300;

/** Collapse whitespace and cut at a word boundary under `max` chars. */
export function condenseForAnnouncement(text: string, max = MAX_ANNOUNCEMENT_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function next(previous: string, message: string): string {
  // Toggle a trailing NBSP so a repeat of the current text is a real DOM change.
  return previous === message ? `${message}\u00A0` : message;
}

/** Speak `message` through the app's live region. Empty/blank is ignored. */
export function announce(message: string, politeness: Politeness = 'polite'): void {
  const text = condenseForAnnouncement(message);
  if (!text) return;
  if (politeness === 'assertive') assertive = next(assertive, text);
  else polite = next(polite, text);
}

export function getAnnouncerStore() {
  return {
    /** Current text of the polite (`role="status"`) region. */
    get polite(): string {
      return polite;
    },
    /** Current text of the assertive (`role="alert"`) region. */
    get assertive(): string {
      return assertive;
    },
    announce,
  };
}
