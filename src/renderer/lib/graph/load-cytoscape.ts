/**
 * Lazy-load Cytoscape (#844). It's a heavy dep, so it's dynamic-`import()`ed and
 * cached in a module-level promise — kept out of the initial renderer bundle,
 * the same posture as mermaid / vega-embed. First graph view to mount pays the
 * load once; everyone after reuses it.
 */

import type cytoscape from 'cytoscape';

type CytoscapeFactory = typeof cytoscape;

let promise: Promise<CytoscapeFactory> | null = null;

export function loadCytoscape(): Promise<CytoscapeFactory> {
  if (!promise) {
    promise = import('cytoscape').then((m) => m.default ?? m);
  }
  return promise;
}
