/**
 * `list_extension_points` / `describe_extension_point` (#2619): the
 * extension-point catalog, for the conversation model. The same descriptions
 * and the same JSON `minerva mcp` gives an external agent — both come from
 * `shared/extensions/describe.ts`.
 */
import {
  DESCRIBE_EXTENSION_POINT_DESCRIPTION,
  DESCRIBE_EXTENSION_POINT_SCHEMA,
  LIST_EXTENSION_POINTS_DESCRIPTION,
  LIST_EXTENSION_POINTS_SCHEMA,
  describeExtensionPoint as describePoint,
  listExtensionPoints as listPoints,
} from '../../../shared/extensions/describe';
import type { NotebaseTool } from './types';

const json = (r: { ok: true } & object | { ok: false; error: string }) =>
  (r.ok ? { content: JSON.stringify(r, null, 2), isError: false } : { content: r.error, isError: true });

export const listExtensionPoints: NotebaseTool = {
  definition: {
    name: 'list_extension_points',
    description: LIST_EXTENSION_POINTS_DESCRIPTION,
    input_schema: LIST_EXTENSION_POINTS_SCHEMA,
  },
  run: (_ctx, input) => {
    const args = (input ?? {}) as { rung?: unknown; open_only?: unknown };
    return Promise.resolve(json(listPoints({
      ...(typeof args.rung === 'string' && args.rung ? { rung: args.rung } : {}),
      openOnly: args.open_only === true,
    })));
  },
};

export const describeExtensionPoint: NotebaseTool = {
  definition: {
    name: 'describe_extension_point',
    description: DESCRIBE_EXTENSION_POINT_DESCRIPTION,
    input_schema: DESCRIBE_EXTENSION_POINT_SCHEMA,
  },
  run: (_ctx, input) => {
    const id = (input as { id?: unknown } | null)?.id;
    return Promise.resolve(json(describePoint(typeof id === 'string' ? id.trim() : '')));
  },
};
