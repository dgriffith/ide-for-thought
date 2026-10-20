/**
 * The plugin API generator's rules (#2826): what counts as breaking, and the
 * version bump each change needs.
 */
import { describe, it, expect } from 'vitest';
import { checkApi, compareAbi, versionProblems } from '../../scripts/lib/plugin-api-gen.mjs';

type Abi = Parameters<typeof compareAbi>[0];
const field = (name: string, type: string, optional = false) => ({ name, type, optional });
const base = (): Abi => ({
  version: '1.2.0',
  errorCodes: ['capability', 'scope'],
  methods: {
    'notes.read': {
      capability: 'notes:read',
      params: { members: [field('path', 'string')] },
      result: { members: [field('content', 'string'), field('path', 'string')] },
    },
    'notes.list': { capability: 'notes:read', params: { text: 'Record<string, never>' }, result: { members: [field('paths', 'string[]')] } },
  },
});
const withVersion = (abi: Abi, version: string): Abi => ({ ...abi, version });

describe('compareAbi (#2826)', () => {
  it('finds nothing between equal snapshots', () => {
    expect(compareAbi(base(), base())).toEqual({ breaking: [], additions: [] });
  });

  it.each<[string, (a: Abi) => void]>([
    ['a method removed', (a) => { delete a.methods['notes.list']; }],
    ['a capability changed', (a) => { a.methods['notes.read']!.capability = 'notes:write'; }],
    ['an error code removed', (a) => { a.errorCodes = ['capability']; }],
    ['a param retyped', (a) => { a.methods['notes.read']!.params = { members: [field('path', 'string[]')] }; }],
    ['a param removed', (a) => { a.methods['notes.read']!.params = { members: [] }; }],
    ['a required param added', (a) => { a.methods['notes.read']!.params = { members: [field('path', 'string'), field('rev', 'number')] }; }],
    ['a result field removed', (a) => { a.methods['notes.read']!.result = { members: [field('path', 'string')] }; }],
    ['a result field made optional', (a) => { a.methods['notes.read']!.result = { members: [field('content', 'string', true), field('path', 'string')] }; }],
    ['an opaque shape changed', (a) => { a.methods['notes.list']!.params = { text: 'Record<string, unknown>' }; }],
  ])('%s is breaking', (_label, change) => {
    const next = base();
    change(next);
    expect(compareAbi(base(), next).breaking).toHaveLength(1);
  });

  it('an optional param made required is breaking', () => {
    const prev = base();
    const next = base();
    prev.methods['notes.read']!.params = { members: [field('path', 'string'), field('rev', 'number', true)] };
    next.methods['notes.read']!.params = { members: [field('path', 'string'), field('rev', 'number')] };
    expect(compareAbi(prev, next).breaking).toEqual(['notes.read params: "rev" is now required']);
  });

  it.each<[string, (a: Abi) => void]>([
    ['a method added', (a) => { a.methods['notes.write'] = { capability: 'notes:write', params: { members: [] }, result: { members: [] } }; }],
    ['an optional param added', (a) => { a.methods['notes.read']!.params = { members: [field('path', 'string'), field('rev', 'number', true)] }; }],
    ['a result field added', (a) => { a.methods['notes.read']!.result!.members!.push(field('properties', 'unknown')); }],
    ['an error code added', (a) => { a.errorCodes = [...a.errorCodes, 'busy']; }],
  ])('%s is an addition', (_label, change) => {
    const next = base();
    change(next);
    expect(compareAbi(base(), next)).toEqual({ breaking: [], additions: [expect.any(String)] });
  });
});

describe('versionProblems (#2826)', () => {
  const removed = () => { const a = base(); delete a.methods['notes.list']; return a; };
  const added = () => { const a = base(); a.errorCodes = [...a.errorCodes, 'busy']; return a; };

  it('a breaking change needs a major bump', () => {
    expect(versionProblems(base(), withVersion(removed(), '1.3.0'))[0]).toContain('needs a major bump (1.2.0 → 2.0.0)');
    expect(versionProblems(base(), withVersion(removed(), '2.0.0'))).toEqual([]);
  });

  it('an addition needs at least a minor bump', () => {
    expect(versionProblems(base(), withVersion(added(), '1.2.1'))[0]).toContain('at least a minor bump (1.2.0 → 1.3.0)');
    expect(versionProblems(base(), withVersion(added(), '1.3.0'))).toEqual([]);
    expect(versionProblems(base(), withVersion(added(), '2.0.0'))).toEqual([]);
  });

  it('no change needs no bump, and a bump with no change is allowed', () => {
    expect(versionProblems(base(), base())).toEqual([]);
    expect(versionProblems(base(), withVersion(base(), '1.2.1'))).toEqual([]);
  });
});

describe('checkApi (#2826)', () => {
  const api = (methods: Record<string, unknown>) => ({
    version: '1.0.0', portMessage: 'm', errorCodes: [], typeText: {},
    methods: Object.fromEntries(Object.keys(methods).map((m) => [m, { capability: 'ui', describes: '' }])),
    params: Object.fromEntries(Object.keys(methods).map((m) => [m, { members: [] }])),
    results: Object.fromEntries(Object.keys(methods).map((m) => [m, { members: [] }])),
  });

  it("names a core method <area>.<name> and a fork's extension <slug>:<name>", () => {
    expect(checkApi(api({ 'notes.read': 1, 'acme:boardSync': 1 }))).toEqual([]);
    expect(checkApi(api({ readNote: 1 }))[0]).toContain('neither a core method');
    expect(checkApi(api({ 'Acme:x': 1 }))[0]).toContain('neither a core method');
  });

  it('refuses a method with no shapes, or shapes with no method, and a non-semver version', () => {
    const a = api({ 'notes.read': 1 });
    delete (a.params as Record<string, unknown>)['notes.read'];
    (a.results as Record<string, unknown>)['notes.extra'] = { members: [] };
    expect(checkApi({ ...a, version: '1' })).toEqual([
      'PLUGIN_API_VERSION must be a semver version; got "1".',
      '"notes.read" has no entry in PluginMethodParams.',
      '"notes.extra" has shapes but isn\'t in PLUGIN_METHODS.',
    ]);
  });
});
