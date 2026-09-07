/**
 * Names skipped tests in the default `pnpm test`/`pnpm coverage` output (#2061).
 *
 * The default reporter's summary only prints a skip COUNT ("1 skipped"),
 * with no way to learn which test it was without a separate
 * `--reporter=verbose` re-run. Every skip in this suite is intentional and
 * gated on a documented condition — e.g.
 * `tests/architecture/embedding-model-gate.test.ts`'s CI-only assertion,
 * deliberately skipped on a local machine per its own docstring — but
 * "intentional" and "identifiable from the default output" are different
 * claims, and only the first one held. Naming the skip here means a
 * developer never has to re-run anything to find out which test it was, or
 * to notice when a NEW skip shows up alongside it.
 */
export const skipReporter = {
  onTestRunEnd(testModules) {
    const skipped = [];
    for (const testModule of testModules) {
      for (const test of testModule.children.allTests('skipped')) {
        skipped.push(`${testModule.relativeModuleId} > ${test.fullName}`);
      }
    }
    if (skipped.length === 0) return;
    console.log(`\n⚠ ${skipped.length} test(s) skipped:`);
    for (const name of skipped) console.log(`  - ${name}`);
    console.log('');
  },
};
