/**
 * @vitest-environment jsdom
 *
 * The calendar export's inline styles (#2829): computed values are the
 * frame's pixels, so what has to scale with the page is put back as the rule
 * it was. Each case here was a broken export before it was a rule: rows
 * clipped to the frame's height, a bar's `›` mark taking its frame-width
 * margin and squeezing the title to "A.".
 */
import { describe, it, expect } from 'vitest';
import { inlineStyles } from '../../../plugins/calendar/src/inline-styles';

function exported(html: string): Document {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  const out = inlineStyles(host.firstElementChild as HTMLElement);
  host.remove();
  return new DOMParser().parseFromString(out, 'text/html');
}
const styleOf = (doc: Document, sel: string) => doc.querySelector<HTMLElement>(sel)!.style;

describe('inlineStyles (calendar export)', () => {
  const GRID = `<div class="calx calx-wk-on" style="height: 300px">
    <div class="calx-row calx-week" style="height: 120px; --bar-slots: 1">
      <div class="calx-day"><span class="calx-num">6</span>
        <span class="calx-bar calx-cont-after calx-approx" style="--span: 3; --solid: 40%">
          <span class="calx-hatch"></span><span class="calx-title">Apollo 11</span><span class="calx-mark calx-mark-after">›</span>
        </span>
      </div>
    </div>
    <span class="calx-swatch"></span>
  </div>`;

  it("copies no height but the fixed parts' — a row grows with its events", () => {
    const doc = exported(GRID);
    expect(styleOf(doc, '.calx').height).toBe('');
    expect(styleOf(doc, '.calx-week').height).toBe('');
    expect(styleOf(doc, '.calx-num').height).toBe('18px');
    expect(styleOf(doc, '.calx-bar').height).toBe('18px');
    expect(styleOf(doc, '.calx-swatch').height).toBe('10px');
  });

  it("scales with the page: the row's columns, a bar's span, where its hatch starts, its end mark's auto margin", () => {
    const doc = exported(GRID);
    expect(styleOf(doc, '.calx-row').gridTemplateColumns).toBe('2.6em repeat(7, minmax(0, 1fr))');
    // The attribute as the export carries it (a DOM would normalise the calc() on read).
    expect(doc.querySelector('.calx-bar')!.getAttribute('style')).toContain('width: calc(3 * 100% + (3 - 1) * 1px - 4px)');
    expect(styleOf(doc, '.calx-hatch').left).toBe('40%');
    expect(styleOf(doc, '.calx-mark-after').marginLeft).toBe('auto');
  });

  it('keeps the classes, which name the parts', () => {
    const doc = exported(GRID);
    expect(doc.querySelector('.calx-bar.calx-cont-after.calx-approx')).not.toBeNull();
  });
});
