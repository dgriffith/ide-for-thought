/**
 * Keyboard-only journey (#2377).
 *
 * "Prefer keyboard" is a stated product principle (CLAUDE.md, *Stay out of the
 * way*), but until this spec nothing proved a real journey can be finished
 * without a pointer. Every other e2e clicks, or skips the UI altogether and
 * calls `window.api`. This one drives three steps through the renderer using
 * ONLY key presses and typed text:
 *
 *   1. Create a note — ⌘/Ctrl+N opens the New Note dialog (its name field is
 *      autofocused), type a name, Enter.
 *   2. Link it — type a `[[wiki-link]]` to an existing note into the editor
 *      that now has focus, ⌘/Ctrl+S to save. Asserted on disk and in the graph
 *      (a `minerva:linksTo` sub-property), not just in the buffer.
 *   3. Approve a proposal — Tab to the sidebar's Proposals tab, Enter; Tab to
 *      the Pending filter, Enter; Tab to the seeded proposal, Enter to expand
 *      it; Tab to Approve, Enter. Asserted in the graph and in the panel.
 *
 * Getting from the editor to the sidebar uses CodeMirror's documented escape
 * hatch: the editor binds Tab to indent (`indentWithTab`), and pressing Escape
 * first makes the NEXT Tab move focus instead. That is the only way out of the
 * editor by Tab alone, so it is exercised deliberately rather than bypassed.
 *
 * **No pointer, enforced.** A capture-phase listener on `window` counts every
 * pointerdown / pointerup / mousedown / mouseup / contextmenu / wheel, and every
 * `click` whose `detail > 0`. (Enter / Space on a button dispatch a synthetic
 * `click` with `detail === 0` — that is keyboard activation and is exactly what
 * this test wants, so it is not counted.) The count must be zero at the end.
 * `pointermove` / `mousemove` are deliberately NOT counted: on a local run the
 * OS cursor resting over the window can emit them with no test action at all,
 * and a hover changes nothing a keyboard user can't do.
 *
 * Tab navigation is a bounded walk (`tabUntil`): press Tab, check the focused
 * element, give up after `MAX_TABS`. Reading `document.activeElement` is an
 * observation, not an input. A control that can't be reached within the bound
 * fails the test with the list of what WAS focused, which is the useful output
 * when a keyboard trap appears.
 *
 * The proposal is SEEDED through the `MINERVA_E2E` main-process hook
 * (`src/main/e2e-hooks.ts`) — the same seam `proposal-review.spec.ts` uses,
 * because a live LLM conversation isn't CI-deterministic. That, plus
 * `window.api` READS for the outcome checks, are the only non-keyboard calls.
 *
 * Boots the in-tree `.vite/build` app, so it needs `pnpm build:e2e` first
 * (`pnpm test:e2e` does that).
 */
import { test, expect, type Page } from './helpers/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { closeMinerva, launchMinerva, projectRoot, seedProposal } from './helpers/launch';
import { expectAnnounced, recordAnnouncements } from './helpers/announcements';

// `window.api` is used inside `win.evaluate` — the renderer's global typing
// isn't in this spec's scope, so calls are validated at runtime, not by tsc.

/** Mirrors `E2E_CLAIM_LABEL` in src/main/e2e-hooks.ts. */
const CLAIM_LABEL = 'E2E Approved Claim';
/** The seeded proposal's `note`, rendered on its card. */
const PROPOSAL_NOTE = 'e2e seeded proposal';

/** The note this journey creates, and the existing fixture note it links to
 *  (`tests/fixtures/sample-project/notes/architecture.md`). */
const NEW_NOTE = 'kbd-journey';
const LINK_TARGET = 'architecture';

/** Upper bound on Tab presses to reach any one control. The whole window has
 *  well under this many tab stops; hitting it means the control is unreachable
 *  (or behind a trap), which is the failure this spec exists to report. */
const MAX_TABS = 150;

const CLAIM_QUERY =
  `SELECT ?c WHERE { ?c <https://minerva.dev/ontology/thought#label> "${CLAIM_LABEL}" }`;

function statusQuery(uri: string, status: 'pending' | 'approved'): string {
  return `SELECT ?p WHERE { <${uri}> thought:proposalStatus thought:${status} . BIND(<${uri}> AS ?p) }`;
}

// A plain `[[…]]` is `minerva:references`, a sub-property of `minerva:linksTo`
// (see the "Backlinks to note" stock query) — match through the hierarchy.
const LINK_QUERY = `SELECT ?target WHERE {
  ?source minerva:relativePath "${NEW_NOTE}.md" .
  ?source ?linkPred ?target .
  ?linkPred rdfs:subPropertyOf* minerva:linksTo .
  ?target minerva:relativePath "notes/${LINK_TARGET}.md" .
}`;

async function graphRowCount(win: Page, sparql: string): Promise<number> {
  const res = await win.evaluate((q) => window.api.graph.query(q), sparql);
  if (!res.ok) throw new Error(`SPARQL failed: ${res.error}\n${sparql}`);
  return res.results.length;
}

/** Install the pointer tripwire. Runs once; the page never reloads. */
async function installPointerCounter(win: Page): Promise<void> {
  await win.evaluate(() => {
    const w = window as unknown as { __pointerLog: string[] };
    w.__pointerLog = [];
    const log = (e: Event) => {
      const t = e.target as Element | null;
      w.__pointerLog.push(`${e.type} on ${t?.tagName ?? '?'}${t?.className ? '.' + String(t.className) : ''}`);
    };
    for (const type of ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'contextmenu', 'wheel']) {
      window.addEventListener(type, log, { capture: true });
    }
    // Keyboard activation of a button fires `click` with detail 0; a real
    // pointer click has detail >= 1.
    window.addEventListener('click', (e) => { if (e.detail > 0) log(e); }, { capture: true });
  });
}

async function pointerLog(win: Page): Promise<string[]> {
  return win.evaluate(() => (window as unknown as { __pointerLog: string[] }).__pointerLog);
}

/** A short, human-readable description of the focused element. */
async function describeFocus(win: Page): Promise<string> {
  return win.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return '<body>';
    const label = el.getAttribute('aria-label') ?? el.getAttribute('title') ?? el.textContent ?? '';
    return `${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} "${label.trim().slice(0, 40)}"`;
  });
}

/**
 * Press Tab until the focused element matches `selector` (and, if given,
 * contains `text`). Fails with the trail of focused elements if it doesn't
 * get there within `MAX_TABS` presses.
 */
async function tabUntil(win: Page, selector: string, text?: string): Promise<void> {
  const matches = () => win.evaluate(([sel, txt]) => {
    const el = document.activeElement;
    return !!el && el.matches(sel) && (!txt || (el.textContent ?? '').includes(txt));
  }, [selector, text ?? ''] as const);

  const trail: string[] = [];
  for (let i = 0; i < MAX_TABS; i++) {
    if (await matches()) return;
    await win.keyboard.press('Tab');
    trail.push(await describeFocus(win));
  }
  if (await matches()) return;
  throw new Error(
    `Could not Tab to ${selector}${text ? ` containing "${text}"` : ''} within ${MAX_TABS} presses.\n` +
    `Focus trail (last 25):\n  ${trail.slice(-25).join('\n  ')}`,
  );
}

test('keyboard only: create a note, wiki-link it, approve a proposal — no pointer events', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-kbd-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-kbd-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, 'session.json'),
    JSON.stringify([{ x: 80, y: 80, width: 1200, height: 800, rootPath: projectDir }]),
  );
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await win.waitForLoadState('domcontentloaded');
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });

    await installPointerCounter(win);
    // Announcements are asserted as a history, not a point-in-time read of the
    // region — see helpers/announcements.ts (#2379).
    await recordAnnouncements(win);

    // ── 1. Create a note ────────────────────────────────────────────────
    await win.keyboard.press('ControlOrMeta+KeyN');
    const dialog = win.getByRole('dialog', { name: 'New Note' });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    // The name field is autofocused — no Tab needed to start typing.
    await expect(dialog.getByRole('textbox')).toBeFocused();
    await win.keyboard.type(NEW_NOTE);
    await win.keyboard.press('Enter');
    await expect(dialog).toHaveCount(0);

    // The new note opens with the editor focused.
    const editor = win.locator('.cm-content');
    await expect(editor).toBeFocused({ timeout: 10_000 });
    expect(fs.existsSync(path.join(projectDir, `${NEW_NOTE}.md`)), 'note file should exist on disk').toBe(true);

    // ── 2. Add a wiki-link and save ─────────────────────────────────────
    await win.keyboard.type(`See [[${LINK_TARGET}]] for context.`);
    // `[[` opens link completion; dismiss it so no suggestion is accepted
    // over what was typed.
    await win.keyboard.press('Escape');
    await win.keyboard.press('ControlOrMeta+KeyS');

    await expect.poll(
      () => fs.readFileSync(path.join(projectDir, `${NEW_NOTE}.md`), 'utf8'),
      { message: 'saved note should contain the typed wiki-link' },
    ).toContain(`[[${LINK_TARGET}]]`);
    await expect.poll(() => graphRowCount(win, LINK_QUERY), {
      message: 'graph should record the new note → target wiki-link',
    }).toBeGreaterThan(0);

    // ── 3. Approve a pending proposal ───────────────────────────────────
    const uri = await seedProposal(app);
    expect(uri, 'seedProposal returned no uri').toBeTruthy();
    expect(await graphRowCount(win, statusQuery(uri!, 'pending'))).toBe(1);
    expect(await graphRowCount(win, CLAIM_QUERY), 'claim must be absent before review').toBe(0);

    // Leave the editor: Escape arms CodeMirror's tab-focus escape, so the
    // next Tab moves focus rather than indenting.
    await win.keyboard.press('Escape');
    await tabUntil(win, '.panel-tab[title="Proposals"]');
    await win.keyboard.press('Enter');

    const panel = win.locator('.proposals-panel');
    await expect(panel).toBeVisible();

    await tabUntil(win, '.proposals-panel .status-tab', 'Pending');
    await win.keyboard.press('Enter');
    await expect(panel.getByRole('tab', { name: 'Pending', exact: true })).toHaveAttribute('aria-selected', 'true');

    await tabUntil(win, '.proposals-panel .proposal-item', PROPOSAL_NOTE);
    await win.keyboard.press('Enter');
    await expect(panel.locator('.proposal-detail')).toBeVisible();

    await tabUntil(win, '.proposals-panel .action-btn.approve');
    await win.keyboard.press('Enter');

    await expect(panel.locator('.success-banner')).toContainText('Approved — landed');
    // …and a keyboard/screen-reader user hears it through the app's live
    // region, since the banner itself is not one (#2374).
    await expectAnnounced(win, 'Approved — landed');
    await expect.poll(() => graphRowCount(win, CLAIM_QUERY), {
      message: 'claim should be present after approving by keyboard',
    }).toBeGreaterThan(0);
    await expect.poll(() => graphRowCount(win, statusQuery(uri!, 'approved'))).toBe(1);
    expect(await graphRowCount(win, statusQuery(uri!, 'pending'))).toBe(0);

    // ── No pointer, at any point ────────────────────────────────────────
    expect(await pointerLog(win), 'the journey must not produce any pointer events').toEqual([]);
  } finally {
    await closeMinerva(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
