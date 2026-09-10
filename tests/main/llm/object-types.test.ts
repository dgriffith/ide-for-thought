/**
 * Object-type proposals (#2069): `proposeObjectTypeDef` files a PENDING
 * `type_definition` proposal (never a direct write — the trust guard would
 * trip under test), approving it creates/edits `.minerva/types/<id>.md` and
 * reloads the catalog, and rejecting/bypassing leaves no trace. Mirrors
 * `propose-note-types-tool.test.ts`'s harness shape.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { queryGraph } from '../../../src/main/graph/index';
import { approveProposal } from '../../../src/main/llm/approval';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { proposeObjectTypeDef } from '../../../src/main/llm/object-types';
import { proposeObjectType } from '../../../src/main/llm/tools/propose-object-type';
import { saveType } from '../../../src/main/types/write';
import { loadTypeCatalog } from '../../../src/main/types/loader';
import { useGraphProject } from '../../helpers/temp-project';

const project = useGraphProject('minerva-object-types-');
let root: string;
let ctx: ProjectContext;

function typeFilePath(id: string): string {
  return path.join(root, '.minerva', 'types', `${id}.md`);
}
async function pendingCount(): Promise<number> {
  const r = await queryGraph(ctx, `SELECT (COUNT(?p) AS ?n) WHERE { ?p a thought:Proposal ; thought:proposalStatus thought:pending }`);
  return Number((r.results as Array<{ n: string }>)[0]!.n);
}
async function approvedCountByOperation(operationType: string): Promise<number> {
  const r = await queryGraph(
    ctx,
    `SELECT (COUNT(?p) AS ?n) WHERE { ?p a thought:Proposal ; thought:proposalStatus thought:approved ; thought:operationType "${operationType}" }`,
  );
  return Number((r.results as Array<{ n: string }>)[0]!.n);
}

beforeEach(() => {
  root = project.root;
  ctx = project.ctx;
});

describe('proposeObjectTypeDef (#2069)', () => {
  const RECIPE = { label: 'Recipe', properties: [{ name: 'servings', type: 'number' as const }] };

  it('files a pending proposal and does NOT write the type file (proposes, never applies)', async () => {
    const result = await proposeObjectTypeDef(root, 'conv1', RECIPE, 'New type');
    expect(result).toEqual({ id: 'recipe', isEdit: false });
    expect(await pendingCount()).toBe(1);
    expect(fs.existsSync(typeFilePath('recipe'))).toBe(false);
  });

  it('approving the proposal creates the type file and reloads the catalog', async () => {
    await proposeObjectTypeDef(root, 'conv1', RECIPE, 'New type');
    const { results } = await queryGraph(ctx, `SELECT ?p WHERE { ?p a thought:Proposal ; thought:proposalStatus thought:pending }`);
    const uri = (results as Array<{ p: string }>)[0]!.p;

    expect((await approveProposal(ctx, uri)).ok).toBe(true);
    expect(fs.existsSync(typeFilePath('recipe'))).toBe(true);
    expect(fs.readFileSync(typeFilePath('recipe'), 'utf-8')).toContain('label: Recipe');

    const catalog = await loadTypeCatalog(root);
    expect(catalog.types.find((t) => t.id === 'recipe')).toMatchObject({ label: 'Recipe' });
    expect(await approvedCountByOperation('type_definition')).toBe(1);
  });

  it('rejects an id collision that is not an explicit edit', async () => {
    await saveType(root, { label: 'Recipe', properties: [] });
    await expect(proposeObjectTypeDef(root, 'conv1', RECIPE, 'New type')).rejects.toThrow(/already exists/);
    expect(await pendingCount()).toBe(0);
  });

  it('allows an explicit edit of an existing type by id', async () => {
    await saveType(root, { label: 'Recipe', properties: [] });
    const result = await proposeObjectTypeDef(
      root,
      'conv1',
      { label: 'Recipe', id: 'recipe', properties: [{ name: 'servings', type: 'number' }] },
      'Edit type',
    );
    expect(result).toEqual({ id: 'recipe', isEdit: true });
  });

  it('rejects a property with an invalid type', async () => {
    await expect(
      proposeObjectTypeDef(root, 'conv1', { label: 'Bad', properties: [{ name: 'x', type: 'wizard' as never }] }, 'x'),
    ).rejects.toThrow(/isn't one of/);
    expect(await pendingCount()).toBe(0);
  });

  it('bypassing the approval engine (calling saveType directly) leaves no approved proposal', async () => {
    await saveType(root, RECIPE);
    expect(fs.existsSync(typeFilePath('recipe'))).toBe(true);
    // The file exists, but nothing went through the approval engine — proving
    // the honest path above is what actually creates an approved record, not
    // a side effect of the file existing.
    expect(await approvedCountByOperation('type_definition')).toBe(0);
  });
});

describe('propose_object_type tool (#2069)', () => {
  const convCtx = () => ({ rootPath: root, conversationId: 'conv1' });
  const input = { label: 'Recipe', properties: [{ name: 'servings', type: 'number' }] };

  it('proposes via the tool and reports the id', async () => {
    const res = await proposeObjectType.run(convCtx(), input, {});
    expect(res.isError).toBe(false);
    const payload = JSON.parse(res.content);
    expect(payload.status).toBe('proposed');
    expect(payload.id).toBe('recipe');
    expect(await pendingCount()).toBe(1);
  });

  it('requires a bound conversation id', async () => {
    const res = await proposeObjectType.run({ rootPath: root }, input, {});
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/conversation id/);
  });

  it('rejects a malformed input (missing properties)', async () => {
    const res = await proposeObjectType.run(convCtx(), { label: 'Recipe' }, {});
    expect(res.isError).toBe(true);
  });

  it('rejects an invalid property type at the tool boundary', async () => {
    const res = await proposeObjectType.run(convCtx(), { label: 'Recipe', properties: [{ name: 'x', type: 'wizard' }] }, {});
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/isn't one of/);
  });

  it('surfaces an id-collision rejection as a tool error, not a thrown exception', async () => {
    await saveType(root, { label: 'Recipe', properties: [] });
    const res = await proposeObjectType.run(convCtx(), input, {});
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/already exists/);
  });
});
