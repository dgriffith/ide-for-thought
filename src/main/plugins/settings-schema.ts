/**
 * A plugin's `settings` in `plugin.json` (#2636): a JSON Schema subset, read
 * into {@link PluginSetting}s. Pure, and fail closed like the rest of the
 * manifest — every problem reported at once, an unknown keyword refused.
 *
 * ```json
 * "settings": {
 *   "maxItems": { "type": "number", "title": "Items per summary", "minimum": 1, "maximum": 50, "default": 10 },
 *   "style":    { "type": "string", "enum": ["brief", "detailed"], "default": "brief" },
 *   "apiToken": { "type": "secret", "title": "API token" }
 * }
 * ```
 *
 * `secret` is the one keyword that isn't JSON Schema: a string Minerva keeps
 * encrypted and never shows, and that no template can read.
 */
import type { PluginSetting, PluginSettingValue } from '../../shared/plugins/format';

export const SETTING_KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
export const SETTING_LIMITS = { fields: 32, title: 80, description: 500, options: 50, option: 100, string: 2000 } as const;

const TYPES = ['string', 'number', 'boolean', 'secret'] as const;
const ALLOWED: Record<string, ReadonlySet<string>> = {
  string: new Set(['type', 'title', 'description', 'default', 'enum']),
  number: new Set(['type', 'title', 'description', 'default', 'minimum', 'maximum']),
  boolean: new Set(['type', 'title', 'description', 'default']),
  secret: new Set(['type', 'title', 'description']),
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** `{{plugin.settings.maxItems}}`'s `maxItems` → "Max items", when no title is given. */
function titleFor(key: string): string {
  const words = key.replace(/_/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function validatePluginSettings(raw: unknown, problems: string[]): PluginSetting[] | undefined {
  if (!isRecord(raw)) {
    problems.push('"settings" must be an object of setting name → its schema.');
    return undefined;
  }
  const entries = Object.entries(raw);
  if (entries.length > SETTING_LIMITS.fields) problems.push(`"settings" has ${entries.length} settings; at most ${SETTING_LIMITS.fields}.`);
  const out: PluginSetting[] = [];
  for (const [key, spec] of entries.slice(0, SETTING_LIMITS.fields)) {
    const at = `"settings.${key}"`;
    const before = problems.length;
    if (!SETTING_KEY.test(key)) problems.push(`${at}: a setting's name must be letters, digits and "_", starting with a letter.`);
    if (!isRecord(spec)) {
      problems.push(`${at} must be an object like { "type": "string" }.`);
      continue;
    }
    const type = spec.type;
    if (typeof type !== 'string' || !(TYPES as readonly string[]).includes(type)) {
      problems.push(`${at}: "type" must be one of ${TYPES.join(', ')}.`);
      continue;
    }
    for (const k of Object.keys(spec)) {
      if (!ALLOWED[type]!.has(k)) problems.push(`${at}: "${k}" isn't allowed for a ${type} setting.`);
    }
    const text = (k: 'title' | 'description', max: number): string | undefined => {
      const v = spec[k];
      if (v === undefined) return undefined;
      if (typeof v !== 'string' || v.trim() === '' || v.length > max) {
        problems.push(`${at}: "${k}" must be a non-empty string of at most ${max} characters.`);
        return undefined;
      }
      return v.trim();
    };
    const title = text('title', SETTING_LIMITS.title) ?? titleFor(key);
    const description = text('description', SETTING_LIMITS.description);
    const base = { key, title, ...(description ? { description } : {}) };
    const def = spec.default;

    let setting: PluginSetting | undefined;
    if (type === 'secret') {
      setting = { ...base, kind: 'secret' };
    } else if (type === 'boolean') {
      if (def !== undefined && typeof def !== 'boolean') problems.push(`${at}: "default" must be true or false.`);
      setting = { ...base, kind: 'boolean', ...(typeof def === 'boolean' ? { default: def } : {}) };
    } else if (type === 'number') {
      const num = (k: 'minimum' | 'maximum' | 'default'): number | undefined => {
        const v = spec[k];
        if (v === undefined) return undefined;
        if (typeof v !== 'number' || !Number.isFinite(v)) {
          problems.push(`${at}: "${k}" must be a number.`);
          return undefined;
        }
        return v;
      };
      const minimum = num('minimum');
      const maximum = num('maximum');
      const d = num('default');
      if (minimum !== undefined && maximum !== undefined && minimum > maximum) problems.push(`${at}: "minimum" is more than "maximum".`);
      if (d !== undefined && ((minimum !== undefined && d < minimum) || (maximum !== undefined && d > maximum))) problems.push(`${at}: "default" is outside "minimum"…"maximum".`);
      setting = {
        ...base, kind: 'number',
        ...(minimum !== undefined ? { minimum } : {}),
        ...(maximum !== undefined ? { maximum } : {}),
        ...(d !== undefined ? { default: d } : {}),
      };
    } else if (spec.enum !== undefined) {
      const opts = spec.enum;
      if (!Array.isArray(opts) || opts.length === 0 || opts.length > SETTING_LIMITS.options
        || !opts.every((o) => typeof o === 'string' && o.length > 0 && o.length <= SETTING_LIMITS.option)
        || new Set(opts).size !== opts.length) {
        problems.push(`${at}: "enum" must list 1 to ${SETTING_LIMITS.options} different, non-empty strings.`);
      } else {
        if (def !== undefined && !(typeof def === 'string' && opts.includes(def))) problems.push(`${at}: "default" must be one of its "enum".`);
        setting = { ...base, kind: 'enum', options: opts as string[], ...(typeof def === 'string' && opts.includes(def) ? { default: def } : {}) };
      }
    } else {
      if (def !== undefined && (typeof def !== 'string' || def.length > SETTING_LIMITS.string)) problems.push(`${at}: "default" must be a string of at most ${SETTING_LIMITS.string} characters.`);
      setting = { ...base, kind: 'string', ...(typeof def === 'string' ? { default: def } : {}) };
    }
    if (setting && problems.length === before) out.push(setting);
  }
  return out;
}

/**
 * Check one value from the form against its setting. A refusal says why, in
 * words for the person who typed it.
 */
export function checkSettingValue(field: PluginSetting, value: unknown): { ok: true; value: PluginSettingValue } | { ok: false; problem: string } {
  const name = `"${field.title}"`;
  switch (field.kind) {
    case 'boolean':
      return typeof value === 'boolean' ? { ok: true, value } : { ok: false, problem: `${name} must be on or off.` };
    case 'number': {
      const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
      if (typeof n !== 'number' || !Number.isFinite(n)) return { ok: false, problem: `${name} must be a number.` };
      if (field.minimum !== undefined && n < field.minimum) return { ok: false, problem: `${name} must be at least ${field.minimum}.` };
      if (field.maximum !== undefined && n > field.maximum) return { ok: false, problem: `${name} must be at most ${field.maximum}.` };
      return { ok: true, value: n };
    }
    case 'enum':
      return typeof value === 'string' && field.options.includes(value)
        ? { ok: true, value }
        : { ok: false, problem: `${name} must be one of ${field.options.join(', ')}.` };
    case 'string':
    case 'secret':
      if (typeof value !== 'string') return { ok: false, problem: `${name} must be text.` };
      if (value.length > SETTING_LIMITS.string) return { ok: false, problem: `${name} is ${value.length} characters; at most ${SETTING_LIMITS.string}.` };
      return { ok: true, value };
  }
}
