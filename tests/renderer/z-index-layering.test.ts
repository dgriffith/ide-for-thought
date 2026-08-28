/**
 * Stacking-order invariants for the app's overlay layers.
 *
 * The bug this guards: the Settings panel and the generic prompt/confirm
 * dialogs both sat at `z-index: 2000`. Equal z-index leaves painting order to
 * the DOM, and `<DialogHost />` happens to render before `<SettingsDialog>` in
 * App.svelte — so "Rename" inside Settings → Object Types popped its prompt
 * BEHIND the panel that raised it. Same for the delete confirms, and toasts
 * (then at the popover tier) were invisible over any dialog.
 *
 * The fix is a tier scale in global.css, and the rule that a layer must
 * outrank anything that can OPEN it. These tests keep both halves honest:
 * the tiers stay ordered, and every overlay uses a token rather than a
 * literal that would silently re-tie with something else.
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
      else if (entry.name.endsWith('.svelte')) out.push([path.relative(RENDERER, full), fs.readFileSync(full, 'utf-8')]);
    }
  };
  walk(RENDERER);
  return out;
}

function tier(name: string): number {
  const m = new RegExp(`--z-${name}:\\s*(\\d+)`).exec(globalCss);
  if (!m) throw new Error(`--z-${name} is not defined in global.css`);
  return Number(m[1]);
}

describe('z-index tier scale', () => {
  it('defines every tier the components reference', () => {
    const used = new Set([...globalCss.matchAll(/--z-([a-z]+):/g)].map((m) => m[1]!));
    for (const [file, src] of svelteFiles()) {
      for (const m of src.matchAll(/var\(--z-([a-z]+)\)/g)) {
        expect(used, `${file} references an undefined tier --z-${m[1]}`).toContain(m[1]!);
      }
    }
  });

  it('orders the tiers strictly, lowest to highest', () => {
    const order = ['popover', 'viewer', 'modal', 'spawned', 'toast', 'drag', 'blocking'];
    const values = order.map(tier);
    for (let i = 1; i < values.length; i++) {
      expect(values[i], `--z-${order[i]} must outrank --z-${order[i - 1]}`).toBeGreaterThan(values[i - 1]!);
    }
  });

  it('puts prompt/confirm above modals, and toasts above both', () => {
    // The two orderings the reported bug turned on, asserted by name so the
    // intent survives a renumbering of the scale.
    expect(tier('spawned')).toBeGreaterThan(tier('modal'));
    expect(tier('toast')).toBeGreaterThan(tier('spawned'));
  });
});

describe('overlay components use the scale', () => {
  /** Dialogs DialogHost can raise from inside any other modal. */
  const SPAWNED = [
    'PromptDialog', 'ConfirmDialog', 'NewNoteDialog', 'SnippetPickerDialog',
    'TypePickerDialog', 'MergeSourcesDialog', 'OpenTargetDialog', 'AddPropertyDialog',
  ];

  it('gives every DialogHost dialog the spawned tier', () => {
    // These are exactly the components DialogHost renders; each must outrank a
    // modal because a modal is what typically raises it. Two forms count: a
    // hand-rolled backdrop setting the tier directly in CSS, or (PromptDialog /
    // ConfirmDialog, since #1888) composing ui/Dialog.svelte and passing it the
    // tier via the `zIndex` prop instead.
    const host = fs.readFileSync(path.join(RENDERER, 'lib/components/DialogHost.svelte'), 'utf-8');
    for (const name of SPAWNED) {
      expect(host, `DialogHost no longer renders ${name} — update this list`).toContain(`${name}.svelte`);
      const src = fs.readFileSync(path.join(RENDERER, `lib/components/${name}.svelte`), 'utf-8');
      const handRolled = src.includes('z-index: var(--z-spawned)');
      const viaDialogProp = src.includes('zIndex="var(--z-spawned)"');
      expect(handRolled || viaDialogProp, `${name} must use var(--z-spawned)`).toBe(true);
    }
  });

  it('has no bare numeric z-index on a full-screen overlay', () => {
    // A literal is how the original collision happened: two overlays reaching
    // the same number independently, with nothing to flag the tie. Any rule
    // that pins itself over the whole viewport is competing with every other
    // overlay in the app and must say where it sits in the scale. `PublishDialog`
    // and `ExportDialog` were found this way — modal backdrops stranded at 200.
    // Local stacking WITHIN a component (a label over its own chart, say) is
    // left alone: it never competes across components.
    const offenders: string[] = [];
    for (const [file, src] of svelteFiles()) {
      for (const rule of src.matchAll(/\{[^{}]*\}/g)) {
        const body = rule[0];
        const z = /z-index:\s*(\d+)/.exec(body);
        if (!z) continue;
        // A paint-nothing backdrop (`background: transparent|none`) is a
        // click-outside hit-target, not a visual layer — it's deliberately
        // pinned just under the one dropdown it dismisses, so it belongs to
        // that component's local stacking rather than the global scale.
        if (/background:\s*(transparent|none)\s*[;}]/.test(body)) continue;
        const fullScreen = /position:\s*fixed/.test(body) && /inset:\s*0|top:\s*0/.test(body);
        if (fullScreen || Number(z[1]) >= tier('popover')) offenders.push(`${file}: z-index: ${z[1]}`);
      }
    }
    expect(
      offenders,
      'Use a --z-* token from global.css instead of a literal, so the layer is ' +
      'ordered against every other overlay rather than by coincidence.\n' +
      offenders.join('\n'),
    ).toEqual([]);
  });
});
