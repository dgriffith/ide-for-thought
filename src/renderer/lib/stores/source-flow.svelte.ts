/**
 * Source-flow feature-dialog state (#670). Three multi-step source flows keep
 * their in-flight state here so the source-ops handler cluster can drive them
 * and App's template can render the paired dialogs without a prop fan-out:
 *
 * - Mine references (#106): right-click a source → mine its References section
 *   with the LLM, review the parsed candidates, approve → backend writes stubs.
 * - Resolve stub (#107): search CrossRef for a stub source; below the
 *   auto-apply threshold the disambiguation picker opens with the top
 *   candidates.
 * - OCR (#95): a scanned PDF is persisted but its body.md is empty until OCR
 *   runs; the OCR dialog reads the PDF bytes + page count from here and the
 *   source tab is deferred until OCR finishes / is skipped.
 */
import type { ParsedReference } from '../../../shared/mine-references';
import type { ResolveCandidate } from '../../../shared/resolve-stub';

export interface OcrSession {
  sourceId: string;
  title: string;
  pageCount: number;
}

export interface MineReview {
  parentId: string;
  parentTitle: string;
  refs: ParsedReference[];
}

export interface ResolveStub {
  sourceId: string;
  stubTitle: string;
  candidates: ResolveCandidate[];
}

let ocrSession = $state<OcrSession | null>(null);
let ocrPdfBytes = $state<Uint8Array | null>(null);
let mineReview = $state<MineReview | null>(null);
let resolveStub = $state<ResolveStub | null>(null);

export function getSourceFlowStore() {
  return {
    get ocrSession() { return ocrSession; }, setOcrSession(s: OcrSession | null) { ocrSession = s; },
    get ocrPdfBytes() { return ocrPdfBytes; }, setOcrPdfBytes(b: Uint8Array | null) { ocrPdfBytes = b; },
    get mineReview() { return mineReview; }, setMineReview(s: MineReview | null) { mineReview = s; },
    get resolveStub() { return resolveStub; }, setResolveStub(s: ResolveStub | null) { resolveStub = s; },
  };
}
