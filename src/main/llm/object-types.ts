/**
 * Object-type proposal apply helper (#2069) — the LLM-facing counterpart to
 * `TypeEditorDialog.svelte`'s save flow. Given a candidate type definition,
 * files ONE pending `thought:Proposal` (`type-def` payload,
 * `apply-dispatch.ts`'s handler writes `.minerva/types/<id>.md` via
 * `saveType` and reloads the catalog on approval) rather than writing
 * anything directly. Mirrors `infer-types.ts`'s shape exactly: a plain apply
 * helper the tool wrapper calls, running inside `withLLMContext` so a graph
 * write that skipped the approval engine here would trip the write guard
 * under test.
 *
 * Electron-free: returns plain data for the tool layer, no `app`/IPC imports.
 */
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import { proposeWrite } from './approval';
import { loadTypeCatalog } from '../types/loader';
import { slugify, type SaveTypeInput } from '../types/write';
import { PROPERTY_TYPES } from '../../shared/objects/type-def';

export interface ProposeObjectTypeResult {
  id: string;
  isEdit: boolean;
}

/**
 * Derive the id a `SaveTypeInput` would resolve to, matching `saveType`'s
 * own precedence exactly (explicit `id` wins, else slugify the label) — this
 * has to be computed here (not just left to apply time) so the collision
 * check below and the reviewer-facing `note` both see the real id.
 */
function resolveId(input: SaveTypeInput): string {
  return (input.id && slugify(input.id)) || slugify(input.label);
}

/**
 * File a pending type-definition proposal. Throws (caught by the tool
 * wrapper, surfaced as a normal tool error) on validation failure — an id
 * collision that isn't an explicit edit, or a property naming a `type`
 * outside the six declared `PropertyType`s. Both are checked BEFORE
 * `withLLMContext`/`proposeWrite`, since these are input-shape rejections,
 * not graph writes.
 */
export async function proposeObjectTypeDef(
  rootPath: string,
  conversationId: string,
  input: SaveTypeInput,
  note: string,
): Promise<ProposeObjectTypeResult> {
  const id = resolveId(input);
  if (!id) throw new Error('Type name is empty.');

  const catalog = await loadTypeCatalog(rootPath);
  const existing = catalog.types.find((t) => t.id === id);
  // An id collision is only a valid "edit" when the caller explicitly named
  // that same existing type via `id` — a bare label that happens to slugify
  // to an existing id is NOT implicit permission to overwrite it. This is a
  // much bigger blast radius than a `note` payload's auto-suffix-on-collision
  // behavior, so it's a hard rejection, not a silent rename.
  const explicitEdit = !!input.id && slugify(input.id) === id;
  if (existing && !explicitEdit) {
    throw new Error(
      `A type with id "${id}" already exists ("${existing.label}"). ` +
        'Choose a different label, or pass id="' + id + '" to propose an edit to it.',
    );
  }

  for (const p of input.properties) {
    if (!PROPERTY_TYPES.includes(p.type)) {
      throw new Error(
        `Property "${p.name}" has type "${p.type}", which isn't one of: ${PROPERTY_TYPES.join(', ')}.`,
      );
    }
  }

  // Armed with the trust guard (#944): LLM-originated, so a graph write that
  // bypasses the approval engine here throws under test.
  return graph.withLLMContext(async () => {
    const ctx = projectContext(rootPath);
    await proposeWrite(ctx, {
      operationType: 'type_definition',
      payloads: [{ kind: 'type-def', ...input, id }],
      note,
      conversationUri: `https://minerva.dev/ontology/thought#conversation/${conversationId}`,
      proposedBy: `llm:conversation:${conversationId}`,
    });
    return { id, isEdit: !!existing };
  });
}
