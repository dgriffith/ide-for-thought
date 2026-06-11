/**
 * axe-core a11y assertion for component tests (#681).
 *
 * Runs axe against rendered DOM and fails with a readable list of violations.
 * color-contrast is disabled: jsdom doesn't compute layout/colours, so that
 * check is unreliable here — it belongs to a real-browser / manual pass, not
 * this ARIA/role/label/keyboard smoke.
 */
import axe from 'axe-core';
import { expect } from 'vitest';

export async function expectNoA11yViolations(root: Element = document.body): Promise<void> {
  const results = await axe.run(root, {
    rules: { 'color-contrast': { enabled: false } },
  });
  if (results.violations.length > 0) {
    const detail = results.violations
      .map((v) =>
        `  • [${v.impact ?? 'n/a'}] ${v.id} — ${v.help}\n` +
        v.nodes.map((n) => `      ${n.html}`).join('\n'),
      )
      .join('\n');
    expect.fail(
      `axe-core found ${results.violations.length} accessibility violation(s):\n${detail}`,
    );
  }
}
