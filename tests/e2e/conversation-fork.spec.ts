/**
 * Watching a fork from its parent (#2972): the assistant forks three branches,
 * the card shows each one's progress, one is stopped, one is opened in a tab
 * where it streams live, and the parent's turn continues on the join.
 *
 * The LLM is an in-process stub speaking the OpenAI-compatible SSE shape,
 * reached through the app's own `local` provider — the setup of
 * `conversation-live-region.spec.ts`. It answers by what each request is:
 *
 * - the parent's first request (it offers `fork`, no tool result yet) calls
 *   `fork` with three branches;
 * - the one summary the fork shares between its branches;
 * - each branch (its opening says "You are one branch of a fork"): Alpha
 *   answers at once, Beta keeps writing until it is stopped, Gamma writes for
 *   a few seconds and finishes;
 * - the parent's request carrying the fork's result: the joined reply.
 *
 * Boots the in-tree `.vite/build` app, so it needs `pnpm build:e2e` first.
 */
import { test, expect } from './helpers/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const ASK_A_QUESTION = 'learning.askQuestion';
const MODEL_ID = 'e2e-stub-model';
const QUESTION = 'Fork this question three ways';
const JOINED = 'Joined: the branches mostly agree.';

interface ChatBody {
  messages: { role: string; content: unknown }[];
  tools?: { function?: { name?: string } }[];
}

function startStubLlm(): Promise<{ server: http.Server; baseURL: string; branchRequests: () => string[] }> {
  const branchRequests: string[] = [];
  const server = http.createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.endsWith('/chat/completions')) {
      res.writeHead(404).end();
      return;
    }
    let raw = '';
    req.on('data', (c: Buffer) => { raw += c.toString(); });
    req.on('end', () => {
      const body = JSON.parse(raw) as ChatBody;
      const text = JSON.stringify(body.messages);
      let closed = false;
      res.on('close', () => { closed = true; });
      const frame = (delta: object, finish: string | null = null) =>
        `data: ${JSON.stringify({ id: 'e2e', object: 'chat.completion.chunk', created: 0, model: MODEL_ID, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
      const end = (finish: string) => {
        res.write(frame({}, finish));
        res.write(`data: ${JSON.stringify({ id: 'e2e', object: 'chat.completion.chunk', created: 0, model: MODEL_ID, choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\n`);
        res.end('data: [DONE]\n\n');
      };
      const say = async (tokens: string[], gapMs: number) => {
        for (const t of tokens) {
          if (closed) return;
          res.write(frame({ content: t }));
          await new Promise((r) => setTimeout(r, gapMs));
        }
        if (!closed) end('stop');
      };
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
      res.write(frame({ role: 'assistant', content: '' }));

      void (async () => {
        if (text.includes('You are one branch of a fork')) {
          const which = /BRANCH_(ALPHA|BETA|GAMMA)/.exec(text)?.[1] ?? '?';
          branchRequests.push(which);
          if (which === 'ALPHA') return say(['Alpha ', 'answer.'], 20);
          // Beta never finishes on its own: it is the one the user stops.
          if (which === 'BETA') return say(Array.from({ length: 400 }, (_, i) => `beta${i} `), 250);
          return say(['Gamma ', 'is ', 'still ', 'thinking ', ...Array.from({ length: 24 }, (_, i) => `g${i} `), 'Gamma done.'], 250);
        }
        if (text.includes('information-dense summary')) return say(['The user asked a question to fork.'], 10);
        if (body.messages.some((m) => m.role === 'tool')) return say([JOINED], 10);
        if (body.tools?.some((t) => t.function?.name === 'fork')) {
          const args = JSON.stringify({
            branches: [
              { title: 'Alpha', instructions: 'BRANCH_ALPHA: answer quickly.' },
              { title: 'Beta', instructions: 'BRANCH_BETA: take your time.' },
              { title: 'Gamma', instructions: 'BRANCH_GAMMA: think it through.' },
            ],
            join: 'compare',
          });
          res.write(frame({ tool_calls: [{ index: 0, id: 'call_fork', type: 'function', function: { name: 'fork', arguments: args } }] }));
          return end('tool_calls');
        }
        return say(['ok'], 10);
      })();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ server, baseURL: `http://127.0.0.1:${port}/v1`, branchRequests: () => branchRequests });
    });
  });
}

test('conversation: fork three, stop one, open one, and the parent continues on the join (#2972)', async () => {
  test.setTimeout(90_000);
  const llm = await startStubLlm();
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-fork-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-fork-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, 'session.json'),
    JSON.stringify([{ x: 80, y: 80, width: 1200, height: 900, rootPath: projectDir }]),
  );
  fs.writeFileSync(path.join(userDataDir, 'llm-settings.json'), JSON.stringify({
    model: MODEL_ID,
    customModels: [{ id: MODEL_ID, label: 'E2E stub' }],
    providers: { local: { baseURL: llm.baseURL } },
    autoTitleConversations: false,
  }));

  const app = await launchMinerva({ userDataDir });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await win.waitForLoadState('domcontentloaded');
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });

    await app.evaluate(({ BrowserWindow }, id) => {
      BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', id);
    }, ASK_A_QUESTION);
    const composer = win.getByPlaceholder('Ask anything, or type / for skills…');
    await expect(composer).toBeVisible({ timeout: 10_000 });
    await composer.fill(QUESTION);
    await composer.press('Enter');

    // The card: a list, one row per branch, each named with its status.
    const card = win.getByRole('region', { name: 'Fork into 3 branches' });
    await expect(card).toBeVisible({ timeout: 20_000 });
    const row = (title: string) => card.getByRole('listitem').filter({ has: win.getByText(title, { exact: true }) });
    await expect(row('Alpha')).toHaveAttribute('aria-label', 'Alpha, finished', { timeout: 15_000 });
    await expect(row('Beta')).toHaveAttribute('aria-label', 'Beta, running', { timeout: 15_000 });
    await expect(row('Gamma')).toHaveAttribute('aria-label', 'Gamma, running');

    // Stop one.
    await card.getByRole('button', { name: 'Stop branch Beta' }).click();
    await expect(row('Beta')).toHaveAttribute('aria-label', 'Beta, stopped', { timeout: 10_000 });

    // Open one while it runs: its tab streams live, then settles.
    await card.getByRole('button', { name: 'Open branch Gamma' }).click();
    const transcript = win.locator('.messages');
    await expect(transcript.locator('.msg.assistant.streaming')).toContainText('Gamma is still thinking', { timeout: 10_000 });
    await expect(transcript.locator('.msg.assistant').last()).toContainText('Gamma done.', { timeout: 20_000 });
    await expect(transcript.locator('.msg.assistant.streaming')).toHaveCount(0, { timeout: 10_000 });

    // Back on the parent: the card has joined, and the turn went on beneath it.
    await win.getByRole('button', { name: new RegExp(QUESTION) }).click();
    await expect(win.locator('.messages .msg.assistant').last()).toContainText(JOINED, { timeout: 20_000 });
    await expect(card).toContainText('Forked into 3 branches — joined');
    await expect(row('Gamma')).toHaveAttribute('aria-label', 'Gamma, finished');
    expect(llm.branchRequests().sort()).toEqual(['ALPHA', 'BETA', 'GAMMA']);
  } finally {
    await closeMinerva(app);
    llm.server.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
