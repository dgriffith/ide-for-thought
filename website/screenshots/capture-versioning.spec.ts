/**
 * Docs screenshot harness — Versioning (the History panel).
 *
 * The History panel is the one panel whose content doesn't live in a note: it
 * reads `.minerva/history/<note path>/`, which a freshly-copied demo vault has
 * none of. So this spec seeds that directory directly, in the app's own on-disk
 * format (an `index.json` of revision metadata plus one `<ts>.snap` per
 * revision), before the app is launched against the copy.
 *
 * That's the same posture as the pre-baked proposal fixtures: real data in the
 * real format, so the real panel renders it — nothing about the shot is faked
 * except the passage of time. Timestamps are minted relative to capture time so
 * the timeline always reads as a recent afternoon's work rather than a date
 * frozen the day the fixture was written.
 */
import { test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchDemo, openNote, shoot, type Harness } from './lib/harness';

/** The fixture note, dropped into the vault root by the harness. */
const NOTE = 'Bowl-Back Revival';
const NOTE_FILE = `${NOTE}.md`;

let h: Harness;

test.describe.configure({ mode: 'serial' });

/**
 * Write a believable history for the fixture note: a baseline, a couple of
 * hand edits, an AI-applied rewrite from a named skill, and one version the
 * author named. Each revision's snapshot is a real earlier state of the note,
 * so the diff the panel draws against the current text is a real diff.
 */
function seedHistory(projectDir: string): void {
  const dir = path.join(projectDir, '.minerva', 'history', NOTE_FILE);
  fs.mkdirSync(dir, { recursive: true });

  const current = fs.readFileSync(path.join(projectDir, NOTE_FILE), 'utf-8');
  const MINUTE = 60_000;
  const now = Date.now();

  // Oldest → newest: the note started as an intro, grew two sections, got its
  // tags from Auto-tag, was named before a rewrite, and was last touched by a
  // skill — one of each kind of cause the panel knows how to name.
  const untagged = current.replace(/^tags: .*\n/m, '');
  const cut = (text: string, heading: string) => text.slice(0, text.indexOf(heading)).trimEnd() + '\n';

  const revisions = [
    {
      minutesAgo: 96,
      origin: 'edit' as const,
      cause: 'Initial version',
      initial: true,
      content: cut(untagged, '## Why it fell out of favour'),
    },
    {
      minutesAgo: 78,
      origin: 'edit' as const,
      content: cut(untagged, '## What the revival players want'),
    },
    {
      // Auto-tag's rewrite adds the frontmatter tags — a small, legible diff
      // that shows exactly what an AI-applied version looks like.
      minutesAgo: 61,
      origin: 'proposal' as const,
      cause: 'Auto-tag',
      content: cut(current, '## What the revival players want'),
    },
    {
      minutesAgo: 43,
      origin: 'edit' as const,
      label: 'before rewrite',
      content: current
        .replace('A bowl-back gives a rounder, shorter note that suits Vivaldi and\nNeapolitan song far better than a carved top does — the repertoire came first\nand the instrument followed it back.',
                 'Bowl-backs are quieter but they sound better for this music, which is\nprobably why the revival started with early-music players.'),
    },
    {
      minutesAgo: 28,
      origin: 'proposal' as const,
      cause: 'Antithesize',
      content: current.replace('the repertoire came first\nand the instrument followed it back.', 'the repertoire came first.'),
    },
  ];

  const index = revisions.map((r) => {
    const ts = now - r.minutesAgo * MINUTE;
    fs.writeFileSync(path.join(dir, `${ts}.snap`), r.content, 'utf-8');
    return {
      ts,
      origin: r.origin,
      ...(r.cause ? { cause: r.cause } : {}),
      ...(r.initial ? { initial: true } : {}),
      ...(r.label ? { label: r.label } : {}),
    };
  });

  // Newest first, matching how the store writes it.
  index.sort((a, b) => b.ts - a.ts);
  fs.writeFileSync(path.join(dir, 'index.json'), JSON.stringify(index, null, 2), 'utf-8');
}

test.beforeAll(async () => {
  h = await launchDemo();
  seedHistory(h.projectDir);
});

test.afterAll(async () => {
  await h?.app.close().catch(() => { /* already exited */ });
  h?.cleanup();
});

/** Reveal the right sidebar if it isn't already showing. Persistent toggle, so
 *  a blind click would close it on the second test. */
async function ensureRightSidebar(): Promise<void> {
  const aside = h.win.locator('aside.right-sidebar');
  if (await aside.isVisible().catch(() => false)) return;
  await h.win.locator('[title^="Toggle Right Sidebar"]').first().click();
  await aside.waitFor({ state: 'visible', timeout: 5000 });
  await h.win.waitForTimeout(400);
}

/** Widen the right sidebar so the diff's lines don't wrap every few words.
 *  Drags the panel's own resize handle — the same thing a reader would do. */
async function widenSidebar(toWidth: number): Promise<void> {
  const handle = h.win.locator('aside.right-sidebar .resize-handle');
  const box = await handle.boundingBox();
  const aside = await h.win.locator('aside.right-sidebar').boundingBox();
  if (!box || !aside || aside.width >= toWidth) return;
  await h.win.mouse.move(box.x + box.width / 2, box.y + 200);
  await h.win.mouse.down();
  await h.win.mouse.move(box.x - (toWidth - aside.width), box.y + 200, { steps: 12 });
  await h.win.mouse.up();
  await h.win.waitForTimeout(300);
}

/** Open the fixture note with the History panel showing. */
async function openHistory(): Promise<void> {
  await openNote(h.win, NOTE);
  await ensureRightSidebar();
  await widenSidebar(430);
  await h.win.locator('.group-tab[title="Note"]').first().click();
  await h.win.waitForTimeout(200);
  await h.win.locator('.sub-tab[title="History"]').first().click();
  await h.win.waitForTimeout(600);
}

test('right-sidebar-history', async () => {
  await openHistory();
  // Select the named version: its diff against the current text is the
  // rewrite, so the shot shows the whole story at once — the timeline with its
  // causes and label, the +/− counts, Restore, and a real diff.
  await h.win.locator('.timeline li').nth(1).click();
  await h.win.waitForTimeout(500);
  // The diff opens at the top of the note, which for this fixture is a screen
  // of unchanged context. Scroll the changed lines into view so the shot shows
  // an actual diff rather than the note's frontmatter.
  await h.win.locator('.diff .line.add').first().scrollIntoViewIfNeeded();
  await h.win.waitForTimeout(300);
  await shoot(h.win, 'right-sidebar-history', h.win.locator('aside.right-sidebar'));
});

test('right-sidebar-history-label', async () => {
  await openHistory();
  // Right-click an UNNAMED version: the menu then offers "Label Version…",
  // which is the action a reader is here to learn. (Right-clicking a named one
  // offers Rename / Remove instead.) The menu is position:fixed but opens at
  // the cursor, i.e. inside the sidebar's box, so the panel crop still catches
  // it — and reads far better than a full-window shot of a 140px menu.
  await h.win.locator('.timeline li').first().click({ button: 'right' });
  await h.win.waitForTimeout(400);
  await shoot(h.win, 'right-sidebar-history-label', h.win.locator('aside.right-sidebar'));
});
