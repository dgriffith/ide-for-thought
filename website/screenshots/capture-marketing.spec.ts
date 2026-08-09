/**
 * Marketing-site screenshot harness (#website).
 *
 * Same machinery as the docs capture specs (launches the packaged app against a
 * copy of the demo thoughtbase), but the shots are the full-window "hero" images
 * the marketing pages call for, written to `website/img/<id>.png`. The page
 * placeholders are swapped in by `website/screenshots/swap-marketing-shots.mjs`,
 * keyed on each `.shot`'s `data-shot="<id>"`.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchDemo, openNote, setView, shoot, MARKETING_IMG_DIR, type Harness } from './lib/harness';

const CONV_FIXTURES = path.join(__dirname, 'fixtures', 'conversations');
const SEED_CONVS = ['conv-docs-genoa', 'conv-docs-materials', 'conv-docs-history', 'conv-docs-drafts'] as const;

let h: Harness;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => { h = await launchDemo(); });
test.afterAll(async () => {
  await h?.app.close().catch(() => { /* already exited */ });
  h?.cleanup();
});

/** Full-window marketing shot into website/img/<id>.png. */
async function shootWindow(id: string) {
  await shoot(h.win, id, undefined, MARKETING_IMG_DIR);
}

/** Ensure the right sidebar is open/closed — captures share one app instance,
 *  so each full-window shot must set the chrome it wants rather than inherit
 *  the previous shot's. */
async function setRightSidebar(open: boolean) {
  const visible = await h.win.locator('aside.right-sidebar').isVisible().catch(() => false);
  if (visible !== open) await h.win.locator('[title^="Toggle Right Sidebar"]').first().click();
  await h.win.waitForTimeout(300);
}

/** Fire a native-menu IPC message at the renderer (native menus can't be
 *  clicked by Playwright) — same trick the docs export spec uses. */
async function sendMenu(channel: string, arg?: string) {
  await h.app.evaluate(({ BrowserWindow }, { channel, arg }) => {
    for (const w of BrowserWindow.getAllWindows()) {
      if (arg === undefined) w.webContents.send(channel);
      else w.webContents.send(channel, arg);
    }
  }, { channel, arg });
}

async function waitForWorkspace() {
  await h.win.waitForLoadState('domcontentloaded');
  await expect(h.win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 30_000 });
  await h.win.waitForTimeout(1200);
}

/** Seed the pre-baked conversations into the copied vault and open the docked
 *  panel (same recipe as the docs conversations spec). */
async function seedConversationsAndOpen(activeId: string) {
  const files = SEED_CONVS.map((id) => ({
    rel: `.minerva/conversations/${id}.json`,
    content: fs.readFileSync(path.join(CONV_FIXTURES, `${id}.json`), 'utf-8'),
  }));
  files.push({ rel: '.minerva/conversations/_ui.json', content: JSON.stringify({ visible: true, height: 620, activeTabId: activeId }) });
  await h.win.evaluate(async (payloads: Array<{ rel: string; content: string }>) => {
    for (const f of payloads) await window.api.notebase.writeFile(f.rel, f.content);
    localStorage.setItem('conversationsSettings', JSON.stringify({ openOnLoad: true }));
  }, files);
  await h.win.reload();
  await waitForWorkspace();
  await h.win.waitForTimeout(900);
}

// ── Hero — the app in its best light: a rich note in split view. ────────────
// Used for both index.html and features.html heroes.
/**
 * Typed notes / object types (#1770). The demo vault has only two typed notes,
 * which would make the Objects panel read as an empty feature — so seed a
 * shelf of Books (in the vault's own subject, lutherie and music history) into
 * the THROWAWAY copy before shooting. The `horse` type already in the vault
 * stays visible on purpose: a user-made type beside the stock ones is the
 * point, not a blemish.
 */
const SEED_BOOKS: Array<{ title: string; author: string; published: string; rating: number; status: string }> = [
  { title: 'The Art of Violin Making', author: 'Chris Johnson', published: '1999-01-01', rating: 5, status: 'read' },
  { title: 'Lute Construction', author: 'Robert Lundberg', published: '2002-01-01', rating: 5, status: 'read' },
  { title: 'The Early Mandolin', author: 'James Tyler', published: '1989-01-01', rating: 4, status: 'read' },
  { title: 'Musical Instrument Design', author: 'Bart Hopkin', published: '1996-01-01', rating: 4, status: 'reading' },
  { title: 'Wood for Sound', author: 'Ulrike Wegst', published: '2006-01-01', rating: 3, status: 'to-read' },
  { title: 'A History of the Oud', author: 'Nasir Shamma', published: '2014-01-01', rating: 4, status: 'to-read' },
];

test('typed-objects', async () => {
  await setRightSidebar(false);
  await h.win.evaluate(async (books) => {
    const api = (window as unknown as {
      api: { notebase: { writeFile: (p: string, c: string) => Promise<unknown> } };
    }).api;
    for (const b of books) {
      const body = [
        '---',
        'type: book',
        `author: ${b.author}`,
        `published: ${b.published}`,
        `rating: ${b.rating}`,
        `status: ${b.status}`,
        '---',
        '',
        `# ${b.title}`,
        '',
        '## Summary',
        '',
        '## Notes',
        '',
      ].join('\n');
      await api.notebase.writeFile(`library/${b.title}.md`, body);
    }
  }, SEED_BOOKS);
  // Indexing is watcher-driven; give it a beat before asking for the view.
  await h.win.waitForTimeout(1500);

  await h.win.locator('aside.sidebar .panel-tab[title="Objects"]').click();
  await h.win.waitForTimeout(600);
  // Expand Book in the panel, then open its full view and switch to Table —
  // the columns ARE the type's declared fields, which is the whole idea.
  await h.win.locator('aside.sidebar .type-row', { hasText: 'Book' }).first().click();
  await h.win.waitForTimeout(400);
  await h.win.locator('aside.sidebar [aria-label="Open Book view"]').first().click();
  await h.win.waitForTimeout(800);
  await h.win.getByRole('tab', { name: 'Table' }).click();
  await h.win.waitForTimeout(600);

  await shootWindow('typed-objects');
});

test('index-hero', async () => {
  await openNote(h.win, 'Ancient Roots - The Oud and the Lute Family');
  await setView(h.win, 'Side by side');
  await setRightSidebar(false);
  await h.win.waitForTimeout(1200);
  await shootWindow('index-hero');
});

// ── A thoughtbase with depth — a rendered note + the outgoing-links web. ─────
test('thoughtbase-depth', async () => {
  await openNote(h.win, 'Ancient Roots - The Oud and the Lute Family');
  await setView(h.win, 'Preview');
  await h.win.locator('[title^="Toggle Right Sidebar"]').first().click();
  await h.win.waitForTimeout(500);
  await h.win.locator('.group-tab[title="Links"]').first().click();
  await h.win.waitForTimeout(300);
  await h.win.locator('.sub-tab[title="Outgoing"]').first().click();
  await h.win.waitForTimeout(700);
  await shootWindow('thoughtbase-depth');
});

// ── Editor / writing surface — the source pane at work. ─────────────────────
test('editor-split', async () => {
  await openNote(h.win, 'editor-writing-surface');
  await setView(h.win, 'Side by side');
  await setRightSidebar(false);
  await h.win.waitForTimeout(900);
  await shootWindow('editor-split');
});

// ── Data analysis — a note with live charts / query result blocks. ──────────
test('data-analysis', async () => {
  await openNote(h.win, 'charts');
  await setView(h.win, 'Preview');
  await setRightSidebar(false);
  await h.win.waitForTimeout(1800);
  await shootWindow('data-analysis');
});

// ── Proposal review — a pending AI proposal with Approve / Reject. ──────────
// Proposals are seeded project-wide by the rsb-proposals fixture's embedded
// turtle (copied into the vault for every run), so the queue is populated.
test('proposal-review', async () => {
  await openNote(h.win, 'rsb-proposals');
  await setView(h.win, 'Preview');
  await setRightSidebar(true);
  await h.win.locator('.group-tab[title="Activity"]').first().click();
  await h.win.waitForTimeout(300);
  await h.win.locator('.sub-tab[title="Proposals"]').first().click();
  await h.win.waitForTimeout(600);
  await h.win.locator('.proposal-item').first().click();
  await h.win.waitForTimeout(700);
  await shootWindow('proposal-review');
});

// ── Clipper + source — a captured source's detail view. ─────────────────────
test('clipper-source', async () => {
  await setRightSidebar(false);
  await h.win.getByTitle('Sources', { exact: true }).click();
  await h.win.waitForTimeout(600);
  // Open the first source in the list to reveal its metadata + excerpts.
  await h.win.locator('.source-item, .source-row, .source-list-item').first().click();
  await h.win.waitForTimeout(900);
  await shootWindow('clipper-source');
});

// ── Skills menu — the composer's `/` launcher (the DOM skills list). ─────────
// The Learning / Research / Analysis menus are native OS menus Playwright can't
// shoot; the composer `/` launcher is the DOM equivalent (same skills).
test('skills-menu', async () => {
  await setRightSidebar(false);
  // A note must be open for the editor toolbar's "New Conversation" button.
  await openNote(h.win, 'Ancient Roots - The Oud and the Lute Family');
  await setView(h.win, 'Preview');
  await h.win.locator('[title="New Conversation"]').first().click();
  const ta = h.win.locator('.composer textarea').first();
  await ta.waitFor({ state: 'visible', timeout: 5000 });
  await ta.click();
  await ta.fill('/');
  await h.win.locator('.slash-menu').first().waitFor({ state: 'visible', timeout: 5000 });
  await h.win.waitForTimeout(500);
  await shootWindow('skills-menu');
});

// ── Export menu — the Export dialog's include / exclude audit. ──────────────
test('export-menu', async () => {
  await sendMenu('menu:export', 'markdown');
  await h.win.waitForTimeout(900);
  const projectRadio = h.win.locator('input[name="scope"][value="project"]');
  if (await projectRadio.count()) await projectRadio.first().check();
  await h.win.waitForTimeout(1500);
  await shootWindow('export-menu');
  await h.win.getByRole('button', { name: 'Cancel', exact: true }).click().catch(() => {});
  await h.win.waitForTimeout(300);
});

// ── AI answering from the graph — a conversation with web citations. ────────
// Reloads the app to seed conversations, so it runs LAST.
test('ai-from-graph', async () => {
  await seedConversationsAndOpen('conv-docs-genoa');
  await h.win.locator('.conv-item-btn', { hasText: 'Give me some sources' }).first().click();
  await h.win.waitForTimeout(700);
  await h.win.evaluate(() => {
    const el = document.querySelector('.conv-panel .messages');
    if (el) el.scrollTop = el.scrollHeight;
  });
  await h.win.waitForTimeout(400);
  await shootWindow('ai-from-graph');
});
