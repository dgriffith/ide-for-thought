/**
 * The turn-status line under an in-flight reply: a verb that changes as the
 * wait goes on, and how long it has been going. Pure, so the timing and
 * rotation are testable without a component.
 *
 * The verbs are deliberately mild — a professional tool, with a nod to the
 * owl — and all read as "still working" rather than claiming to know what the
 * model is doing at that instant (the transcript's tool lines already say
 * what it is actually doing).
 */
export const TURN_VERBS: readonly string[] = [
  'Thinking',
  'Pondering',
  'Considering',
  'Mulling it over',
  'Reflecting',
  'Weighing the evidence',
  'Connecting ideas',
  'Cross-referencing',
  'Untangling',
  'Sifting',
  'Deliberating',
  'Ruminating',
  'Synthesizing',
  'Consulting the owl',
];

/** How long one verb stays up before the next. */
export const VERB_ROTATE_MS = 8_000;

/**
 * The verb to show `elapsedMs` into a turn whose rotation starts at `offset`
 * (picked once per turn, so consecutive turns don't all open on "Thinking").
 */
export function verbAt(elapsedMs: number, offset: number): string {
  const step = Math.floor(Math.max(0, elapsedMs) / VERB_ROTATE_MS);
  return TURN_VERBS[(offset + step) % TURN_VERBS.length]!;
}

/** A per-turn rotation start derived from the turn's start time: stable for
 *  the turn (so switching tabs and back shows the same verb), varied across
 *  turns. */
export function verbOffsetFor(turnStartedAt: number): number {
  return Math.abs(Math.floor(turnStartedAt / 1000)) % TURN_VERBS.length;
}

/** `4s`, `59s`, `1m 05s`, `12m 40s`, `1h 02m`. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m < 60) return `${m}m ${String(s).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}
