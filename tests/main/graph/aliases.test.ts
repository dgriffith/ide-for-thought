/**
 * Frontmatter alias resolution in the indexer (#469).
 *
 * Verifies that:
 *   - aliases declared in frontmatter become `minerva:hasAlias` triples
 *   - wiki-links to an alias resolve to the underlying note's URI
 *     (so backlinks attribute correctly)
 *   - title / filename matches still win when an alias collides
 *   - duplicate aliases pick a deterministic winner (alphabetical)
 *   - the IPC surface (`getAliasMap`) reflects the live state
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

import {
  initGraph,
  indexNote,
  queryGraph,
  getAliasMap,
} from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

describe('frontmatter aliases (#469)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-aliases-'));
    ctx = projectContext(root);
    await initGraph(ctx);
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('emits a minerva:hasAlias triple for each frontmatter alias', async () => {
    const body = [
      '---',
      'title: John F. Kennedy',
      'aliases:',
      '  - JFK',
      '  - Jack Kennedy',
      '---',
      '',
      '# John F. Kennedy',
      '',
    ].join('\n');
    await indexNote(ctx, 'presidents/kennedy.md', body);

    const r = await queryGraph(ctx, `
      PREFIX minerva: <https://minerva.dev/ontology#>
      SELECT ?alias WHERE {
        ?note minerva:hasAlias ?alias .
      }
    `);
    const rows = r.results as Array<{ alias: string }>;
    expect(rows.map((x) => x.alias).sort()).toEqual(['JFK', 'Jack Kennedy'].sort());
  });

  it('rewrites a wiki-link via alias to point at the aliased note', async () => {
    await indexNote(ctx, 'presidents/kennedy.md', [
      '---',
      'aliases:',
      '  - JFK',
      '---',
      '# Kennedy',
      '',
    ].join('\n'));
    await indexNote(ctx, 'essays/cuba.md', '# Cuba\n\nSee [[JFK]].\n');

    const r = await queryGraph(ctx, `
      SELECT ?subject ?target WHERE {
        ?subject <https://minerva.dev/ontology#references> ?target .
      }
    `);
    const rows = r.results as Array<{ subject: string; target: string }>;
    // The link should resolve to kennedy, NOT to a JFK URI. (`noteUri`
    // strips the .md extension when minting URIs, so we check for the
    // path stem.)
    expect(rows.some((row) => row.target.endsWith('presidents/kennedy'))).toBe(true);
    expect(rows.every((row) => !/\/JFK$/.test(row.target))).toBe(true);
  });

  it('title / filename match still wins over a colliding alias', async () => {
    // notes/JFK.md exists as a real file. Another note declares "JFK"
    // as an alias. The real file wins; alias is dropped from the map.
    await indexNote(ctx, 'JFK.md', '# Some other JFK note\n');
    await indexNote(ctx, 'kennedy.md', [
      '---',
      'aliases:',
      '  - JFK',
      '---',
      '# Kennedy',
      '',
    ].join('\n'));
    const map = getAliasMap(ctx);
    expect(map.jfk).toBeUndefined();
  });

  it('duplicate alias claims pick the alphabetically-first path', async () => {
    await indexNote(ctx, 'b.md', [
      '---',
      'aliases:',
      '  - shared',
      '---',
      '# B',
    ].join('\n'));
    await indexNote(ctx, 'a.md', [
      '---',
      'aliases:',
      '  - shared',
      '---',
      '# A',
    ].join('\n'));

    const map = getAliasMap(ctx);
    expect(map.shared).toBe('a.md');
  });

  it('rejects aliases containing wiki-link metacharacters', async () => {
    await indexNote(ctx, 'note.md', [
      '---',
      'aliases:',
      '  - "good-alias"',
      '  - "bad[alias]"',
      '  - "bad|alias"',
      '  - "bad#alias"',
      '---',
      '# Note',
      '',
    ].join('\n'));
    const map = getAliasMap(ctx);
    expect(map['good-alias']).toBe('note.md');
    expect(map['bad[alias]']).toBeUndefined();
    expect(map['bad|alias']).toBeUndefined();
    expect(map['bad#alias']).toBeUndefined();
  });

  it('removing aliases from a note drops them from the map on reindex', async () => {
    await indexNote(ctx, 'note.md', [
      '---',
      'aliases: ["foo", "bar"]',
      '---',
      '# Note',
      '',
    ].join('\n'));
    expect(Object.keys(getAliasMap(ctx)).sort()).toEqual(['bar', 'foo']);

    await indexNote(ctx, 'note.md', [
      '---',
      'aliases: ["foo"]',
      '---',
      '# Note',
      '',
    ].join('\n'));
    expect(Object.keys(getAliasMap(ctx)).sort()).toEqual(['foo']);
  });
});
