/**
 * A note's IRI back to its path (#2775). A `link-to-type` value comes back from
 * the graph as the linked note's IRI (`main/graph/uri-helpers.ts` `noteUri`:
 * `<base>note/<segment-encoded path, without .md/.ttl>`). A view that wants
 * to act on the linked note needs its path.
 *
 * The base is per thoughtbase and may itself contain `note/` (a project named
 * "note"), so each `note/` occurrence is tried against the notes that exist,
 * rather than trusting the first — and the extension the IRI dropped is
 * restored the same way.
 */
export function notePathForIri(iri: string, notePaths: ReadonlySet<string>): string | null {
  if (!/^https?:\/\//i.test(iri)) return null;
  for (let at = iri.indexOf('/note/'); at >= 0; at = iri.indexOf('/note/', at + 1)) {
    let stem: string;
    try {
      stem = iri.slice(at + '/note/'.length).split('/').map(decodeURIComponent).join('/');
    } catch {
      continue;
    }
    if (!stem) continue;
    for (const candidate of [`${stem}.md`, `${stem}.ttl`]) {
      if (notePaths.has(candidate)) return candidate;
    }
  }
  return null;
}
