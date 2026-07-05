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

export interface E2EHooks {
  /** File a fixed pending proposal into the focused window's project.
   *  Returns the proposal URI, or null if it applied autonomously (it won't —
   *  new_claim is requires_approval). */
  seedProposal(): Promise<string | null>;
}

/** The distinctive triple the seeded proposal adds on approval. */
export const E2E_CLAIM_LABEL = 'E2E Approved Claim';

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
  };
  (globalThis as typeof globalThis & { __minervaE2E?: E2EHooks }).__minervaE2E = hooks;
}
