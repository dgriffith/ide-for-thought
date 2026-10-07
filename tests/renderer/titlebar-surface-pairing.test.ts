/**
 * A --bg-titlebar surface reads its text from the --titlebar-* set (#2679).
 *
 * The contrast theme keeps a dark title bar (#3a3a4a) over a light body, so a
 * body text token on a --bg-titlebar surface is dark-on-dark there — and only
 * there: in dark and light every --titlebar-* resolves to its body twin, so
 * the mistake renders fine in the two themes people look at most. That is how
 * the preview's fenced-block toolbar shipped its `PYTHON` / `MERMAID` /
 * `OBJECT-VIEW` labels at 1.09:1, and how the app bar did before it (#2378,
 * #2426). The axe pass in `tests/e2e/a11y.spec.ts` catches it in a real
 * renderer; this catches the token choice before anything runs. Same spirit as
 * the modal-scrim and z-index-layering tests next door.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RENDERER = path.join(ROOT, 'src/renderer');

/** Body-surface tokens that must not paint text or a chip on the dark bar. */
const BODY_TOKENS = /var\(\s*--(text|text-muted|text-faint|bg-button|bg-button-hover)\s*[,)]/;

interface Rule { file: string; selector: string; body: string }

const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Flat `selector { body }` rules (comments stripped first) — enough for the
 *  renderer's CSS, which nests nothing. */
function rules(file: string, raw: string): Rule[] {
  const css = stripComments(raw);
  const out: Rule[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  for (let m = re.exec(css); m; m = re.exec(css)) {
    out.push({ file, selector: m[1].trim(), body: m[2] });
  }
  return out;
}

function styleSources(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.css')) out.push([path.relative(RENDERER, full), fs.readFileSync(full, 'utf-8')]);
      else if (entry.name.endsWith('.svelte')) {
        const style = /<style[^>]*>([\s\S]*?)<\/style>/.exec(fs.readFileSync(full, 'utf-8'));
        if (style) out.push([path.relative(RENDERER, full), style[1]]);
      }
    }
  };
  walk(RENDERER);
  return out;
}

function allRules(): Rule[] {
  return styleSources().flatMap(([file, src]) => rules(file, src));
}

describe('--bg-titlebar surfaces pair with --titlebar-* text', () => {
  it('a rule painting --bg-titlebar sets no body text token', () => {
    const offenders = allRules()
      .filter((r) => /background(-color)?\s*:\s*var\(\s*--bg-titlebar\b/.test(r.body))
      .filter((r) => {
        const color = /(?:^|[;\s])color\s*:([^;]*)/.exec(r.body);
        return color !== null && BODY_TOKENS.test(color[1]);
      })
      .map((r) => `${r.file}: ${r.selector}`);
    expect(offenders).toEqual([]);
  });

  it('nothing drawn on the preview fence toolbar uses a body token', () => {
    const css = fs.readFileSync(path.join(RENDERER, 'styles/preview-content.css'), 'utf-8');
    const onToolbar = rules('styles/preview-content.css', css)
      .filter((r) => /\.fence-(toolbar|lang|run-btn|refresh-btn|collapse-btn)\b/.test(r.selector));
    // The toolbar and every control on it — if this drops, the selectors moved.
    expect(onToolbar.length).toBeGreaterThanOrEqual(5);
    const offenders = onToolbar
      .filter((r) => BODY_TOKENS.test(r.body))
      .map((r) => r.selector.replace(/\s+/g, ' '));
    expect(offenders).toEqual([]);
  });
});
