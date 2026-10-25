/**
 * A plugin contribution run as a tool on its own MCP server (#2880):
 * `callPluginTool` names the server `<plugin>.<key>`, goes through the same
 * gate as `mcp_call` with main's own dialog as the confirmer, and reads the
 * tool's JSON; anything else fails naming the plugin. The gate itself is
 * `tests/main/mcp-servers/call-gate.test.ts`; a real server is
 * `tests/main/plugins/book-shelf.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ call: vi.fn(), confirm: vi.fn(), focused: { id: 7 } }));
vi.mock('electron', () => ({ BrowserWindow: { getFocusedWindow: () => h.focused } }));
vi.mock('../../src/main/mcp-servers/registry', () => ({ callServerTool: h.call }));
vi.mock('../../src/main/native-confirm', () => ({ confirmNative: h.confirm }));

import { callPluginTool, nativeMcpConfirmer } from '../../src/main/plugin-mcp-tools';

const text = (t: string, isError = false) => ({ kind: 'called', result: { content: [{ type: 'text', text: t }], isError } });

beforeEach(() => { h.call.mockReset(); h.confirm.mockReset(); });

describe('callPluginTool (#2880)', () => {
  it('calls the tool on the plugin\'s own server with a native confirmer, and answers its JSON', async () => {
    h.call.mockResolvedValue(text('{"title":"Dune"}'));
    expect(await callPluginTool('Book Shelf', 'book-shelf', 'catalogue/read_book', { url: 'u' })).toEqual({ title: 'Dune' });
    expect(h.call).toHaveBeenCalledWith('book-shelf.catalogue', 'read_book', { url: 'u' }, expect.any(Function));
  });

  it.each([
    ['declined', { kind: 'declined', reason: 'denied' }, "Book Shelf's read_book wasn't run: you didn't allow it."],
    ['a tool error', text('No book 7.', true), "Book Shelf's read_book failed: No book 7."],
    ['not JSON', text('a book'), "Book Shelf's read_book didn't answer JSON."],
  ])('fails, naming the plugin, when %s', async (_what, outcome, message) => {
    h.call.mockResolvedValue(outcome);
    await expect(callPluginTool('Book Shelf', 'book-shelf', 'catalogue/read_book', {})).rejects.toThrow(message);
  });

  it('a server that isn\'t on, or a tool name that isn\'t one, fails naming the plugin', async () => {
    h.call.mockRejectedValue(new Error('MCP server "book-shelf.catalogue" is not connected.'));
    await expect(callPluginTool('Book Shelf', 'book-shelf', 'catalogue/read_book', {})).rejects.toThrow('Book Shelf: MCP server "book-shelf.catalogue" is not connected.');
    await expect(callPluginTool('Book Shelf', 'book-shelf', '../x', {})).rejects.toThrow('names "../x", which isn\'t one of its tools');
  });
});

describe('nativeMcpConfirmer (#2880)', () => {
  const PROMPT = { serverName: 'book-shelf.catalogue', toolName: 'add_book', title: 'Add a book', description: 'Adds it.', argsJson: '{\n  "id": 1\n}', destructiveHint: true };

  it('asks in main\'s own dialog with the exact arguments, and "don\'t ask again" is the card\'s grant', async () => {
    h.confirm.mockResolvedValueOnce({ confirmed: true, checked: true });
    expect(await nativeMcpConfirmer()(PROMPT)).toEqual({ allow: true, remember: true });
    expect(h.confirm).toHaveBeenCalledWith(h.focused, {
      message: 'Let book-shelf.catalogue run Add a book?',
      detail: 'Adds it.\n\nThe server says this tool may change or delete things.\n\nIt\'s sent exactly this:\n{\n  "id": 1\n}',
      confirmLabel: 'Run',
      checkboxLabel: 'Don\'t ask again for this tool',
    });
    h.confirm.mockResolvedValueOnce({ confirmed: false, checked: true });
    expect(await nativeMcpConfirmer()(PROMPT)).toEqual({ allow: false, reason: 'denied' });
  });
});
