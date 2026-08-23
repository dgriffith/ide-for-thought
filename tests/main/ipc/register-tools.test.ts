/**
 * @vitest-environment node
 *
 * Main-process coverage for `register-tools.ts` (#1840).
 *
 * This registrar is the renderer's whole door onto skills and the LLM: it runs
 * a skill, streams its output back, cancels it, serves the skill catalog, and
 * owns the model/provider settings. What it promises, and what's pinned here:
 *
 *   - **cancellation is per-window and self-cleaning.** One `AbortController`
 *     per window id, handed to `executeTool` and dropped in a `finally` — so a
 *     Cancel in window 2 can't abort window 1's run, and a Cancel that arrives
 *     after a run finished (or crashed) is a no-op rather than a stale abort.
 *   - **prompt bodies never cross IPC.** CLAUDE.md's skills section: "the
 *     renderer never sees prompt bodies". `SKILLS_LIST` therefore goes through
 *     the REAL `toSkillInfo`, and the test feeds it a skill whose body and
 *     firstMessage are recognisable strings so a leak is visible.
 *   - **`errors[]` is a per-item catalog, not a failure channel** (#1631
 *     rule 4): an unparseable skill file is reported *alongside* the skills
 *     that did load, and the call still succeeds.
 *   - **opening Settings never prompts the keychain** — `TOOL_GET_SETTINGS`
 *     reads the display view, never the decrypting `getSettings()`.
 *
 * Nothing here is `withRootPath`: skills, models and API keys are per-machine,
 * not per-thoughtbase, so every handler works with no project open. The
 * catalog/executor/settings modules behind them are mocked; `broadcast` is real
 * so the TOOL_STREAM channel and payload are genuinely exercised.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SkillDef, MenuConfig } from '../../../src/shared/skills/types';

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => {
  const makeWin = (id: number) => ({ id, isDestroyed: () => false, webContents: { send: vi.fn() } });
  const win = makeWin(1);
  return {
    handlers: new Map<string, Handler>(),
    win,
    otherWin: makeWin(2),
    /** Which window the next `call()` appears to come from. */
    current: { win },
    // tools/executor
    executeTool: vi.fn(),
    prepareConversationTool: vi.fn(),
    // skills
    getSkillCatalog: vi.fn(),
    reloadAndRegisterSkills: vi.fn(),
    reapplyMenuConfig: vi.fn(),
    pickAndImportSkill: vi.fn(),
    removeUserSkill: vi.fn(),
    revealSkillsFolder: vi.fn(),
    getMenuConfig: vi.fn(),
    saveMenuConfig: vi.fn(),
    rebuildMenu: vi.fn(),
    // llm
    getSettings: vi.fn(),
    getSettingsForDisplay: vi.fn(),
    saveSettings: vi.fn(),
    getApiKeyStorage: vi.fn(),
    checkConnection: vi.fn(),
    /** Call-order log — remove/import must re-register BEFORE rebuilding the menu. */
    order: [] as string[],
  };
});

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { h.handlers.set(channel, fn); } },
}));

vi.mock('../../../src/main/ipc/helpers', () => ({ winFromEvent: () => h.current.win }));

vi.mock('../../../src/main/menu', () => ({
  rebuildMenu: (...a: unknown[]) => { h.order.push('rebuildMenu'); return h.rebuildMenu(...a); },
}));
vi.mock('../../../src/main/tools/executor', () => ({
  executeTool: h.executeTool,
  prepareConversationTool: h.prepareConversationTool,
}));
vi.mock('../../../src/main/skills/loader', () => ({ getSkillCatalog: h.getSkillCatalog }));
vi.mock('../../../src/main/skills/register', () => ({
  reloadAndRegisterSkills: (...a: unknown[]) => { h.order.push('reload'); return h.reloadAndRegisterSkills(...a); },
  reapplyMenuConfig: h.reapplyMenuConfig,
}));
vi.mock('../../../src/main/skills/manage', () => ({
  pickAndImportSkill: h.pickAndImportSkill,
  removeUserSkill: (...a: unknown[]) => { h.order.push('remove'); return h.removeUserSkill(...a); },
  revealSkillsFolder: h.revealSkillsFolder,
}));
vi.mock('../../../src/main/skills/menu-config-store', () => ({
  getMenuConfig: h.getMenuConfig,
  saveMenuConfig: h.saveMenuConfig,
}));
vi.mock('../../../src/main/llm/settings', () => ({
  getSettings: h.getSettings,
  getSettingsForDisplay: h.getSettingsForDisplay,
  saveSettings: h.saveSettings,
  getApiKeyStorage: h.getApiKeyStorage,
}));
vi.mock('../../../src/main/llm/validate', () => ({ checkConnection: h.checkConnection }));

import { registerTools } from '../../../src/main/ipc/register-tools';
import { Channels } from '../../../src/shared/channels';

registerTools();

const call = (channel: string, ...args: unknown[]) => h.handlers.get(channel)!({}, ...args);

const EMPTY_CONFIG: MenuConfig = { skills: {}, order: { Learning: [], Research: [], Analysis: [] } };

/** A fully-populated skill, so the body/firstMessage leak check has something
 *  unmistakable to look for. */
const SKILL: SkillDef = {
  id: 'stock.socratic',
  name: 'Socratic Dialogue',
  description: 'Question the note',
  longDescription: 'Longer blurb',
  menu: 'Learning',
  scope: 'note',
  outputMode: 'openConversation',
  context: [],
  parameters: [],
  tools: ['propose_claims'],
  web: false,
  requiresSelection: false,
  firstMessage: 'FIRST-MESSAGE-TEMPLATE-{{title}}',
  body: 'SYSTEM-PROMPT-BODY-{{note.content}}',
  source: 'stock',
  filePath: './stock/socratic.md',
};

const REQUEST = { toolId: 'stock.socratic', context: { fullNoteTitle: 'Paxos' } };

beforeEach(() => {
  vi.clearAllMocks();
  h.order.length = 0;
  h.current.win = h.win;
  h.getMenuConfig.mockReturnValue(EMPTY_CONFIG);
});

describe('TOOL_EXECUTE / TOOL_CANCEL', () => {
  /** Start a run and hand back the arguments `executeTool` was given, with the
   *  run still in flight so it can be cancelled. */
  function startRun(): {
    settle: (v: unknown) => void;
    fail: (e: unknown) => void;
    args: () => { onChunk: (s: string) => void; signal: AbortSignal };
    done: Promise<unknown>;
  } {
    let settle!: (v: unknown) => void;
    let fail!: (e: unknown) => void;
    let captured!: { onChunk: (s: string) => void; signal: AbortSignal };
    h.executeTool.mockImplementation((_req: unknown, onChunk: (s: string) => void, signal: AbortSignal) => {
      captured = { onChunk, signal };
      return new Promise((resolve, reject) => { settle = resolve; fail = reject; });
    });
    const done = call(Channels.TOOL_EXECUTE, REQUEST) as Promise<unknown>;
    return { settle, fail, args: () => captured, done };
  }

  it('runs the requested tool and returns its result', async () => {
    h.executeTool.mockResolvedValue({ toolId: 'stock.socratic', output: 'text' });
    await expect(call(Channels.TOOL_EXECUTE, REQUEST)).resolves.toEqual({ toolId: 'stock.socratic', output: 'text' });
    expect(h.executeTool).toHaveBeenCalledWith(REQUEST, expect.any(Function), expect.any(AbortSignal));
  });

  it('streams each chunk to the window that asked for the run', async () => {
    const run = startRun();
    run.args().onChunk('partial ');
    run.args().onChunk('output');
    run.settle({ output: 'partial output' });
    await run.done;

    expect(h.win.webContents.send.mock.calls).toEqual([
      [Channels.TOOL_STREAM, 'partial '],
      [Channels.TOOL_STREAM, 'output'],
    ]);
  });

  it('drops chunks for a window the user already closed', async () => {
    // A skill can keep streaming for a while after its window goes away;
    // sending to destroyed webContents throws, which would surface as a
    // rejected TOOL_EXECUTE for a run that actually succeeded.
    const closed = { id: 9, isDestroyed: () => true, webContents: { send: vi.fn() } };
    h.current.win = closed;
    const run = startRun();
    run.args().onChunk('into the void');
    run.settle({ output: '' });
    await run.done;

    expect(closed.webContents.send).not.toHaveBeenCalled();
  });

  it('TOOL_CANCEL aborts the run in flight', async () => {
    const run = startRun();
    expect(run.args().signal.aborted).toBe(false);

    call(Channels.TOOL_CANCEL);

    expect(run.args().signal.aborted).toBe(true);
    run.settle({ output: '' });
    await run.done;
  });

  it('cancels only the asking window\'s run', async () => {
    const run = startRun();

    // A second window pressing Cancel must not kill this window's skill.
    h.current.win = h.otherWin;
    call(Channels.TOOL_CANCEL);

    expect(run.args().signal.aborted).toBe(false);
    run.settle({ output: '' });
    await run.done;
  });

  it('TOOL_CANCEL with nothing running is a no-op', () => {
    expect(() => call(Channels.TOOL_CANCEL)).not.toThrow();
  });

  it('forgets the controller once the run finishes, so a late Cancel is inert', async () => {
    const first = startRun();
    first.settle({ output: 'done' });
    await first.done;

    call(Channels.TOOL_CANCEL); // late click on a finished run

    const second = startRun();
    // A stale controller left in the map would have aborted this one at birth.
    expect(second.args().signal.aborted).toBe(false);
    second.settle({ output: '' });
    await second.done;
  });

  it('forgets the controller when the run THROWS, and surfaces the error', async () => {
    const failed = startRun();
    failed.fail(new Error('Unknown tool: nope'));
    await expect(failed.done).rejects.toThrow(/Unknown tool/);

    const next = startRun();
    expect(next.args().signal.aborted).toBe(false);
    next.settle({ output: '' });
    await next.done;
  });

  it('TOOL_PREPARE_CONVERSATION delegates to the conversation payload builder', () => {
    h.prepareConversationTool.mockReturnValue({ prompt: 'system', model: 'claude-opus-5' });
    expect(call(Channels.TOOL_PREPARE_CONVERSATION, REQUEST)).toEqual({ prompt: 'system', model: 'claude-opus-5' });
    expect(h.prepareConversationTool).toHaveBeenCalledWith(REQUEST);
  });
});

describe('SKILLS_LIST', () => {
  it('sends serializable metadata and the menu config', async () => {
    h.getSkillCatalog.mockResolvedValue({ skills: [SKILL], errors: [] });

    const result = await call(Channels.SKILLS_LIST) as { skills: Array<Record<string, unknown>>; config: MenuConfig };

    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toMatchObject({ id: 'stock.socratic', name: 'Socratic Dialogue', menu: 'Learning', source: 'stock' });
    expect(result.config).toEqual(EMPTY_CONFIG);
  });

  it('never ships the prompt body or firstMessage to the renderer', async () => {
    h.getSkillCatalog.mockResolvedValue({ skills: [SKILL], errors: [] });

    const result = await call(Channels.SKILLS_LIST);

    // CLAUDE.md: templates are rendered in main at prepare/execute time; the
    // renderer gets metadata only. A field added to SkillDef and mirrored into
    // SkillInfo by accident would show up right here.
    expect(JSON.stringify(result)).not.toContain('SYSTEM-PROMPT-BODY');
    expect(JSON.stringify(result)).not.toContain('FIRST-MESSAGE-TEMPLATE');
    expect((result as { skills: Array<Record<string, unknown>> }).skills[0]).not.toHaveProperty('body');
    expect((result as { skills: Array<Record<string, unknown>> }).skills[0]).not.toHaveProperty('filePath');
  });

  it('reports an unloadable skill alongside the ones that loaded (#1631 rule 4)', async () => {
    const broken = { source: 'user' as const, filePath: '/u/bad.md', label: 'bad.md', message: 'missing `menu:`' };
    h.getSkillCatalog.mockResolvedValue({ skills: [SKILL], errors: [broken] });

    // A per-item catalog is not a failure channel: the call succeeds, and the
    // good skill is still usable.
    const result = await call(Channels.SKILLS_LIST) as { skills: unknown[]; errors: unknown[] };
    expect(result.skills).toHaveLength(1);
    expect(result.errors).toEqual([broken]);
  });
});

describe('skill management', () => {
  it('SKILLS_RELOAD re-scans, rebuilds the native menu, and returns the fresh catalog', async () => {
    h.reloadAndRegisterSkills.mockResolvedValue({ skills: [SKILL], errors: [] });

    const result = await call(Channels.SKILLS_RELOAD) as { skills: unknown[] };

    expect(result.skills).toHaveLength(1);
    // The menu is rebuilt from the NEW registry, so it must come second.
    expect(h.order).toEqual(['reload', 'rebuildMenu']);
  });

  it('SKILLS_MENU_CONFIG_SET persists, re-syncs the registry, and returns what was STORED', async () => {
    const asked: MenuConfig = {
      skills: { 'stock.socratic': { enabled: false, menu: 'Research' } },
      order: { Learning: [], Research: ['stock.socratic'], Analysis: [] },
    };
    // Normalisation can drop junk, so the caller must render the saved config
    // rather than the one it optimistically sent.
    const stored: MenuConfig = { ...asked, skills: {} };
    h.saveMenuConfig.mockResolvedValue(stored);
    h.getSkillCatalog.mockResolvedValue({ skills: [SKILL], errors: [] });

    await expect(call(Channels.SKILLS_MENU_CONFIG_SET, asked)).resolves.toEqual(stored);
    expect(h.saveMenuConfig).toHaveBeenCalledWith(asked);
    expect(h.reapplyMenuConfig).toHaveBeenCalledWith({ skills: [SKILL], errors: [] });
    expect(h.rebuildMenu).toHaveBeenCalled();
  });

  it('SKILLS_IMPORT registers and re-menus the imported skill', async () => {
    const imported = { id: 'user.mine', name: 'Mine', filePath: '/u/mine.md' };
    h.pickAndImportSkill.mockResolvedValue(imported);
    h.reloadAndRegisterSkills.mockResolvedValue({ skills: [], errors: [] });

    await expect(call(Channels.SKILLS_IMPORT)).resolves.toEqual(imported);
    expect(h.pickAndImportSkill).toHaveBeenCalledWith(h.win);
    expect(h.order).toEqual(['reload', 'rebuildMenu']);
  });

  it('SKILLS_IMPORT does no work when the picker is cancelled', async () => {
    // `null` here means exactly one thing — the user closed the picker (#1631
    // rule 5) — so nothing should be reloaded or rebuilt.
    h.pickAndImportSkill.mockResolvedValue(null);

    await expect(call(Channels.SKILLS_IMPORT)).resolves.toBeNull();
    expect(h.order).toEqual([]);
  });

  it('SKILLS_REMOVE deletes the file, then re-registers, then rebuilds', async () => {
    h.reloadAndRegisterSkills.mockResolvedValue({ skills: [], errors: [] });

    await call(Channels.SKILLS_REMOVE, 'user.mine');

    expect(h.removeUserSkill).toHaveBeenCalledWith('user.mine');
    // Rebuilding before the re-scan would leave the deleted skill on the menu.
    expect(h.order).toEqual(['remove', 'reload', 'rebuildMenu']);
  });

  it('SKILLS_REMOVE propagates a failed delete instead of reporting success', async () => {
    h.removeUserSkill.mockRejectedValue(new Error('Cannot remove a stock skill'));
    await expect(call(Channels.SKILLS_REMOVE, 'stock.socratic')).rejects.toThrow(/stock skill/);
    expect(h.rebuildMenu).not.toHaveBeenCalled();
  });

  it('SKILLS_REVEAL opens the user skills folder', async () => {
    await call(Channels.SKILLS_REVEAL);
    expect(h.revealSkillsFolder).toHaveBeenCalled();
  });
});

describe('LLM settings handlers', () => {
  it('TOOL_GET_SETTINGS reads the display view, never the decrypting one', async () => {
    h.getSettingsForDisplay.mockResolvedValue({ model: 'claude-opus-5', hasApiKey: true });

    await expect(call(Channels.TOOL_GET_SETTINGS)).resolves.toEqual({ model: 'claude-opus-5', hasApiKey: true });
    // Opening Settings must not raise a keychain prompt, which `getSettings()`
    // would — that's the whole reason the display read exists.
    expect(h.getSettings).not.toHaveBeenCalled();
  });

  it('TOOL_SET_SETTINGS writes the update through', async () => {
    const update = { model: 'claude-sonnet-5', apiKey: 'sk-new' };
    await call(Channels.TOOL_SET_SETTINGS, update);
    expect(h.saveSettings).toHaveBeenCalledWith(update);
  });

  it('TOOL_SET_SETTINGS surfaces a failed save', async () => {
    h.saveSettings.mockRejectedValue(new Error('keychain denied'));
    await expect(call(Channels.TOOL_SET_SETTINGS, {})).rejects.toThrow(/keychain denied/);
  });

  it('TOOL_GET_KEY_STORAGE reports where the key is kept', async () => {
    h.getApiKeyStorage.mockResolvedValue('keychain');
    await expect(call(Channels.TOOL_GET_KEY_STORAGE)).resolves.toBe('keychain');
  });

  it('TOOL_CHECK_CONNECTION passes the unsaved key and baseURL through', async () => {
    h.checkConnection.mockResolvedValue({ ok: true });
    await expect(call(Channels.TOOL_CHECK_CONNECTION, 'openai', 'sk-typed', 'http://localhost:1234'))
      .resolves.toEqual({ ok: true });
    expect(h.checkConnection).toHaveBeenCalledWith('openai', 'sk-typed', 'http://localhost:1234');
  });

  it('TOOL_CHECK_CONNECTION RESOLVES a failed check rather than rejecting', async () => {
    // A wrong key is the expected outcome the button exists to discover, so it
    // comes back on the union's failure arm (#1631 rule 3), not as a rejection.
    h.checkConnection.mockResolvedValue({ ok: false, error: '401 invalid x-api-key' });
    await expect(call(Channels.TOOL_CHECK_CONNECTION, 'anthropic'))
      .resolves.toEqual({ ok: false, error: '401 invalid x-api-key' });
    expect(h.checkConnection).toHaveBeenCalledWith('anthropic', undefined, undefined);
  });
});
