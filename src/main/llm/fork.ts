/**
 * A fork (#2971): the assistant splits independent work into branches (#2970)
 * that run at the same time, waits for them, and gets each one's final answer
 * back as material to weigh.
 *
 * This is the orchestration, with every collaborator injected, so it runs
 * without Electron and without importing the LLM client (the registrar wires
 * the real ones; `tools/fork.ts` is the model-facing tool):
 *
 * - **Refusals first.** A branch can't fork (depth 1 in v1), and a fork may
 *   start at most `maxBranches`.
 * - **Budget.** The fork is estimated as branches × the parent's average turn
 *   cost; above `confirmAboveUsd` it asks the user first, and without a way to
 *   ask it doesn't start. A fork has a time budget too: a branch still running
 *   when it runs out is stopped, and reports what it had.
 * - **Concurrency.** Every branch starts at once; the provider limiter (#2969)
 *   bounds how many requests actually go out together.
 * - **Stopping.** The parent's signal stops every branch (the registrar's
 *   cascade stops them by id too); a branch stopped on its own reports
 *   `stopped` with its partial answer, and the rest carry on.
 */
import type { Conversation } from '../../shared/conversation';

export interface ForkBranchSpec {
  title: string;
  instructions: string;
  /** A skill the branch runs as its whole task (`run_skill`). */
  skill?: string;
  model?: string;
}

export type ForkBranchStatus = 'done' | 'stopped' | 'failed';

export interface ForkBranchResult {
  title: string;
  conversationId: string;
  status: ForkBranchStatus;
  /** The branch's final answer; for a stopped or failed branch, what it had written. */
  answer: string;
  /** Why it stopped or failed, in a few words. */
  note?: string;
  /** What the branch cost, in dollars, when its models are priced. */
  costUSD: number;
}

export type ForkOutcome =
  | { ok: false; reason: string }
  | { ok: true; results: ForkBranchResult[]; estimateUSD: number; costUSD: number };

export interface ForkDeps {
  parent: Conversation;
  signal: AbortSignal;
  maxBranches: number;
  confirmAboveUsd: number;
  timeBudgetMs: number;
  /** Fork one branch from the parent. */
  createBranch: (spec: ForkBranchSpec) => Promise<Conversation>;
  /**
   * Run the branch's opening turn. `onChunk` receives the reply as it streams,
   * so a branch stopped midway still has something to report. Resolves to the
   * branch after its turn; rejects when it fails or is stopped.
   */
  runTurn: (branch: Conversation, signal: AbortSignal, onChunk: (text: string) => void) => Promise<Conversation>;
  /** Ask the user a question with choices; absent where nobody can be asked. */
  ask?: ((question: string, choices: string[]) => Promise<string>) | undefined;
}

export const FORK_TIME_BUDGET_MS = 10 * 60_000;

/** A branch's opening instructions: the fork's, a skill to run when it names one, and where its answer goes. */
export function branchInstructions(spec: ForkBranchSpec): string {
  const task = spec.skill
    ? `Run the skill “${spec.skill}” with run_skill as your whole task. ${spec.instructions}`
    : spec.instructions;
  return `${task}\n\nYou are one branch of a fork. You can read the thoughtbase but can't change it or ask the user anything. Answer in your reply: your final answer goes back to the conversation that forked you, which reads only that and can propose any changes.`;
}
const GO = 'Start the branches';
const STOP = 'Don’t fork';

/** A fork's rough cost: branches × the parent's average priced turn. 0 when nothing is priced yet. */
export function estimateForkCost(parent: Conversation, branches: number): number {
  const priced = parent.messages.filter((m) => m.role === 'assistant' && typeof m.costUSD === 'number');
  if (priced.length === 0) return 0;
  const average = priced.reduce((sum, m) => sum + (m.costUSD ?? 0), 0) / priced.length;
  return branches * average;
}

function money(usd: number): string {
  return usd < 0.01 ? 'under $0.01' : `about $${usd.toFixed(2)}`;
}

/** What a branch cost: every priced message added since it forked (its opening summary included). */
function branchCost(branch: Conversation): number {
  return branch.messages.reduce((sum, m) => sum + (m.costUSD ?? 0), 0);
}

export async function runFork(deps: ForkDeps, specs: readonly ForkBranchSpec[]): Promise<ForkOutcome> {
  if (deps.parent.branch) return { ok: false, reason: 'A branch can’t fork. Answer this part yourself, or say what you found so the conversation it came from can fork.' };
  if (specs.length === 0) return { ok: false, reason: 'A fork needs at least one branch.' };
  if (specs.length > deps.maxBranches) {
    return { ok: false, reason: `A fork may start at most ${deps.maxBranches} branches (Settings → AI); this one asked for ${specs.length}. Fork fewer, or combine some.` };
  }
  const estimateUSD = estimateForkCost(deps.parent, specs.length);
  if (estimateUSD > deps.confirmAboveUsd || deps.confirmAboveUsd === 0) {
    if (!deps.ask) return { ok: false, reason: `This fork is estimated at ${money(estimateUSD)}, over the amount that needs the user's say-so, and there's no one to ask here.` };
    const titles = specs.map((s) => `“${s.title}”`).join(', ');
    const answer = await deps.ask(`Start ${specs.length} branch${specs.length === 1 ? '' : 'es'} (${titles})? Estimated cost ${money(estimateUSD)}.`, [GO, STOP]);
    if (answer !== GO) return { ok: false, reason: 'The user chose not to start these branches.' };
  }
  if (deps.signal.aborted) return { ok: false, reason: 'Stopped before the branches started.' };

  const timer = new AbortController();
  const timeout = setTimeout(() => timer.abort(), deps.timeBudgetMs);
  try {
    const results = await Promise.all(specs.map(async (spec): Promise<ForkBranchResult> => {
      let branch: Conversation;
      try {
        branch = await deps.createBranch(spec);
      } catch (e) {
        return { title: spec.title, conversationId: '', status: 'failed', answer: '', note: messageOf(e), costUSD: 0 };
      }
      const own = new AbortController();
      const stop = (): void => own.abort();
      deps.signal.addEventListener('abort', stop);
      timer.signal.addEventListener('abort', stop);
      let partial = '';
      try {
        const after = await deps.runTurn(branch, own.signal, (t) => { partial += t; });
        const reply = [...after.messages].reverse().find((m) => m.role === 'assistant');
        return { title: spec.title, conversationId: branch.id, status: 'done', answer: reply?.content ?? '', costUSD: branchCost(after) };
      } catch (e) {
        const stopped = own.signal.aborted || isAbort(e);
        return {
          title: spec.title, conversationId: branch.id, status: stopped ? 'stopped' : 'failed', answer: partial,
          note: stopped ? (timer.signal.aborted ? 'ran out of the fork’s time budget' : 'stopped') : messageOf(e),
          costUSD: branchCost(branch),
        };
      } finally {
        deps.signal.removeEventListener('abort', stop);
        timer.signal.removeEventListener('abort', stop);
      }
    }));
    return { ok: true, results, estimateUSD, costUSD: results.reduce((s, r) => s + r.costUSD, 0) };
  } finally {
    clearTimeout(timeout);
  }
}

function isAbort(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || /aborted/i.test(e.message));
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
