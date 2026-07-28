/**
 * End-to-end test seams (#998). Active ONLY when `MINERVA_E2E=1` — which the
 * Playwright e2e job sets on launch; a no-op in every normal run.
 *
 * Why this exists: the "conversation → approve → graph mutation" happy path
 * can't be driven end-to-end in CI — the conversation step needs a live LLM
 * (non-deterministic, API-key-gated), and a pending proposal seeded into
 * `graph.ttl` doesn't survive project open (acquireProject rebuilds the store
 * from notes). So this hook files ONE fixed pending proposal through the real
 * approval engine (`proposeWrite`); the e2e then approves it via the normal
 * `api.proposals.approve` IPC and asserts the graph reflects the applied
 * payload — exercising the deterministic approve→graph half of the flow.
 *
 * It lives on `globalThis`, not the preload bridge, so it adds nothing to the
 * renderer API surface (no preload-snapshot change). The e2e reaches it through
 * Playwright's `electronApp.evaluate()`, which runs in the main process.
 */
import { BrowserWindow } from 'electron';
import { getRootPath } from './window-manager';
import { projectContext } from './project-context-types';
import { proposeWrite } from './llm/approval';
import { ingestHtmlString } from './sources/ingest';
import { reindexSource } from './sources/source-meta-write';

export interface E2EHooks {
  /** File a fixed pending proposal into the focused window's project.
   *  Returns the proposal URI, or null if it applied autonomously (it won't —
   *  new_claim is requires_approval). */
  seedProposal(): Promise<string | null>;
  /** Ingest a fixed source from an in-memory HTML string into the focused
   *  window's project — the same persistence pipeline `api.sources.ingestUrl`
   *  runs *after* its network fetch, minus the fetch. Deterministic and
   *  offline, so the source-ingestion e2e journey doesn't depend on the network.
   *  Returns the persisted source's id + title. */
  ingestSource(): Promise<{ sourceId: string; title: string }>;
}

/** The distinctive triple the seeded proposal adds on approval. */
export const E2E_CLAIM_LABEL = 'E2E Approved Claim';

/** The title of the source the ingestSource hook persists. The e2e asserts a
 *  source with this title lands in `api.sources.listAll()`. */
export const E2E_SOURCE_TITLE = 'E2E Ingested Source';

/** The synthetic URL the seeded source is attributed to. Fixed so the source id
 *  (derived from the URL) is stable across runs. */
const E2E_SOURCE_URL = 'https://e2e.minerva.test/ingested-source';

export function installE2EHooks(): void {
  if (process.env.MINERVA_E2E !== '1') return;
  const hooks: E2EHooks = {
    async seedProposal() {
      const win = BrowserWindow.getFocusedWindow();
      const rootPath = win ? getRootPath(win.id) : null;
      if (!rootPath) throw new Error('[e2e] no open project to seed a proposal into');
      const proposal = await proposeWrite(projectContext(rootPath), {
        operationType: 'new_claim',
        payloads: [{
          kind: 'graph-triples',
          turtle: `<urn:e2e:claim> <https://minerva.dev/ontology/thought#label> "${E2E_CLAIM_LABEL}" .`,
          affectsNodeUris: ['urn:e2e:claim'],
        }],
        note: 'e2e seeded proposal',
        proposedBy: 'e2e',
      });
      return proposal?.uri ?? null;
    },
    async ingestSource() {
      const win = BrowserWindow.getFocusedWindow();
      const rootPath = win ? getRootPath(win.id) : null;
      if (!rootPath) throw new Error('[e2e] no open project to ingest a source into');
      const html =
        `<!doctype html><html><head><title>${E2E_SOURCE_TITLE}</title></head>` +
        '<body><article><h1>E2E Ingested Source</h1>' +
        '<p>A deterministic source body ingested by the e2e harness so the ' +
        'source-ingestion journey runs offline.</p></article></body></html>';
      const result = await ingestHtmlString(rootPath, html, { url: E2E_SOURCE_URL });
      // ingestHtmlString writes files with raw fs but doesn't touch the live
      // graph store; index the source so `api.sources.listAll()` (a graph read)
      // sees it. Sources index via graph.indexSource, not the note indexer.
      await reindexSource(rootPath, result.sourceId);
      return { sourceId: result.sourceId, title: result.title };
    },
  };
  (globalThis as typeof globalThis & { __minervaE2E?: E2EHooks }).__minervaE2E = hooks;
}
