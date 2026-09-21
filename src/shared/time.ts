/**
 * Duration constants.
 *
 * `DAY_MS` lived in `graph/queries/sources.ts` — it arrived there with the
 * reading-queue code that first needed it, and a comment in `graph/queries.ts`
 * recorded the consequence: "`llm/approval` imports it from here." So did
 * `history/policy.ts`, and `graph/health-checks.ts`.
 *
 * #2238 lists those as facade-bypass imports to route through `graph/index.ts`.
 * Re-exporting a millisecond count from the graph facade would have made the
 * dependency legal rather than removing it: proposal expiry and history
 * retention have nothing to do with the knowledge graph, and would still have
 * had to import from it to know how long a day is. Here, they don't.
 */

export const DAY_MS = 86_400_000;
