/**
 * A drawn graph as a standalone SVG (#2961): a box and label per note, a
 * line and a polygon arrowhead per link meeting the target's edge, every
 * colour an attribute (no <style>, no url(), which an export's sanitizer
 * drops), the camera's rectangle or all of it, a legend, and text escaped.
 */
import { describe, it, expect } from 'vitest';
import { graphSvg, boxWidth } from '../../../src/shared/graph/graph-svg';

const node = (id: string, x: number, y: number, over: object = {}) => ({ id, label: id, x, y, fill: '#eee', stroke: '#c00', text: '#111', ...over });
const BASE = { background: '#fff', text: '#222' };

describe('graphSvg (#2961)', () => {
  it('draws a box and label per note and a line with an arrowhead per link, coloured by attribute', () => {
    const svg = graphSvg({ ...BASE, nodes: [node('A', 0, 0), node('B', 200, 0)], edges: [{ source: 'A', target: 'B', color: '#00f' }] });
    expect(svg.match(/<rect [^>]*rx="5"/g)).toHaveLength(2);
    expect(svg).toContain('>A</text>');
    expect(svg).toContain('>B</text>');
    const line = /<line x1="([\d.-]+)" y1="0" x2="([\d.-]+)" y2="0" stroke="#00f"/.exec(svg)!;
    // From A's right edge to B's left edge.
    expect(Number(line[1])).toBeCloseTo(boxWidth('A') / 2, 0);
    expect(Number(line[2])).toBeCloseTo(200 - boxWidth('B') / 2, 0);
    expect(svg).toMatch(/<polygon points="[^"]+" fill="#00f"\/>/);
    expect(svg).not.toMatch(/<style|url\(/);
  });

  it('frames every note with a margin, or exactly the viewport asked for', () => {
    const all = graphSvg({ ...BASE, nodes: [node('A', 0, 0), node('B', 100, 50)], edges: [] });
    const [x, y, w, h] = /viewBox="([^"]+)"/.exec(all)![1]!.split(' ').map(Number);
    expect(x).toBeCloseTo(-boxWidth('A') / 2 - 24, 1);
    expect(y).toBe(-11 - 24);
    expect(w).toBeCloseTo(100 + boxWidth('A') / 2 + boxWidth('B') / 2 + 48, 1);
    expect(h).toBe(50 + 22 + 48);
    const cropped = graphSvg({ ...BASE, nodes: [node('A', 0, 0)], edges: [], viewport: { x1: -10, y1: -20, x2: 30, y2: 40 } });
    expect(/viewBox="([^"]+)"/.exec(cropped)![1]).toBe('-10 -20 40 60');
  });

  it('dashes, fades and leaves out an arrowhead when asked; skips a link to a note not drawn', () => {
    const svg = graphSvg({ ...BASE, nodes: [node('A', 0, 0, { dashed: true, opacity: 0.5 }), node('B', 0, 100)], edges: [
      { source: 'A', target: 'B', color: '#0a0', dashed: true, opacity: 0.4, arrow: false },
      { source: 'A', target: 'gone', color: '#f00' },
    ] });
    expect(svg).toContain('stroke-dasharray="4 3"');
    expect(svg).toContain('<g opacity="0.5">');
    expect(svg).toMatch(/<line [^>]*stroke-dasharray="5 4" opacity="0.4"\/>/);
    expect(svg).not.toContain('<polygon');
    expect(svg).not.toContain('#f00');
  });

  it('adds a legend under the graph, a title for screen readers, and escapes text', () => {
    const svg = graphSvg({ ...BASE, title: 'Tasks & "links"', nodes: [node('<A>', 0, 0)], edges: [], legend: [{ label: 'Blocks', color: '#a50' }] });
    expect(svg).toContain('<title>Tasks &amp; &quot;links&quot;</title>');
    expect(svg).toContain('aria-label="Tasks &amp; &quot;links&quot;"');
    expect(svg).toContain('&lt;A&gt;</text>');
    expect(svg).toMatch(/stroke="#a50" stroke-width="3"\/><text [^>]*>Blocks<\/text>/);
  });
});
