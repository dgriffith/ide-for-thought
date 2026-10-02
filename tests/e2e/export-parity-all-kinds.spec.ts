/**
 * One note holding every live kind the preview renders, exported through the
 * real pipeline (#2515, epic #2508): each kind renders, and not one raw source
 * marker survives into the page. The per-kind specs (`export-*.spec.ts`)
 * compare each against the preview in depth; this one is the net under all of
 * them — the case where kinds interact in one export.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const BASE_URI = 'https://sample.minerva.dev/export-parity-e2e/';
const noteUri = (rel: string) => `${BASE_URI}note/${rel.replace(/\.(md|ttl)$/, '').split('/').map(encodeURIComponent).join('/')}`;
const HIDDEN_CANARY = 'urn:canary:parity-hidden';

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write('.minerva/config.json', JSON.stringify({ baseUri: BASE_URI }));
  write('.minerva/types/place.md', ['---', 'label: Place', 'id: place', 'icon: 📍', 'properties:', '  - name: city', '    type: text', '    label: City', '---', ''].join('\n'));
  write('places/Kampa Museum.md', '---\ntype: place\ncity: Prague\n---\n# Kampa Museum\n\n#museum\n');
  write('notes/The Claim.md', '---\ntitle: The Claim\n---\n\n# The Claim\n\n```turtle\nthis: a thought:Claim .\n```\n');
  write('notes/Cited Evidence.md', `---\ntitle: Cited Evidence\nsupports: ${noteUri('notes/The Claim.md')}\n---\n\n# Cited Evidence\n`);
  write('Everything.md', [
    '# Everything', '',
    '```object-view', '{"typeId":"place","layout":"list"}', '```', '',
    '```mermaid', 'graph TD; A[Start] --> B[Finish]', '```', '',
    ':::query-list', 'SELECT ?title ?path WHERE { ?note minerva:hasTag ?t . ?t minerva:tagName "museum" . ?note dc:title ?title . ?note minerva:relativePath ?path . }', ':::', '',
    ':::argument', '[[The Claim]]', ':::', '',
    '```python', 'print(1 + 1)', '```', '', '```output', '{"type":"text","value":"2"}', '```', '',
    '```vega-lite', '{"data":{"values":[{"a":1},{"a":2}]},"mark":"bar","encoding":{"x":{"field":"a","type":"ordinal"},"y":{"field":"a","type":"quantitative"}}}', '```', '',
    '```youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', '```', '',
    '```turtle-hidden', `<${HIDDEN_CANARY}> <urn:p> "x" .`, '```', '',
    '> [!note] Heads up', '> Callouts render.', '',
    '> [!card] ^c1', '> Capital of Czechia?', '>', '> ---', '>', '> Prague', '',
  ].join('\n'));
}

test('a note with every live kind exports each one rendered, no raw source left (#2515)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-parity-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-parity-project-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-parity-out-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 1000, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await expect(win.locator('[data-relative-path="Everything.md"]').first()).toBeVisible({ timeout: 10_000 });

    const html = await test.step('export through the real pipeline', async () => {
      const res = await win.evaluate(async (dir) => (window as unknown as {
        api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
      }).api.publish.runExport({
        exporterId: 'note-html', input: { kind: 'single-note', relativePath: 'Everything.md' }, outputDir: dir, linkPolicy: 'inline-title',
      }), outDir);
      const file = res!.writtenPaths.find((p) => p.endsWith('.html'))!;
      return fs.readFileSync(path.isAbsolute(file) ? file : path.join(outDir, file), 'utf-8');
    });

    await test.step('every kind rendered', async () => {
      expect(html.match(/class="minerva-live-block"/g)?.length, 'object view, mermaid, query, argument map, output').toBe(5);
      expect(html).toContain('Kampa Museum'); // the view's row, and the query's result
      expect(html).toMatch(/<svg[^>]*id="mermaid-export-/); // mermaid
      expect(html).toContain('Cited Evidence'); // the argument map's node
      expect(html).toContain('compute-output-text'); // the saved output
      expect(html).toMatch(/<img[^>]+src="data:image\/svg\+xml/); // the vega-lite chart
      expect(html).toContain('youtube'); // the linked thumbnail
      expect(html).toContain('callout-note');
      expect(html).toContain('callout-card');
      expect(html).toContain('Prague'); // the flashcard's answer is shown
    });

    await test.step('no raw source survives', async () => {
      for (const marker of ['```', ':::query', ':::argument', '[!note]', '[!card]', '&quot;typeId&quot;', '{&quot;type&quot;:&quot;text&quot;', 'graph TD;', HIDDEN_CANARY]) {
        expect(html, `raw "${marker}" in the export`).not.toContain(marker);
      }
      expect(html).not.toContain('couldn&#39;t be rendered for export');
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, outDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
