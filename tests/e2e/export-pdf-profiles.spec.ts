/**
 * PDF style profiles, rendered for real (#2429): one long note exported as
 * a PDF in Notes, Essay and Academic. A page-count sanity check per profile
 * (Academic, compact and two-column, takes fewer pages than Essay), and each
 * keeps text a reader can select (its fonts are embedded, so it isn't an
 * image of the page). The layouts themselves are held by the golden HTML in
 * tests/main/publish/pdf-profiles.test.ts.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const PARAGRAPH = 'Trees grow slowly, and a forest grows more slowly still: each ring of a trunk records a year of weather, light and competition, and reading them back is how the history of a stand is recovered when nobody was there to write it down.';

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write('.minerva/sources/smith-2020/meta.ttl', 'this: a thought:Article ;\n  dc:title "On the Growth of Things" ;\n  dc:creator "Smith, Jane" ;\n  dc:issued "2020-04-15"^^xsd:date .\n');
  const sections = Array.from({ length: 8 }, (_, i) => [
    `## Section ${i + 1}`, '',
    ...Array.from({ length: 4 }, () => `${PARAGRAPH} As [[cite::smith-2020]] showed.`).flatMap((p) => [p, '']),
    '| Year | Rings |', '|---|---|', ...Array.from({ length: 6 }, (_, r) => `| ${2000 + r} | ${r * 3} |`), '',
  ]).flat();
  write('Growth.md', ['---', 'title: On Growth', 'author: Ada Lovelace', 'date: 2026-05-01', '---', '# On Growth', '', ...sections].join('\n'));
}

const pageCount = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;

test('a note exports as a PDF in each style profile (#2429)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-pdf-profiles-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-pdf-profiles-project-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-pdf-profiles-out-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1200, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await expect(win.locator('[data-relative-path="Growth.md"]').first()).toBeVisible({ timeout: 10_000 });

    const pages: Record<string, number> = {};
    for (const profile of ['notes', 'essay', 'academic'] as const) {
      await test.step(`${profile}`, async () => {
        const dir = path.join(outDir, profile);
        fs.mkdirSync(dir);
        const res = await win.evaluate(async ({ dir, profile }) => (window as unknown as {
          api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
        }).api.publish.runExport({
          exporterId: 'note-pdf', input: { kind: 'single-note', relativePath: 'Growth.md' }, outputDir: dir, linkPolicy: 'inline-title', pdfProfile: profile,
        }), { dir, profile });
        const written = res!.writtenPaths.find((p) => p.endsWith('.pdf'))!;
        const pdf = fs.readFileSync(path.isAbsolute(written) ? written : path.join(dir, written));
        expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
        expect(pdf.toString('latin1'), 'fonts embedded: the text is selectable').toMatch(/\/FontFile2|\/FontFile3|\/Type\s*\/Font/);
        pages[profile] = pageCount(pdf);
        expect(pages[profile], `${profile} has pages`).toBeGreaterThan(0);
        fs.copyFileSync(path.isAbsolute(written) ? written : path.join(dir, written), `test-results/export-pdf-profile-${profile}.pdf`);
      });
    }
    // Two compact columns hold more per page than one wide reading column.
    expect(pages.academic!).toBeLessThan(pages.essay!);
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, outDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
