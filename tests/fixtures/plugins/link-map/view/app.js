// Link Map's page: Minerva runs links.rq and sends the rows as a `query`
// event (again whenever the graph changes). It draws a node per note and a
// line per link; a node opens its note. It asks for no note's text: its rows
// and their paths are all it needs, so it declares no notes:read.
import { connect } from '/@minerva/plugin-api.js';
import { layout } from './layout.js';

const SVG = 'http://www.w3.org/2000/svg';
const minerva = await connect();
const map = document.getElementById('map');
const summary = document.getElementById('summary');
const title = (path) => path.replace(/^.*\//, '').replace(/\.md$/, '');

let last = null;
// Redrawn to the frame's own shape: a tall panel or a wide tab.
new ResizeObserver(() => { if (last) draw(last); }).observe(map);

minerva.on('query', (results) => { last = results; draw(results); });

function draw({ rows, notes, error }) {
  if (error) { summary.textContent = error; map.replaceChildren(); return; }
  const ids = [...new Set(rows.map((r) => r.note).filter((iri) => notes[iri]))].sort((a, b) => notes[a].localeCompare(notes[b]));
  const edges = [...new Set(rows.filter((r) => r.target && notes[r.note] && notes[r.target]).map((r) => `${r.note} ${r.target}`))].map((e) => e.split(' '));
  summary.textContent = `${ids.length} ${ids.length === 1 ? 'note' : 'notes'}, ${edges.length} ${edges.length === 1 ? 'link' : 'links'}`;
  const box = map.getBoundingClientRect();
  const width = Math.max(200, Math.round(box.width));
  const height = Math.max(200, Math.round(box.height));
  map.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const at = layout(ids, edges, { width, height });
  const lines = edges.map(([a, b]) => {
    const line = document.createElementNS(SVG, 'line');
    for (const [k, v] of [['x1', at.get(a).x], ['y1', at.get(a).y], ['x2', at.get(b).x], ['y2', at.get(b).y]]) line.setAttribute(k, String(v));
    line.setAttribute('class', 'edge');
    return line;
  });
  const nodes = ids.map((iri) => {
    const g = document.createElementNS(SVG, 'g');
    const { x, y } = at.get(iri);
    g.setAttribute('class', 'node');
    g.setAttribute('transform', `translate(${x} ${y})`);
    g.setAttribute('role', 'button');
    g.setAttribute('tabindex', '0');
    g.setAttribute('aria-label', `Open ${title(notes[iri])}`);
    const dot = document.createElementNS(SVG, 'circle');
    dot.setAttribute('r', '6');
    const label = document.createElementNS(SVG, 'text');
    label.setAttribute('x', '9');
    label.setAttribute('y', '4');
    label.textContent = title(notes[iri]);
    g.append(dot, label);
    const open = () => { void minerva.ui.openNote({ path: notes[iri] }).catch(() => undefined); };
    g.addEventListener('click', open);
    g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    return g;
  });
  map.replaceChildren(...lines, ...nodes);
}
