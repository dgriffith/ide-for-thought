/**
 * Formatting for the packaged-app time-to-first-paint trend (#2384).
 *
 * Input is `first-paint.jsonl` as `tests/e2e/helpers/first-paint.ts` writes
 * it: one row per attempt of a spec that recorded a sample, `{ test, retry,
 * sample }`, where `sample` is `{ trigger, uptimeMs, spawnToPaintMs }` or
 * `null` when the app printed no mark.
 *
 * Output is never a verdict. This is a trend, and CI runner timings vary too
 * much for a threshold to mean anything until there's history behind it — the
 * job summary carries the numbers, and a missing sample is a warning (the
 * measurement broke) rather than a failure.
 */

/** Parse JSONL, skipping blank and unparseable lines rather than throwing. */
export function parseFirstPaintRows(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === 'object') rows.push(row);
    } catch { /* a torn last line from a killed run — skip it */ }
  }
  return rows;
}

/**
 * The job-summary markdown, `::notice` / `::warning` annotation lines, and the
 * number each sampled test settled on (its last attempt with a sample).
 */
export function formatFirstPaintReport(rows, { label = '' } = {}) {
  const heading = `### Packaged app time-to-first-paint${label ? ` — ${label}` : ''}`;
  const annotations = [];
  if (rows.length === 0) {
    annotations.push('::warning title=first-paint::No first-paint samples were recorded — the packaged smoke boot did not run, or skipped.');
    return {
      markdown: `${heading}\n\nNo samples recorded (the packaged smoke boot did not run).\n`,
      annotations,
    };
  }
  const lines = [
    heading,
    '',
    'Recorded, not gated (#2384). *spawn → paint* is what a user waits for; *main uptime* is the',
    'same moment on the main process\'s own clock, excluding native startup before Node.',
    '',
    '| test | attempt | trigger | spawn → paint | main uptime |',
    '|---|---|---|---|---|',
  ];
  for (const row of rows) {
    const s = row.sample;
    lines.push(s
      ? `| ${row.test} | ${row.retry + 1} | ${s.trigger} | ${s.spawnToPaintMs} ms | ${s.uptimeMs} ms |`
      : `| ${row.test} | ${row.retry + 1} | — | no mark | — |`);
  }
  const byTest = new Map();
  for (const row of rows) byTest.set(row.test, row);
  for (const [title, row] of byTest) {
    const s = row.sample;
    if (!s) {
      annotations.push(`::warning title=first-paint::${title}: the app printed no first-paint mark — the measurement is broken, not the boot.`);
    } else if (s.trigger === 'timeout') {
      annotations.push(`::warning title=first-paint::${title}: shown by the 4s fallback timer, not a paint signal — ${s.spawnToPaintMs} ms is the timer, not a paint.`);
    } else {
      annotations.push(`::notice title=first-paint::${s.spawnToPaintMs} ms spawn → first paint (${s.uptimeMs} ms main uptime, ${s.trigger})`);
    }
  }
  return { markdown: `${lines.join('\n')}\n`, annotations };
}
