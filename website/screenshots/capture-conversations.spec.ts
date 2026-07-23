/**
 * Docs screenshot harness — Conversations section.
 *
 * Three shots, all of the bottom-docked Conversations panel / the Proposals
 * panel. None of them can be produced by a live model call (non-deterministic,
 * API-key-gated), so each is driven from PRE-BAKED, deterministic state:
 *
 *   - conversations-chatting  — seed active conversation JSON (a real
 *     mandolin-history chat whose assistant turn carries web citations) into
 *     the copied vault's `.minerva/conversations/`, flip the "open on load"
 *     behavior, reload so `listActive()` picks them up, and crop the panel.
 *   - conversations-drafts    — same seeded panel, then push a `propose_notes`
 *     draft over the real `conversation:draft` IPC channel (exactly what a tool
 *     call does mid-turn) so an inline draft card renders, and crop the panel.
 *   - conversations-propose-review-approve — open the right sidebar's Proposals
 *     panel. A *pending* proposal can only be filed through the main-process
 *     approval engine (there is no renderer API that leaves one pending), so we
 *     best-effort the `__minervaE2E.seedProposal()` hook — a no-op unless the
 *     harness is launched with MINERVA_E2E=1. FLAGGED: without that hook the
 *     panel renders its empty state. See the return notes.
 *
 * Seeding via `window.api.notebase.writeFile` writes relative to the open
 * project root, so we never need the copy's absolute temp path. `writeFile`
 * only path-guards (it doesn't block `.minerva/`), so the JSON lands where the
 * conversation loader reads it.
 */
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchDemo, openNote, shoot, type Harness } from './lib/harness';

const FIXTURES = path.join(__dirname, 'fixtures', 'conversations');

/** The seeded active conversations, in list order. First user turn becomes the
 *  list title (see conversation-display.tabTitle). */
const SEED_CONVS = [
  'conv-docs-genoa',
  'conv-docs-materials',
  'conv-docs-history',
  'conv-docs-drafts',
] as const;

/** Panel height (logical px) written into `_ui.json` so the crop shows a real
 *  chunk of transcript, not the default 320px sliver. Under the 80vh CSS cap
 *  (900 × 0.8 = 720) and the store's 1200 clamp. */
const PANEL_HEIGHT = 620;

let h: Harness;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  h = await launchDemo();
});

test.afterAll(async () => {
  await h?.app.close().catch(() => { /* already exited */ });
  h?.cleanup();
});

/** Wait for the workspace to replace the welcome screen after a reload. Mirrors
 *  the post-launch settle in harness.launchDemo. */
async function waitForWorkspace(): Promise<void> {
  await h.win.waitForLoadState('domcontentloaded');
  await expect(h.win.getByRole('button', { name: 'Open Thoughtbase' }))
    .toHaveCount(0, { timeout: 30_000 });
  await h.win.waitForTimeout(1200);
}

/**
 * Seed the pre-baked active conversations into the copied vault, force the
 * panel to open on load with `activeId` selected + a taller height, then reload
 * so the conversations store re-inits and `listActive()` surfaces them.
 */
async function seedConversationsAndOpen(activeId: string): Promise<void> {
  // Read each fixture in Node (the test process) and hand the JSON to the
  // renderer, which writes it relative to the open project root.
  const files: Array<{ rel: string; content: string }> = SEED_CONVS.map((id) => ({
    rel: `.minerva/conversations/${id}.json`,
    content: fs.readFileSync(path.join(FIXTURES, `${id}.json`), 'utf-8'),
  }));
  // _ui.json: open at a good height with the target conversation active.
  files.push({
    rel: '.minerva/conversations/_ui.json',
    content: JSON.stringify({ visible: true, height: PANEL_HEIGHT, activeTabId: activeId }),
  });

  await h.win.evaluate(async (payloads: Array<{ rel: string; content: string }>) => {
    for (const f of payloads) await window.api.notebase.writeFile(f.rel, f.content);
    // Behavior flag the conversations store reads on load to show the panel
    // (persisted `visible` is deliberately ignored; this opts in).
    localStorage.setItem('conversationsSettings', JSON.stringify({ openOnLoad: true }));
  }, files);

  await h.win.reload();
  await waitForWorkspace();
  // Give the panel + MessageList (auto-scroll-to-bottom) time to paint.
  await h.win.waitForTimeout(900);
}

/** Click a conversation in the left list by a substring of its title (its first
 *  user turn), so the intended transcript is the active one before the crop. */
async function selectConversation(titleSubstring: string): Promise<void> {
  const item = h.win.locator('.conv-item-btn', { hasText: titleSubstring }).first();
  await item.click();
  await h.win.waitForTimeout(600);
}

/** Pin the transcript to its foot so the latest turn (and any citations / draft
 *  card anchored to it) is what the crop shows. */
async function scrollTranscriptToBottom(): Promise<void> {
  await h.win.evaluate(() => {
    const el = document.querySelector('.conv-panel .messages');
    if (el) el.scrollTop = el.scrollHeight;
  });
  await h.win.waitForTimeout(400);
}

// ── conversations-chatting ─────────────────────────────────────────────────
// A conversation mid-thread: the list on the left, the context rail ("From:"
// note + model), a user turn, and an assistant reply whose numbered web
// citations each carry a "cite" action.
test('conversations-chatting', async () => {
  await seedConversationsAndOpen('conv-docs-genoa');
  await selectConversation('1892 Genoa competition');
  await scrollTranscriptToBottom();
  await shoot(h.win, 'conversations-chatting', h.win.locator('.conv-panel'));
});

// ── conversations-drafts ───────────────────────────────────────────────────
// A propose_notes draft card sitting inline beneath the assistant turn. The
// card is pure runtime state (it arrives over Channels.CONVERSATION_DRAFT
// during a live turn and is never persisted), so we replay that exact IPC from
// the main process — the store's onDraft handler buckets it to the active tab
// and DraftCards renders it as an orphan under the last message.
test('conversations-drafts', async () => {
  await seedConversationsAndOpen('conv-docs-drafts');
  await selectConversation('two focused notes');

  const draft = {
    draftId: 'draft-docs-1',
    conversationId: 'conv-docs-drafts',
    createdAt: '2026-06-01T15:20:24.000Z',
    note: 'Splitting the 1892 Genoa note into two focused notes for review.',
    payloads: [
      {
        kind: 'note',
        relativePath: 'notes/mandolin-history/Carlo Munier and the Prize-Winning Quartet.md',
        content:
          '---\ntitle: Carlo Munier and the Prize-Winning Quartet\ntags: [mandolin-history, carlo-munier]\n---\n\n# Carlo Munier and the Prize-Winning Quartet\n\nCarlo Munier led the quartet that took first prize at the 1892 National\nCompetition of Genoa, cementing his reputation as the leading figure of the\nItalian classical-mandolin school.\n',
      },
      {
        kind: 'note',
        relativePath: 'notes/mandolin-history/The Mandolin-Orchestra Movement.md',
        content:
          '---\ntitle: The Mandolin-Orchestra Movement\ntags: [mandolin-history, ensembles]\n---\n\n# The Mandolin-Orchestra Movement\n\nThe 1892 Genoa win helped standardise the plucked-string orchestra — mandolins,\nmandolas, and mandocello — that spread across Italy and Europe over the next\ntwo decades.\n',
      },
    ],
  };

  // Replay the real main → renderer draft event.
  await h.app.evaluate(({ BrowserWindow }, payload) => {
    const win = BrowserWindow.getAllWindows()[0];
    win?.webContents.send('conversation:draft', payload);
  }, draft);
  await h.win.waitForTimeout(600);

  // Expand the first drafted note so its preview body is visible on the card.
  await h.win.locator('.draft-path-btn').first().click().catch(() => { /* card layout drift */ });
  await scrollTranscriptToBottom();
  await shoot(h.win, 'conversations-drafts', h.win.locator('.conv-panel'));
});

// ── conversations-propose-review-approve ───────────────────────────────────
// The Proposals panel with a pending proposal. FLAGGED: a pending proposal can
// only be filed through the main-process approval engine. We best-effort the
// MINERVA_E2E seed hook; if the harness didn't set MINERVA_E2E the hook is
// absent and the panel shows its empty state — a human must either launch the
// harness with MINERVA_E2E=1 or pre-bake a pending proposal into the demo graph.
test('conversations-propose-review-approve', async () => {
  // The proposals queue is seeded project-wide by the right-sidebar fixture's
  // embedded turtle (copied into the vault for every spec), so it's populated
  // here too. Open that note for a coherent editor context.
  await openNote(h.win, 'rsb-proposals');

  // Open the right sidebar → Activity group → Proposals panel.
  await h.win.locator('[title^="Toggle Right Sidebar"]').first().click();
  await h.win.waitForTimeout(400);
  await h.win.locator('.group-tab[title="Activity"]').first().click();
  await h.win.waitForTimeout(300);
  await h.win.locator('.sub-tab[title="Proposals"]').first().click();
  await h.win.waitForTimeout(600);

  // Select the first (newest, pending) proposal so its review detail expands —
  // payloads plus the Approve / Reject actions. That's the review→approve moment
  // this page is about, and distinguishes it from the plain Proposals list shot.
  await h.win.locator('.proposal-item').first().click();
  await h.win.waitForTimeout(600);

  await shoot(h.win, 'conversations-propose-review-approve', h.win.locator('aside.right-sidebar'));
});
