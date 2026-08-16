/**
 * One backdrop for every modal (#1753).
 *
 * A user was filling in the New Note dialog with a filename Minerva had just
 * suggested in the conversation behind it — and couldn't read it, because the
 * backdrop blurred and dimmed the app. A dialog that hides the information it
 * exists to collect is working against itself.
 *
 * Thirty components had each hand-rolled the same backdrop, drifting into four
 * different opacities along the way, so "make it lighter" meant thirty edits
 * and any new dialog started from whatever its neighbour happened to use. The
 * scrim is a token now; these keep it that way, in the same spirit as the
 * z-index-layering tests next door.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const RENDERER = path.join(ROOT, 'src/renderer');
const globalCss = fs.readFileSync(path.join(RENDERER, 'styles/global.css'), 'utf-8');

/** Every `.svelte` file under src/renderer, as [relativePath, source]. */
function svelteFiles(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.svelte')) {
        out.push([path.relative(RENDERER, full), fs.readFileSync(full, 'utf-8')]);
      }
    }
  };
  walk(RENDERER);
  return out;
}

describe('modal scrim', () => {
  it('defines both scrim tokens', () => {
    expect(globalCss).toMatch(/--scrim-bg:\s*rgba\(/);
    expect(globalCss).toMatch(/--scrim-blur:/);
  });

  it('stays light enough to read the app through', () => {
    // The number that matters to the reported bug. Not a style preference: at
    // the old 0.5 the filename behind the dialog was unreadable, which is the
    // whole complaint. If someone raises this, they should have to change a
    // test that says why.
    const alpha = /--scrim-bg:\s*rgba\([^)]*?,\s*([\d.]+)\s*\)/.exec(globalCss);
    expect(alpha, '--scrim-bg must be an rgba() with an explicit alpha').not.toBeNull();
    expect(Number(alpha![1])).toBeLessThanOrEqual(0.35);
  });

  it('applies no blur, because blur is what destroys small text', () => {
    // Dimming separates the layers on its own. Kept as a token rather than
    // deleted at each call site, so reintroducing one is a single edit.
    expect(globalCss).toMatch(/--scrim-blur:\s*none/);
  });

  it('has no component hand-rolling its own scrim colour', () => {
    // The warm ink the backdrops all used. A literal here means a dialog that
    // won't follow when the token changes — which is how four opacities ended
    // up in the tree.
    const offenders = svelteFiles()
      .filter(([, src]) => /rgba\(\s*20\s*,\s*14\s*,\s*6\s*,/.test(src))
      .map(([file]) => file);
    expect(
      offenders,
      'Use var(--scrim-bg) so every modal shares one backdrop:\n' + offenders.join('\n'),
    ).toEqual([]);
  });

  it('has no component hand-rolling a backdrop blur', () => {
    const offenders = svelteFiles()
      .filter(([, src]) => /backdrop-filter:\s*blur\(/.test(src))
      .map(([file]) => file);
    expect(
      offenders,
      'Use var(--scrim-blur) rather than a local blur:\n' + offenders.join('\n'),
    ).toEqual([]);
  });

  it('still paints a backdrop on the dialogs that had one', () => {
    // The opposite failure: a search-and-replace that dropped the scrim
    // entirely would leave dialogs floating with no separation at all.
    for (const name of ['NewNoteDialog', 'PromptDialog', 'ConfirmDialog', 'SettingsDialog', 'ui/Dialog']) {
      const src = fs.readFileSync(path.join(RENDERER, `lib/components/${name}.svelte`), 'utf-8');
      expect(src, `${name} lost its backdrop`).toContain('var(--scrim-bg)');
    }
  });
});
