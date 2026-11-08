/**
 * A `geo` property's value (#2064/#2065): a plain `"<lat>,<lng>"` string.
 * Shared since #2944, when main began inferring a query column's type from
 * its values; the live map and its export fallback read it the same way.
 */

/** Parse a "<lat>,<lng>" geo value; null for missing/malformed (omitted, not
 *  errored — #2066). */
export function parseLatLng(value: string | null | undefined): [number, number] | null {
  if (!value) return null;
  const parts = value.split(',').map((s) => Number(s.trim()));
  if (parts.length !== 2) return null;
  const [lat, lng] = parts;
  if (lat === undefined || lng === undefined || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return [lat, lng];
}
