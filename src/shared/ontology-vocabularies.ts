/**
 * A thoughtbase's own vocabularies (#2788): Turtle files imported in
 * Settings → Ontology, kept in `<thoughtbase>/.minerva/ontology/`, and loaded
 * beside the built-in ontology. The shapes both processes need — main checks
 * and loads the files, the Settings panel shows what each one declares.
 */

/** A prefix a vocabulary declares, usable in any query without a `PREFIX` line. */
export interface VocabularyPrefix {
  prefix: string;
  iri: string;
}

/** A class or property a vocabulary declares. */
export interface VocabularyTerm {
  iri: string;
  /** `prefix:local` when a prefix covers the IRI. */
  curie?: string;
  label?: string;
}

/**
 * One file in `.minerva/ontology/`, as checked. A refused file is never
 * loaded — not half-loaded — and `problems` says why, naming each term.
 */
export type VocabularyStatus =
  | {
    file: string;
    ok: true;
    prefixes: VocabularyPrefix[];
    classes: VocabularyTerm[];
    properties: VocabularyTerm[];
    /** How many triples it adds to the graph. */
    triples: number;
    /** Things worth knowing that don't refuse it (an empty prefix, say). */
    notes: string[];
  }
  | { file: string; ok: false; problems: string[] };

/**
 * What Import Turtle… found in the picked file, before anything is saved.
 * `id` names the read held in main; importing commits exactly that text.
 */
export interface VocabularyImportPreview {
  id: string;
  /** The name it will be saved under. */
  file: string;
  /** An imported vocabulary of the same name is replaced. */
  replaces: boolean;
  status: VocabularyStatus;
}

/** Where they live, relative to the thoughtbase root. */
export const USER_ONTOLOGY_DIR = '.minerva/ontology';
