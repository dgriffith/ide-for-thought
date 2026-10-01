/**
 * Every left-sidebar panel scrolls when its content outgrows the sidebar.
 *
 * The Objects panel didn't: its root had no height constraint, so a long type
 * list ran past the bottom of `.panel-content` — which clips (`overflow:
 * hidden`) — and the rest of the list was simply unreachable. Nothing in the
 * unit suite can see that (jsdom does no layout), and each panel builds its
 * scroller differently, so this measures the one thing they must all get
 * right, in the real window:
 *
 *   - NOT CLIPPED: nothing inside `.panel-content` extends past its bottom;
 *     content past the edge there is lost, not scrolled.
 *   - NOT VACUOUS: some element inside it really is a scroller with content
 *     beyond its bottom — otherwise the seed data was too short to prove
 *     anything.
 *
 * The window opens at its minimum height (400px) so modest seed data
 * overflows every panel.
 */
import { test, expect, type Page } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot, seedProposal } from './helpers/launch';

const PANELS = ['Notes', 'Sources', 'Tags', 'Tables', 'Objects', 'Bookmarks', 'Proposals'] as const;

/** Enough of everything to outgrow a 400px window. */
function seedProject(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  for (let i = 0; i < 30; i++) {
    const id = `kind-${String(i).padStart(2, '0')}`;
    write(`.minerva/types/${id}.md`, `---\nlabel: Kind ${i}\nid: ${id}\nproperties:\n  - name: note\n    type: text\n---\n`);
  }
  // Root-level notes: the tree shows only top-level rows until a folder is
  // expanded, and expansion state isn't something to depend on (CI's runner
  // left them collapsed, so Notes had ~5 rows and proved nothing).
  for (let i = 0; i < 30; i++) write(`note-${String(i).padStart(2, '0')}.md`, `# Note ${i}\n`);
  write('notes/many-tags.md', `# Many tags\n\n${Array.from({ length: 40 }, (_, i) => `#topic-${i}`).join(' ')}\n`);
  for (let i = 0; i < 20; i++) write(`data/table-${i}.csv`, 'a,b\n1,2\n');
  write('.minerva/bookmarks.json', JSON.stringify(
    Array.from({ length: 30 }, (_, i) => ({
      type: 'bookmark', id: `bm-${i}`, name: `Bookmark ${i}`, relativePath: 'README.md',
    })),
  ));
}

async function measure(win: Page): Promise<{ clipped: number; scrolls: boolean }> {
  return win.evaluate(() => {
    const content = document.querySelector('.sidebar .panel-content') as HTMLElement;
    const bottom = content.getBoundingClientRect().bottom;
    let scrolls = false;
    for (const el of content.querySelectorAll<HTMLElement>('*')) {
      const oy = getComputedStyle(el).overflowY;
      if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) scrolls = true;
    }
    // Rows inside a scroller sit below its bottom by design; what matters is
    // whether the SCROLLERS (and anything not inside one) stay in bounds.
    let clipped = 0;
    const walk = (el: HTMLElement): void => {
      const r = el.getBoundingClientRect();
      if (r.height > 0) clipped = Math.max(clipped, r.bottom - bottom);
      const oy = getComputedStyle(el).overflowY;
      if (oy === 'auto' || oy === 'scroll' || oy === 'hidden') return; // its children are its business
      for (const c of el.children) walk(c as HTMLElement);
    };
    for (const c of content.children) walk(c as HTMLElement);
    return { clipped: Math.round(clipped), scrolls };
  });
}

test('every left-sidebar panel scrolls instead of running off the bottom', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-scroll-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-scroll-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seedProject(projectDir);
  fs.writeFileSync(
    path.join(userDataDir, 'session.json'),
    JSON.stringify([{ x: 80, y: 80, width: 1000, height: 400, rootPath: projectDir }]),
  );
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await expect(win.locator('[data-relative-path]').first()).toBeVisible({ timeout: 10_000 });
    for (let i = 0; i < 6; i++) await seedProposal(app);

    for (const panel of PANELS) {
      await test.step(panel, async () => {
        await win.locator(`.panel-tab[title="${panel}"]`).first().click();
        await expect(win.locator('.sidebar > .panel-header')).toContainText(panel);
        // Let the panel's data arrive and lay out: done once it either scrolls
        // or spills (the bug has no scroller at all, so wait for either).
        await expect.poll(async () => {
          const m = await measure(win);
          return m.scrolls || m.clipped > 1;
        }, { timeout: 10_000 }).toBe(true).catch(() => undefined);
        const { clipped, scrolls } = await measure(win);
        // Soft, so one broken panel doesn't hide the state of the rest.
        expect.soft(clipped, `${panel}: content runs ${clipped}px past the bottom of the sidebar, unreachable`).toBeLessThanOrEqual(1);
        if (clipped <= 1) {
          expect.soft(scrolls, `${panel}: the seed data never overflowed the panel, so nothing was proven`).toBe(true);
        }
        if (panel === 'Objects') {
          // The panel's rows keep their natural height once it has a definite
          // one: the Excerpts row is a flex:1 `.type-row` and must not stretch.
          const tallest = await win.locator('.objects-panel .type-row').evaluateAll(
            (rows) => Math.max(...rows.map((r) => r.getBoundingClientRect().height)),
          );
          expect.soft(tallest, 'an Objects row stretched to fill the panel').toBeLessThan(40);
        }
      });
    }
  } finally {
    await closeMinerva(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
