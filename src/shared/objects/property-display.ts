/**
 * How a typed property's read-back value reads on screen — the type view's
 * list, table, gallery and kanban cells, its filter control, and the render
 * card behind link and hover cards.
 *
 * A `link-to-type` value comes back from the graph as the linked note's IRI
 * (`https://…/note/people/Alice%20Smith`), shown as the note's name. But a
 * link property can also hold plain text: a half-written link, or a name that
 * was never linked — every meeting note's `attendees: Alice, Bob` from before
 * Meeting inherited Event's link-to-Person `attendees` (#2612). The graph
 * indexes that as a plain literal, and it is shown exactly as written. Only an
 * IRI is shortened: this used to cut every link value at its last `/` or `#`,
 * which turned `Carol / Dan` into ` Dan`.
 *
 * A `datetime` (#2613) is shown in the viewer's locale at its own precision:
 * the time only when one was written, BCE with an era (`-0043` → "44 BC").
 * A `date` is shown as written.
 */
import type { PropertyDef, TypeInfo } from './type-def';
import { formatDateValue, type FormatDateOptions } from './date-values';

/** The graph's note IRIs are http(s) (`uri-helpers.ts`'s `coinBaseUri`). */
const IRI_RE = /^https?:\/\/\S+$/i;

export function displayPropertyValue(
  prop: Pick<PropertyDef, 'type'>,
  value: string | null,
  opts: FormatDateOptions = {},
): string {
  if (value === null || value === '') return '—';
  if (prop.type === 'datetime') return formatDateValue(value, opts);
  if (prop.type === 'link-to-type' && IRI_RE.test(value)) {
    const tail = value.split(/[/#]/).pop() || value;
    try { return decodeURIComponent(tail); } catch { return tail; }
  }
  return value;
}

/** A type's field count as a picker shows it — inherited properties included,
 *  so Meeting (one own property, four from Event) reads as five, not one. */
export function typeFieldCount(t: Pick<TypeInfo, 'properties' | 'effectivePropertyNames'>): number {
  return (t.effectivePropertyNames ?? t.properties).length;
}
