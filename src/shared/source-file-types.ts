/**
 * The file types Minerva itself reads as Sources (#2629): the built-in
 * ingestors' extensions, plus the files the dedicated multi-source imports
 * take (BibTeX, Zotero RDF). Shared so the ingestor registry
 * (`main/sources/ingestors.ts`) and the plugin manifest check agree: a
 * plugin's ingestor (#2647) can't take one of these over.
 *
 * Lowercase, with the dot.
 */
export const BUILTIN_SOURCE_FILE_EXTENSIONS = {
  pdf: ['.pdf'],
  html: ['.html', '.htm'],
  text: ['.txt', '.text'],
  markdown: ['.md', '.markdown'],
} as const;

/** Read by their own import commands, not the ingestor registry. */
const IMPORT_FILE_EXTENSIONS = ['.bib', '.rdf'] as const;

const RESERVED = new Set<string>([...Object.values(BUILTIN_SOURCE_FILE_EXTENSIONS).flat(), ...IMPORT_FILE_EXTENSIONS]);

/** Whether Minerva reads `ext` (lowercase, with the dot) itself. */
export function isBuiltinSourceFileExtension(ext: string): boolean {
  return RESERVED.has(ext);
}
