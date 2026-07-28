/**
 * Four more end-to-end user journeys (#1098), each assembled through the real
 * Electron app + preload/IPC bridge + main-process pipeline — the same
 * philosophy as happy-paths.spec.ts (drive `window.api`, the exact bridge the UI
 * calls, rather than simulating CodeMirror keystrokes / panel clicks, which are
 * brittle and just re-test the component suite):
 *
 *   1. Source ingestion       — seed a source through the real ingest
 *      persistence pipeline (offline, via the MINERVA_E2E hook) → it appears in
 *      `api.sources.listAll()` and its files land under `.minerva/sources/`.
 *   2. Publish / export        — `api.publish.runExport` writes the whole
 *      thoughtbase to a temp dir → files actually land on disk.
 *   3. Conversation round-trip — create a conversation, append turns, reload it
 *      through the log, then file a `propose_notes` draft → the note is written
 *      and the graph reflects it.
 *   4. Rename + link-rewrite   — rename a note via `api.notebase.rename` → a
 *      wiki-link in another note is rewritten to the new name.
 *
 * The non-deterministic pieces (a live network fetch for #1, a live LLM turn for
 * #3) are seeded deterministically: ingestion via the `MINERVA_E2E`
 * `ingestSource` hook (`src/main/e2e-hooks.ts`), and the conversation transcript
 * by appending turns directly rather than calling `send`. The safety-critical
 * halves — the ingest persistence, the export writer, the draft→approve→graph
 * apply, the link rewrite — all run for real.
 *
 * Boots the in-tree `.vite/build` app (like happy-paths.spec.ts), so it needs
 * `pnpm build:e2e` first (the `pnpm test:e2e` script does that).
 */
import { test, expect, _electron as electron, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const projectRoot = path.resolve(__dirname, '..', '..');

// These flows call `window.api` (the preload bridge) inside `win.evaluate` — the
// renderer's global typing isn't in this spec's scope, so `window` reads as
// `any` here and the `.api.*` calls are validated at runtime, not by tsc. Same
// convention as happy-paths.spec.ts.

// Kept in sync with the constants in src/main/e2e-hooks.ts (hardcoded rather
// than imported so this spec doesn't pull main-process/electron modules into the
// Playwright node context).
const E2E_SOURCE_TITLE = 'E2E Ingested Source';

async function launchWithProject() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-journeys-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-journeys-project-'));
  // Copy the fixture so the run can't dirty the tracked one.
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, 'session.json'),
    JSON.stringify([{ x: 80, y: 80, width: 1200, height: 800, rootPath: projectDir }]),
  );
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${userDataDir}`],
    cwd: projectRoot,
    timeout: 60_000,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1', MINERVA_E2E: '1' },
  });
  return { app, userDataDir, projectDir };
}

/** Wait until the workspace has replaced the welcome screen (project open). */
async function waitForWorkspace(win: Page): Promise<void> {
  await win.waitForLoadState('domcontentloaded');
  await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
}

test('journey: ingest a source → it lands in the source list and on disk', async () => {
  const { app, userDataDir, projectDir } = await launchWithProject();
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await waitForWorkspace(win);

    // Ingest through the real persistence pipeline, offline. `ingestSource`
    // stands in for `api.sources.ingestUrl`'s post-fetch half (fetching a live
    // URL isn't CI-deterministic); the persist → index → meta.ttl path is real.
    const seeded = await app.evaluate(async () => {
      const g = globalThis as typeof globalThis & {
        __minervaE2E?: { ingestSource(): Promise<{ sourceId: string; title: string }> };
      };
      if (!g.__minervaE2E) throw new Error('e2e hook missing — MINERVA_E2E not set?');
      return g.__minervaE2E.ingestSource();
    });
    expect(seeded?.sourceId, 'ingestSource returned no sourceId').toBeTruthy();
    expect(seeded.title).toBe(E2E_SOURCE_TITLE);

    // The marquee assertion: the ingested source is surfaced by the real
    // sources IPC the Sources panel reads.
    const sources = await win.evaluate(() => window.api.sources.listAll());
    const match = (sources as Array<{ sourceId: string; title: string | null }>)
      .find((s) => s.sourceId === seeded.sourceId);
    expect(match, 'ingested source missing from listAll()').toBeTruthy();
    expect(match!.title).toBe(E2E_SOURCE_TITLE);

    // And it persisted to the canonical on-disk layout (meta.ttl under the id).
    const metaRel = `.minerva/sources/${seeded.sourceId}/meta.ttl`;
    const meta = await win.evaluate((rel) => window.api.notebase.readFile(rel), metaRel);
    expect(meta, 'source meta.ttl not written').toContain(E2E_SOURCE_TITLE);
  } finally {
    await app.close().catch(() => { /* already exited */ });
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('journey: export the thoughtbase → files are written to the output dir', async () => {
  const { app, userDataDir, projectDir } = await launchWithProject();
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-journeys-export-'));
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await waitForWorkspace(win);

    // Pick a real registered exporter that accepts a whole-project export, so
    // this stays valid if the default exporter set is reordered/renamed.
    const exporterId = await win.evaluate(async () => {
      const exporters = await window.api.publish.listExporters();
      const project = exporters.find((e: { acceptedKinds: string[] }) => e.acceptedKinds.includes('project'));
      return project?.id ?? null;
    });
    expect(exporterId, 'no exporter accepts a project-scope export').toBeTruthy();

    // Run the real exporter with an explicit outputDir (so no directory picker
    // opens — the call resolves to null only on a cancelled picker).
    const result = await win.evaluate(async ([id, out]) => {
      return window.api.publish.runExport({
        exporterId: id,
        input: { kind: 'project' },
        outputDir: out,
      });
    }, [exporterId, outputDir] as const);

    expect(result, 'runExport resolved null (picker cancelled?)').toBeTruthy();
    expect(result!.filesWritten, 'export wrote no files').toBeGreaterThan(0);

    // Verify from the outside: real files exist under the output dir. The
    // fixture has several notes, so a project export must produce something.
    const written = fs.readdirSync(outputDir, { recursive: true }) as string[];
    expect(written.length, 'output dir is empty after export').toBeGreaterThan(0);
  } finally {
    await app.close().catch(() => { /* already exited */ });
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
    fs.rmSync(outputDir, { recursive: true, force: true });
  }
});

test('journey: conversation round-trip → transcript persists, filed draft writes a note', async () => {
  const { app, userDataDir, projectDir } = await launchWithProject();
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await waitForWorkspace(win);

    // Create + append through the real conversation IPC (no LLM call — `create`
    // and `append` just persist the log; `send` is the LLM path we avoid).
    const convId = await win.evaluate(async () => {
      const conv = await window.api.conversations.create({
        noteContent: 'seed note body',
        notePath: 'notes/architecture.md',
      });
      await window.api.conversations.append(conv.id, 'user', 'E2E user turn');
      await window.api.conversations.append(conv.id, 'assistant', 'E2E assistant turn');
      return conv.id;
    });
    expect(convId, 'create returned no conversation id').toBeTruthy();

    // Round-trip: reload the conversation from the log and confirm both turns
    // survived, and that it's surfaced by the list IPC the panel reads.
    const loaded = await win.evaluate((id) => window.api.conversations.load(id), convId);
    const contents = (loaded?.messages as Array<{ content: string }> | undefined)?.map((m) => m.content) ?? [];
    expect(contents).toContain('E2E user turn');
    expect(contents).toContain('E2E assistant turn');
    const listed = await win.evaluate(() => window.api.conversations.list());
    expect((listed as Array<{ id: string }>).some((c) => c.id === convId), 'conversation not in list()').toBe(true);

    // File a propose_notes draft (the exact bundle a mid-conversation tool call
    // produces) through the real fileDraft → approval → graph apply path.
    const noteTitle = 'E2E Conversation Note';
    const rel = 'notes/e2e-conversation-note.md';
    const filed = await win.evaluate(async ([id, relPath, title]) => {
      return window.api.conversations.fileDraft({
        draftId: 'e2e-draft-1',
        conversationId: id,
        createdAt: '2026-01-01T00:00:00.000Z',
        note: 'e2e filed draft',
        payloads: [{ kind: 'note', relativePath: relPath, content: `---\ntitle: ${title}\n---\n\nbody\n` }],
      });
    }, [convId, rel, noteTitle] as const);
    expect(filed?.applied, 'fileDraft did not apply').toBe(true);
    expect(filed.filedPaths.length, 'no files filed by draft').toBeGreaterThan(0);

    // The filed note is reflected in the graph — the whole point of the round trip.
    const res = await win.evaluate((title) =>
      window.api.graph.query(
        `SELECT ?title WHERE { ?note rdf:type minerva:Note ; dc:title ?title . FILTER(CONTAINS(STR(?title), "${title}")) }`,
      ), noteTitle);
    expect(res.error, res.error).toBeFalsy();
    const titles = (res.results as Array<{ title?: string }>).map((r) => r.title);
    expect(titles).toContain(noteTitle);
  } finally {
    await app.close().catch(() => { /* already exited */ });
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});

test('journey: rename a note → wiki-links pointing at it are rewritten', async () => {
  const { app, userDataDir, projectDir } = await launchWithProject();
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await waitForWorkspace(win);

    // Two root-level notes: a target and a note that wiki-links to it by
    // basename (== path at the root, so the rewrite map keys line up cleanly).
    await win.evaluate(async () => {
      await window.api.notebase.writeFile('e2e-rename-target.md', '---\ntitle: Rename Target\n---\n\nbody\n');
      await window.api.notebase.writeFile(
        'e2e-linker.md',
        '---\ntitle: Linker\n---\n\nSee [[e2e-rename-target]] for details.\n',
      );
    });

    // Rename through the real notebase IPC — this is `renameWithLinkRewrites`,
    // which moves the file AND rewrites every wiki-link that pointed at it.
    await win.evaluate(() => window.api.notebase.rename('e2e-rename-target.md', 'e2e-renamed.md'));

    // The marquee assertion: the linking note now points at the new name.
    const linker = await win.evaluate(() => window.api.notebase.readFile('e2e-linker.md'));
    expect(linker, 'wiki-link was not rewritten to the new name').toContain('[[e2e-renamed]]');
    expect(linker, 'stale wiki-link to the old name still present').not.toContain('[[e2e-rename-target]]');

    // And the file actually moved.
    const exists = await win.evaluate(() => window.api.notebase.fileExists('e2e-renamed.md'));
    expect(exists, 'renamed file does not exist at its new path').toBe(true);
  } finally {
    await app.close().catch(() => { /* already exited */ });
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
