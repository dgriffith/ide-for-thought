/**
 * A thoughtbase's own SHACL shapes (#2874): `.minerva/shapes/*.ttl`, run in
 * the sweep with Minerva's — and, since they travel with a shared
 * thoughtbase, driven here by a hostile one: an injection in a message, a
 * shape that tries to write, one that tries the network, and one that runs
 * long and must be stopped, not started again on every sweep.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { indexAllNotes, queryGraph } from '../../../src/main/graph/index';
import { runAllChecks } from '../../../src/main/graph/health-checks';
import { _setShaclTimeoutForTests } from '../../../src/main/graph/shacl/run';
import {
  MAX_THOUGHTBASE_SHAPE_BYTES, MAX_THOUGHTBASE_SHAPE_FILES, thoughtbaseInspections, thoughtbaseShapes,
} from '../../../src/main/graph/shacl/thoughtbase-shapes';
import { useGraphProject } from '../../helpers/temp-project';
import { SHAPES_CANARY, writeHostileShapesThoughtbase } from '../../helpers/hostile-thoughtbase';
import { silenceLogTags } from '../../helpers/quiet-logs';

silenceLogTags('graph');

const project = useGraphProject('minerva-thoughtbase-shapes-');
const shapesDir = () => path.join(project.root, '.minerva', 'shapes');
const shape = (name: string, extra = '') => `@prefix sh: <http://www.w3.org/ns/shacl#> . @prefix minerva: <https://minerva.dev/ontology#> . @prefix ex: <https://example.org/s#> .
ex:${name} a sh:NodeShape ; sh:targetClass minerva:Note ; sh:name "${name}" ; sh:property [ sh:path ex:never ; sh:minCount 1 ] ${extra}.`;
function writeShape(file: string, text: string): void {
  fs.mkdirSync(shapesDir(), { recursive: true });
  fs.writeFileSync(path.join(shapesDir(), file), text);
}

describe('thoughtbaseShapes (#2874)', () => {
  beforeEach(async () => {
    fs.writeFileSync(path.join(project.root, 'a.md'), '# A\n');
    await indexAllNotes(project.ctx);
  });

  it('reads the folder\'s shapes as thoughtbase checks, in their own group by default', async () => {
    writeShape('tidy.ttl', shape('Tidy', '; minerva:inspectionGroup "notes" '));
    writeShape('other.ttl', shape('Other'));
    const got = await thoughtbaseInspections(project.ctx);
    expect(got.checks.map((c) => [c.type, c.group])).toEqual([['thoughtbase:Other', 'thoughtbase'], ['thoughtbase:Tidy', 'notes']]);
    expect(got.problems).toEqual([]);
  });

  it('none when there is no folder', async () => {
    expect(await thoughtbaseShapes(project.ctx)).toEqual({ files: [], problems: [] });
  });

  it('refuses a file past the folder\'s limits, and a shape declared twice, naming each', async () => {
    for (let i = 0; i < MAX_THOUGHTBASE_SHAPE_FILES + 1; i++) writeShape(`f${String(i).padStart(2, '0')}.ttl`, shape(`S${i}`));
    let got = await thoughtbaseShapes(project.ctx);
    expect(got.files).toHaveLength(MAX_THOUGHTBASE_SHAPE_FILES);
    expect(got.problems).toEqual([{ file: `f${MAX_THOUGHTBASE_SHAPE_FILES}.ttl`, problem: `a thoughtbase may carry at most ${MAX_THOUGHTBASE_SHAPE_FILES} shapes files` }]);
    fs.rmSync(shapesDir(), { recursive: true });
    writeShape('a.ttl', shape('Same'));
    writeShape('b.ttl', shape('Same'));
    writeShape('c.ttl', `# ${'x'.repeat(MAX_THOUGHTBASE_SHAPE_BYTES)}\n${shape('Big')}`);
    got = await thoughtbaseShapes(project.ctx);
    expect(got.problems).toEqual([
      { file: 'b.ttl', problem: "the shape thoughtbase:Same is already declared in another of the thoughtbase's files" },
      { file: 'c.ttl', problem: `the thoughtbase's shapes files may be at most ${MAX_THOUGHTBASE_SHAPE_BYTES} bytes in all` },
    ]);
  });

  it('reads again only when a file changes', async () => {
    writeShape('tidy.ttl', shape('Tidy'));
    const first = await thoughtbaseShapes(project.ctx);
    expect(await thoughtbaseShapes(project.ctx)).toBe(first);
    writeShape('tidy.ttl', shape('Tidier'));
    fs.utimesSync(path.join(shapesDir(), 'tidy.ttl'), new Date(), new Date(Date.now() + 5000));
    const second = await thoughtbaseShapes(project.ctx);
    expect(second).not.toBe(first);
    expect(second.files[0]!.file.checks[0]!.type).toBe('thoughtbase:Tidier');
  });
});

describe('a shared thoughtbase\'s hostile shapes, in the sweep (#2874)', () => {
  let hits = 0;
  const server = http.createServer((_req, res) => { hits += 1; res.end(''); });
  const listening = new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port)));
  afterAll(() => server.close());
  afterEach(() => _setShaclTimeoutForTests(null));

  it('the injection is a finding, the writer is refused, the network unreached, and the slow shape stopped, then skipped', async () => {
    const port = await listening;
    writeHostileShapesThoughtbase(project.root, { exfilUrl: `http://127.0.0.1:${port}/sparql` });
    await indexAllNotes(project.ctx);
    _setShaclTimeoutForTests(400);

    const listed = await thoughtbaseInspections(project.ctx);
    expect(listed.checks.map((c) => c.type).sort()).toEqual(['thoughtbase:Exfil', 'thoughtbase:Injection', 'thoughtbase:Slow']);
    expect(listed.problems).toEqual([{ file: 'writer.ttl', problem: 'a sh:select must be a SELECT query; a shape can only read the graph' }]);

    const deps = { thoughtbaseShapes };
    const found = await runAllChecks(project.ctx, undefined, deps);
    const injected = found.filter((i) => i.type === 'thoughtbase:Injection');
    expect(injected.length).toBeGreaterThan(0);
    // Its text arrives as written; it is the panel's to carry delimited (InspectionsPanel.test.ts).
    expect(injected[0]!.message).toContain(SHAPES_CANARY);
    expect(hits).toBe(0);
    const owned = await queryGraph(project.ctx, `SELECT ?s WHERE { ?s ?p "${SHAPES_CANARY}" }`);
    expect(owned.ok && owned.results).toEqual([]);

    // The slow shape ran past its limit: stopped, and the next sweep doesn't start it again.
    expect((await thoughtbaseInspections(project.ctx)).checks.find((c) => c.type === 'thoughtbase:Slow')?.stopped).toBe(true);
    const t0 = Date.now();
    await runAllChecks(project.ctx, undefined, deps);
    expect(Date.now() - t0).toBeLessThan(400);
  }, 30_000);
});
