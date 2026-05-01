/**
 * Type shim for citeproc-js (#247).
 *
 * `citeproc` ships without @types; we only touch a tiny slice of its
 * surface — enough for the `Engine` constructor, `processCitationCluster`,
 * `makeBibliography`, and `updateItems`. Everything else stays `unknown`
 * so the wrapper in renderer.ts owns the behavioural contract.
 */
declare module 'citeproc' {
  export interface CiteprocSystem {
    retrieveItem(id: string): unknown;
    retrieveLocale(lang: string): string;
  }

  export class Engine {
    constructor(sys: CiteprocSystem, styleXml: string);
    updateItems(ids: string[]): void;
    makeBibliography(): [unknown, string[]] | false;
    processCitationCluster(
      cluster: { citationItems: Array<Record<string, unknown>>; properties: Record<string, unknown> },
      citationsPre: unknown[],
      citationsPost: unknown[],
    ): [Record<string, unknown>, Array<[number, string, string]>];
    /** Switch the engine's output format ("html" / "text" / "rtf"). */
    setOutputFormat(fmt: 'html' | 'text' | 'rtf'): void;
    // Engine exposes more — we surface only the bits the wrapper reads.
    cslXml?: { dataObj?: { attrs?: { class?: string } } };
  }

  const _default: {
    Engine: typeof Engine;
    PROCESSOR_VERSION: string;
  };
  export default _default;
}
