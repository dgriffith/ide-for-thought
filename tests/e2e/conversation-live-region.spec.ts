/**
 * A streamed conversation reply reaches the screen-reader live region (#2374) —
 * once, when it completes, and never token by token.
 *
 * This is the one e2e that drives a real `send` through the real conversation
 * loop. The LLM is a tiny in-process HTTP stub speaking the OpenAI-compatible
 * chat-completions SSE shape, reached through the app's own `local` provider
 * (BYOM #1497: a custom model routes to `providers.local.baseURL`). No test seam
 * in `src/` — the app is configured exactly as a user pointing it at Ollama or
 * LM Studio would configure it, by `llm-settings.json` in the profile.
 *
 * What it asserts is what a screen reader hears: the text of the always-mounted
 * polite region (`LiveAnnouncer.svelte`). A MutationObserver records every value
 * that region takes while the reply streams in, so the "not per token" half is
 * checked against the DOM rather than against a unit-test spy.
 *
 * Boots the in-tree `.vite/build` app, so it needs `pnpm build:e2e` first
 * (`pnpm test:e2e` does that).
 */
import { test, expect } from './helpers/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

/** The app-level polite live region (LiveAnnouncer.svelte). */
const LIVE_REGION = '[data-testid="live-announcer-polite"]';
/** Mirrors `MENU_NEW_CONVERSATION` in src/shared/channels.ts (hardcoded so the
 *  spec doesn't import app modules into the Playwright node context). */
const MENU_NEW_CONVERSATION = 'menu:newConversation';
const MODEL_ID = 'e2e-stub-model';

/** Streamed as this many separate SSE deltas — enough that a per-token
 *  announcer would visibly produce a run of partial values. */
const REPLY_TOKENS = ['The ', 'stubbed ', 'model ', 'says ', 'the ', 'answer ', 'is ', 'forty-', 'two.'];
const REPLY = REPLY_TOKENS.join('');

/** A minimal OpenAI-compatible `/chat/completions` streaming endpoint. */
function startStubLlm(): Promise<{ server: http.Server; baseURL: string; calls: () => number }> {
  let calls = 0;
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    calls++;
    req.resume();
    req.on('end', () => {
      void (async () => {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        const frame = (delta: object, finish: string | null = null, extra: object = {}) =>
          `data: ${JSON.stringify({
            id: 'e2e', object: 'chat.completion.chunk', created: 0, model: MODEL_ID,
            choices: [{ index: 0, delta, finish_reason: finish }], ...extra,
          })}\n\n`;
        res.write(frame({ role: 'assistant', content: '' }));
        for (const tok of REPLY_TOKENS) {
          res.write(frame({ content: tok }));
          // Let each delta cross IPC and render before the next one.
          await new Promise((r) => setTimeout(r, 40));
        }
        res.write(frame({}, 'stop'));
        res.write(`data: ${JSON.stringify({
          id: 'e2e', object: 'chat.completion.chunk', created: 0, model: MODEL_ID, choices: [],
          usage: { prompt_tokens: 10, completion_tokens: REPLY_TOKENS.length, total_tokens: 10 + REPLY_TOKENS.length },
        })}\n\n`);
        res.end('data: [DONE]\n\n');
      })();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseURL: `http://127.0.0.1:${port}/v1`, calls: () => calls });
    });
  });
}

test('conversation: a streamed reply is announced once, on completion, not per token', async () => {
  const llm = await startStubLlm();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-live-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-live-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, 'session.json'),
    JSON.stringify([{ x: 80, y: 80, width: 1200, height: 800, rootPath: projectDir }]),
  );
  // Point the app at the stub the way a user points it at a local server.
  fs.writeFileSync(path.join(userDataDir, 'llm-settings.json'), JSON.stringify({
    model: MODEL_ID,
    customModels: [{ id: MODEL_ID, label: 'E2E stub' }],
    providers: { local: { baseURL: llm.baseURL } },
  }));

  const app = await launchMinerva({ userDataDir });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await win.waitForLoadState('domcontentloaded');
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });

    // The region is mounted before anything is said — the precondition for a
    // change to it to be spoken at all.
    const live = win.locator(LIVE_REGION);
    await expect(live).toHaveCount(1);
    await expect(live).toHaveAttribute('aria-live', 'polite');

    // Record every value the region takes from here on.
    await live.evaluate((el) => {
      const seen: string[] = [];
      (window as unknown as { __liveSeen: string[] }).__liveSeen = seen;
      new MutationObserver(() => { seen.push(el.textContent ?? ''); })
        .observe(el, { childList: true, characterData: true, subtree: true });
    });

    // File ▸ New Conversation, exactly as the menu delivers it.
    await app.evaluate(({ BrowserWindow }, channel) => {
      BrowserWindow.getAllWindows()[0]!.webContents.send(channel);
    }, MENU_NEW_CONVERSATION);
    const composer = win.getByPlaceholder('Ask anything, or type / for skills…');
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.fill('What is the answer?');
    await composer.press('Enter');

    // The reply lands in the region, prefixed as a completion cue.
    await expect(live).toContainText(`Response complete. ${REPLY}`, { timeout: 20_000 });
    expect(llm.calls(), 'the stub LLM was never called').toBeGreaterThan(0);

    // …and it got there without the region narrating the stream: no partial
    // reply was ever announced, only the turn's start and its completion.
    const seen = (await win.evaluate(() => (window as unknown as { __liveSeen: string[] }).__liveSeen))
      .map((s) => s.replace(/\u00A0$/, '').trim())
      .filter((s) => s.length > 0);
    const replyValues = seen.filter((s) => REPLY_TOKENS.some((t) => s.includes(t.trim())) && s.includes('stubbed'));
    expect(replyValues, `region values: ${JSON.stringify(seen)}`).toEqual([`Response complete. ${REPLY}`]);
    expect(seen).toContain('Generating response');
  } finally {
    await closeMinerva(app);
    llm.server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
