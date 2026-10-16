/**
 * What the Properties panel says about a `type:` no catalog defines (#2635).
 * Usually the type comes from a plugin that isn't in use on this machine, and
 * the open thoughtbase may say which. It's a hint, never an error: the note
 * and its frontmatter are left exactly as written.
 */
import type { PluginRecommendation } from '../../../shared/plugins/format';

const label = (r: PluginRecommendation) => r.name ?? r.id;

function list(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

export function unknownTypeHint(
  typeId: string,
  found: { exact: PluginRecommendation | null; possible: PluginRecommendation[] },
): string {
  const kept = 'The note is left as written.';
  if (found.exact) {
    const off = found.exact.status === 'disabled' ? ', installed here but turned off' : ', which isn\'t installed';
    return `"${typeId}" comes from the ${label(found.exact)} plugin${off}. This thoughtbase recommends it. ${kept}`;
  }
  if (found.possible.length > 0) {
    return `No type "${typeId}" is defined here. It may come from a plugin this thoughtbase recommends: ${list(found.possible.map(label))}. ${kept}`;
  }
  return `No type "${typeId}" is defined here; it may come from a plugin that isn't installed. ${kept}`;
}
