/**
 * Mute EXPECTED log output for the tests in the calling file (#2390).
 *
 * Several suites deliberately drive failure paths — a hostile thoughtbase, an
 * agent spelling its way at `.minerva/`, a malformed stdio line — and the code
 * under test correctly logs each one. Letting those reach stderr buried a green
 * run under ~1,400 `stderr |` blocks, which is exactly where a real warning goes
 * to hide.
 *
 * Scope is the point: call this at the top of a `describe` (or the file) that
 * EXPECTS these logs, naming only the tags it expects. Every other tag, and
 * every other file, still prints. Production logging is untouched —
 * `setTagLevel` is the logger's own per-tag override.
 *
 * Caveat: a file that `vi.resetModules()` and re-imports `shared/logger` gets a
 * fresh module instance this override does not reach.
 */
import { beforeAll, afterAll } from 'vitest';
import { setTagLevel, clearTagLevel, type LogTag } from '../../src/shared/logger';

export function silenceLogTags(...tags: LogTag[]): void {
  beforeAll(() => {
    for (const tag of tags) setTagLevel(tag, 'silent');
  });
  afterAll(() => {
    for (const tag of tags) clearTagLevel(tag);
  });
}
