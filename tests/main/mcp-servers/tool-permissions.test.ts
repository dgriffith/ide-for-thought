/**
 * @vitest-environment node
 *
 * The "Don't ask again" store behind the mcp_call confirmation (#2439):
 * what a server's identity is, and the config-file discipline (lenient check,
 * strict + atomic grant/reset).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { McpServerDescriptor } from '../../../src/shared/mcp-servers';
import { useTempDir } from '../../helpers/temp-project';
import {
  _setMcpToolPermissionsPathForTests,
  allowTool,
  isToolAllowed,
  resetAllowedTools,
  serverIdentity,
} from '../../../src/main/mcp-servers/tool-permissions';

const tmp = useTempDir('minerva-mcp-perms-');
let file = '';

beforeEach(() => {
  file = path.join(tmp.root, 'mcp-tool-permissions.json');
  _setMcpToolPermissionsPathForTests(file);
});
afterEach(() => _setMcpToolPermissionsPathForTests(null));

const stdio: McpServerDescriptor = { kind: 'stdio', command: 'node', args: ['server.js'], env: { B: '2', A: '1' }, cwd: '/srv' };

describe('serverIdentity', () => {
  it('is stable across key order, env order and an absent vs. empty args', () => {
    const reordered: McpServerDescriptor = { cwd: '/srv', env: { A: '1', B: '2' }, args: ['server.js'], command: 'node', kind: 'stdio' };
    expect(serverIdentity(reordered)).toBe(serverIdentity(stdio));
    expect(serverIdentity({ kind: 'stdio', command: 'x' })).toBe(serverIdentity({ kind: 'stdio', command: 'x', args: [], env: {} }));
  });

  it.each<[string, McpServerDescriptor]>([
    ['command', { ...stdio, command: 'bun' }],
    ['args', { ...stdio, args: ['other.js'] }],
    ['env', { ...stdio, env: { A: '1', B: '3' } }],
    ['cwd', { ...stdio, cwd: '/elsewhere' }],
  ])('changes when the %s changes', (_field, changed) => {
    expect(serverIdentity(changed)).not.toBe(serverIdentity(stdio));
  });

  it('keys an http server on its URL, ignoring runtime auth headers', () => {
    const a: McpServerDescriptor = { kind: 'http', url: 'https://mcp.example.com/mcp' };
    expect(serverIdentity({ ...a, headers: { Authorization: 'Bearer t1' } })).toBe(serverIdentity(a));
    expect(serverIdentity({ kind: 'http', url: 'https://evil.example.com/mcp' })).not.toBe(serverIdentity(a));
  });

  it('never writes env values to disk, only the digest', () => {
    allowTool({ ...stdio, env: { API_TOKEN: 'sekrit-value' } }, 'srv', 'post');
    expect(fs.readFileSync(file, 'utf-8')).not.toContain('sekrit-value');
  });
});

describe('grants', () => {
  it('nothing is allowed on a fresh machine', () => {
    expect(isToolAllowed(stdio, 'post')).toBe(false);
  });

  it('allowTool grants one (server identity, tool) pair, idempotently', () => {
    allowTool(stdio, 'srv', 'post');
    allowTool(stdio, 'srv', 'post');
    expect(isToolAllowed(stdio, 'post')).toBe(true);
    expect(isToolAllowed(stdio, 'delete')).toBe(false);
    expect(isToolAllowed({ ...stdio, command: 'bun' }, 'post')).toBe(false);
    expect(JSON.parse(fs.readFileSync(file, 'utf-8')).allowed).toHaveLength(1);
  });

  it('resetAllowedTools clears every grant and reports how many', () => {
    allowTool(stdio, 'srv', 'post');
    allowTool(stdio, 'srv', 'edit');
    expect(resetAllowedTools()).toBe(2);
    expect(isToolAllowed(stdio, 'post')).toBe(false);
    expect(resetAllowedTools()).toBe(0);
  });
});

describe('a corrupt file', () => {
  it('reads as nothing allowed (the card shows again), never as allowed', () => {
    fs.writeFileSync(file, '{ not json');
    expect(isToolAllowed(stdio, 'post')).toBe(false);
  });

  it('makes a grant or reset throw instead of erasing the file', () => {
    fs.writeFileSync(file, '["wrong shape"]');
    expect(() => allowTool(stdio, 'srv', 'post')).toThrow();
    expect(() => resetAllowedTools()).toThrow();
    expect(fs.readFileSync(file, 'utf-8')).toBe('["wrong shape"]');
  });

  it('drops malformed records but keeps good ones', () => {
    fs.writeFileSync(file, JSON.stringify({ allowed: [{ server: serverIdentity(stdio), tool: 'post' }, { tool: 'x' }, 7] }));
    expect(isToolAllowed(stdio, 'post')).toBe(true);
  });

  it('rejects a non-array "allowed"', () => {
    fs.writeFileSync(file, JSON.stringify({ allowed: {} }));
    expect(isToolAllowed(stdio, 'post')).toBe(false);
    expect(() => allowTool(stdio, 'srv', 'post')).toThrow();
  });
});
