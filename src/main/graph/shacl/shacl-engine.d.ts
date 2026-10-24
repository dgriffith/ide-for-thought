/**
 * The slice of `shacl-engine` (rdf-ext, #2642) Minerva uses: it ships no
 * types. Kept to what `run.ts` calls, so a version that changes these shapes
 * fails `tsc` here rather than at a call site.
 */
declare module 'shacl-engine' {
  import type { DatasetCore, Term, NamedNode, DataFactory } from '@rdfjs/types';

  export interface ValidationReport {
    conforms: boolean;
    results: Array<{
      focusNode?: Term;
      message?: Term[];
      severity?: NamedNode;
    }>;
  }

  export class Validator {
    constructor(shapes: DatasetCore, options: { factory: DataFactory & { dataset(quads?: Iterable<unknown>): DatasetCore }; validations?: unknown; targetResolvers?: unknown });
    /** `shapes`: the shapes to validate with, each by its terms; absent, every shape. */
    validate(data: { dataset: DatasetCore; terms?: Iterable<Term> }, shapes?: Array<{ terms: Iterable<Term> }>): Promise<ValidationReport>;
  }
}

declare module 'shacl-engine/sparql.js' {
  export const validations: unknown;
  export const targetResolvers: unknown;
}
