/**
 * Reading a plugin's call (#2825): its params, checked by shape and bounded,
 * and the `Refusal` a bad one is answered with. Split out of `broker.ts`,
 * which checks capability and scope and runs the call.
 */
import {
  PLUGIN_MENU_MAX_ITEMS,
  PLUGIN_MENU_MAX_LABEL,
  type PluginErrorCode,
  type PluginMenuItem,
  type PluginMoveTarget,
} from '../../shared/plugins/api';

/** A call the broker won't run, and the code it's answered with. */
export class Refusal extends Error {
  constructor(readonly code: PluginErrorCode, message: string) { super(message); }
}

/** A context menu as asked for: items with an id and a label, or separators, within limits. */
export function menuItems(raw: unknown): PluginMenuItem[] {
  if (!Array.isArray(raw) || raw.length === 0) throw new Refusal('bad-request', '"items" must be a non-empty list.');
  if (raw.length > PLUGIN_MENU_MAX_ITEMS) throw new Refusal('bad-request', `A menu holds at most ${PLUGIN_MENU_MAX_ITEMS} items.`);
  return raw.map((item: unknown, i) => {
    if (item === null || typeof item !== 'object') throw new Refusal('bad-request', `items[${i}] must be an object.`);
    const r = item as Record<string, unknown>;
    if (r.separator === true) return { separator: true as const };
    if (typeof r.id !== 'string' || r.id.length === 0) throw new Refusal('bad-request', `items[${i}].id must be a string.`);
    if (typeof r.label !== 'string' || r.label.trim() === '') throw new Refusal('bad-request', `items[${i}].label must be a string.`);
    if (r.label.length > PLUGIN_MENU_MAX_LABEL) throw new Refusal('bad-request', `items[${i}].label is over ${PLUGIN_MENU_MAX_LABEL} characters.`);
    return { id: r.id, label: r.label, ...(r.enabled === false ? { enabled: false } : {}) };
  });
}

export function asParams(raw: unknown): Record<string, unknown> {
  if (raw === undefined) return {};
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Refusal('bad-request', 'params must be an object.');
  return raw as Record<string, unknown>;
}

export function stringParam(params: Record<string, unknown>, key: string): string {
  const v = params[key];
  if (typeof v !== 'string') throw new Refusal('bad-request', `"${key}" must be a string.`);
  return v;
}

export function moveTargetParam(raw: unknown): PluginMoveTarget {
  if (raw === null || typeof raw !== 'object') throw new Refusal('bad-request', '"target" must be a group: { value, label, kind }.');
  const t = raw as Record<string, unknown>;
  if (t.kind !== 'option' && t.kind !== 'off-list' && t.kind !== 'no-value') throw new Refusal('bad-request', '"target.kind" is "option", "off-list" or "no-value".');
  if (typeof t.label !== 'string') throw new Refusal('bad-request', '"target.label" must be a string.');
  if (t.kind === 'no-value' ? t.value !== null : typeof t.value !== 'string') throw new Refusal('bad-request', '"target.value" is the group\'s value, null only for No value.');
  return { value: t.value as string | null, label: t.label.slice(0, PLUGIN_MENU_MAX_LABEL), kind: t.kind };
}

/** An optional list of strings: at most `max` of them, each cut to `chars`. Absent → []. */
export function stringsParam(params: Record<string, unknown>, key: string, max: number, chars: number): string[] {
  const raw = params[key];
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Refusal('bad-request', `"${key}" must be a list of strings.`);
  if (raw.length > max) throw new Refusal('bad-request', `"${key}" has at most ${max} entries.`);
  return raw.map((v, i) => {
    if (typeof v !== 'string') throw new Refusal('bad-request', `${key}[${i}] must be a string.`);
    return v.slice(0, chars);
  });
}

export function numberParam(params: Record<string, unknown>, key: string): number {
  const v = params[key];
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Refusal('bad-request', `"${key}" must be a number.`);
  return v;
}

export function viaParam(params: Record<string, unknown>): 'pointer' | 'focus' {
  const v = params.via ?? 'pointer';
  if (v !== 'pointer' && v !== 'focus') throw new Refusal('bad-request', '"via" is "pointer" or "focus".');
  return v;
}

export function recordParam(params: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = params[key];
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Refusal('bad-request', `"${key}" must be an object.`);
  return v as Record<string, unknown>;
}
