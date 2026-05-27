/**
 * Invalid-DOI inspection (#473). The inspection is shape-only —
 * it doesn't hit doi.org, just flags `bibo:doi` values that don't
 * match the Crossref `10.NNNN/...` form.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { initGraph, indexSource } from '../../../src/main/graph/index';
import { runAllChecks } from '../../../src/main/graph/health-checks';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

const META = (doi: string | null) => `this: a thought:Article ;
    dc:title "Test" ;
${doi ? `    bibo:doi "${doi}" ;\n` : ''}    thought:accessedAt "2026-05-01T00:00:00Z"^^xsd:dateTime .
`;

describe('checkInvalidDois (#473)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-invalid-doi-'));
    ctx = projectContext(root);
    await initGraph(ctx);
  });
  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  function addSource(id: string, doi: string | null): void {
    const dir = path.join(root, '.minerva', 'sources', id);
    fs.mkdirSync(dir, { recursive: true });
    const ttl = META(doi);
    fs.writeFileSync(path.join(dir, 'meta.ttl'), ttl);
    indexSource(ctx, id, ttl);
  }

  it('flags a source whose DOI does not match the Crossref shape', async () => {
    addSource('bad-shape', 'not-a-doi');
    const inspections = await runAllChecks(ctx);
    const invalid = inspections.filter((i) => i.type === 'invalid_doi');
    expect(invalid).toHaveLength(1);
    expect(invalid[0].severity).toBe('warning');
    expect(invalid[0].message).toContain('not-a-doi');
  });

  it('does not flag a well-formed DOI', async () => {
    addSource('good', '10.1145/3677999.3678002');
    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'invalid_doi')).toBe(false);
  });

  it('does not flag a source with no DOI at all', async () => {
    addSource('no-doi', null);
    const inspections = await runAllChecks(ctx);
    expect(inspections.some((i) => i.type === 'invalid_doi')).toBe(false);
  });

  it('flags only the bad rows when multiple sources exist', async () => {
    addSource('good', '10.1145/3677999.3678002');
    addSource('bad', '10.SHORT');
    const inspections = await runAllChecks(ctx);
    const invalid = inspections.filter((i) => i.type === 'invalid_doi');
    expect(invalid).toHaveLength(1);
    expect(invalid[0].nodeLabel).toBe('Test');
  });
});
