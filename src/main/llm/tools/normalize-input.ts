import { logger } from '../../../shared/logger';

/**
 * Undo one specific model slip before a tool sees its input: an array or
 * object parameter sent as a JSON-ENCODED STRING — `"properties": "[{…}]"`
 * instead of `"properties": [{…}]`.
 *
 * Models do this occasionally with large nested parameters, and the result was
 * a loop no prompt could break: the tool answered "`properties` must be a
 * non-empty array", the model was sure it had sent one, retried the same shape,
 * and finally told the user "something is preventing the parameters from being
 * passed correctly" — five `propose_object_type` calls and no proposal.
 *
 * Deliberately narrow. A string is decoded only where the tool's own schema
 * declares an array or object AND the string parses to exactly that kind, so a
 * genuine string parameter is never touched and anything else falls through to
 * the tool's own validation unchanged. Walks nested `properties` / `items`, so
 * an enum's `options` inside `properties` is covered too.
 */

interface Schema {
  type?: string | string[];
  properties?: Record<string, Schema>;
  items?: Schema;
}

const wants = (schema: Schema | undefined, kind: 'array' | 'object'): boolean =>
  !!schema && (schema.type === kind || (Array.isArray(schema.type) && schema.type.includes(kind)));

export function normalizeToolInput(schema: unknown, input: unknown, tool = 'tool'): unknown {
  const fixed: string[] = [];
  const out = walk(schema as Schema | undefined, input, '', fixed);
  if (fixed.length > 0) {
    logger('llm-tools').info(`${tool}: decoded JSON-string argument(s) the schema declares as structured:`, fixed.join(', '));
  }
  return out;
}

function walk(schema: Schema | undefined, value: unknown, path: string, fixed: string[]): unknown {
  if (!schema) return value;
  let v = value;
  if (typeof v === 'string' && (wants(schema, 'array') || wants(schema, 'object'))) {
    const decoded = tryParse(v);
    const ok = (Array.isArray(decoded) && wants(schema, 'array'))
      || (isPlainObject(decoded) && wants(schema, 'object'));
    if (ok) {
      v = decoded;
      fixed.push(path || '(input)');
    }
  }
  if (Array.isArray(v) && schema.items) {
    return v.map((item, i) => walk(schema.items, item, `${path}[${i}]`, fixed));
  }
  if (isPlainObject(v) && schema.properties) {
    const next: Record<string, unknown> = { ...v };
    for (const [key, sub] of Object.entries(schema.properties)) {
      if (key in next) next[key] = walk(sub, next[key], path ? `${path}.${key}` : key, fixed);
    }
    return next;
  }
  return v;
}

function tryParse(s: string): unknown {
  const t = s.trim();
  if (!(t.startsWith('[') || t.startsWith('{'))) return undefined;
  try {
    return JSON.parse(t);
  } catch (e) {
    // Not JSON is the expected miss (the tool then rejects the string with its
    // own message); anything else is a real failure and propagates.
    if (e instanceof SyntaxError) return undefined;
    throw e;
  }
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
