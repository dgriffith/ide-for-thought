/**
 * The theme tokens (#2787) are the stylesheet's, in both directions: every
 * custom property the built-in themes define (bar type, stacking order and
 * blur) is one a plugin theme may set, and nothing else is. The aliases the
 * contrast check follows are `:root`'s own.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { THEME_TOKEN_ALIASES, THEME_TOKENS } from '../../src/shared/theme-tokens';

const CSS = fs.readFileSync(path.resolve(__dirname, '..', '..', 'src', 'renderer', 'styles', 'global.css'), 'utf-8');

/** The declarations in the block that opens with `selector {`. */
function block(selector: string): Array<[string, string]> {
  const start = CSS.indexOf(`${selector} {`);
  expect(start, `${selector} block`).toBeGreaterThanOrEqual(0);
  const body = CSS.slice(start, CSS.indexOf('\n}', start));
  return [...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]);
}

const NOT_COLOUR = /^--(?:font-|z-|scrim-blur$)/;

describe('theme tokens (#2787)', () => {
  it('are exactly the colour tokens the built-in themes define', () => {
    const defined = new Set([
      ...block(':root'), ...block('[data-theme-base="light"]'), ...block('[data-theme="contrast"]'),
    ].map(([k]) => k).filter((k) => !NOT_COLOUR.test(k)));
    expect([...THEME_TOKENS].sort()).toEqual([...defined].sort());
  });

  it('the aliases are :root\'s var() declarations', () => {
    const aliases = Object.fromEntries(block(':root')
      .map(([k, v]) => [k, /^var\((--[\w-]+)\)$/.exec(v)?.[1]] as const)
      .filter(([, target]) => target !== undefined));
    expect(THEME_TOKEN_ALIASES).toEqual(aliases);
  });
});
