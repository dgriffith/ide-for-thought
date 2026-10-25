// A small force-directed layout: links pull, every pair pushes, a weak pull to
// the middle keeps islands on screen. Deterministic: same notes, same map.
export function layout(ids, edges, { width = 400, height = 400, steps = 240 } = {}) {
  const n = ids.length;
  const pos = ids.map((_, i) => {
    const a = (2 * Math.PI * i) / Math.max(n, 1);
    return { x: Math.cos(a) * 100, y: Math.sin(a) * 100 };
  });
  const index = new Map(ids.map((id, i) => [id, i]));
  const links = edges.map(([a, b]) => [index.get(a), index.get(b)]).filter(([a, b]) => a !== undefined && b !== undefined);
  for (let step = 0; step < steps; step++) {
    const force = pos.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i].x - pos[j].x || 0.01;
        const dy = pos[i].y - pos[j].y || 0.01;
        const d2 = dx * dx + dy * dy;
        const push = 4000 / d2;
        force[i].x += dx * push; force[i].y += dy * push;
        force[j].x -= dx * push; force[j].y -= dy * push;
      }
    }
    for (const [a, b] of links) {
      const dx = pos[b].x - pos[a].x;
      const dy = pos[b].y - pos[a].y;
      force[a].x += dx * 0.02; force[a].y += dy * 0.02;
      force[b].x -= dx * 0.02; force[b].y -= dy * 0.02;
    }
    const cool = 1 - step / steps;
    for (let i = 0; i < n; i++) {
      pos[i].x += Math.max(-10, Math.min(10, force[i].x - pos[i].x * 0.01)) * cool;
      pos[i].y += Math.max(-10, Math.min(10, force[i].y - pos[i].y * 0.01)) * cool;
    }
  }
  // Fit the box, with room for a label.
  const xs = pos.map((p) => p.x);
  const ys = pos.map((p) => p.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  // Stretched to the box on each axis: a tall panel gets a tall map.
  const pad = 30;
  const sx = (width - 2 * pad - 80) / Math.max(maxX - minX, 1);
  const sy = (height - 2 * pad) / Math.max(maxY - minY, 1);
  return new Map(ids.map((id, i) => [id, { x: pad + (pos[i].x - minX) * sx, y: pad + (pos[i].y - minY) * sy }]));
}
