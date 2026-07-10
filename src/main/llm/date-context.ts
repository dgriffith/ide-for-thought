/**
 * A one-line "today is …" context for the conversation system prompt so the
 * model dates notes correctly and can resolve relative dates ("tomorrow",
 * "last week", "next Friday"). Without it the model guesses, usually landing
 * in its training-cutoff era (#1138).
 *
 * A pure leaf module (only `Intl` + `Date`) so it's unit-testable without
 * pulling the conversation registrar's electron/llm import graph.
 */

/**
 * @param now       The moment to describe. Defaults to `new Date()` and is
 *                  computed per turn by the caller, so long-lived / resumed
 *                  conversations always reflect the real current date.
 * @param timeZone  IANA zone; defaults to the host's resolved zone. The
 *                  weekday is included so day-relative phrasing resolves, and
 *                  the zone disambiguates "today" across the date line.
 */
export function currentDateContext(
  now: Date = new Date(),
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  const iso = now.toLocaleDateString('en-CA', { timeZone }); // YYYY-MM-DD
  const weekday = now.toLocaleDateString('en-US', { timeZone, weekday: 'long' });
  return `Today's date is ${weekday}, ${iso} (${timeZone}). Use it to resolve relative dates ("today", "tomorrow", "last week") and whenever you name or date a note.`;
}
