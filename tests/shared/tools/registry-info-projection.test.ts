/**
 * `toInfo` really strips the builders, and the registry's types tell the truth
 * about which process holds what (#2235, epic #2241).
 *
 * `ThinkingToolInfo` has always been documented as "the serializable subset …
 * (no functions)", and its type correctly omitted all three builders. The
 * projection producing it stripped exactly one:
 *
 *     const { buildPrompt: _, ...info } = tool;
 *
 * That was right when `buildPrompt` was the only builder, and wrong from the
 * moment `skills/compile.ts` started attaching `buildSystemPrompt` /
 * `buildFirstMessage` to every `openConversation` skill — the rest spread them
 * straight through. So `getAllToolInfos()` and `getSlashCommands()` returned
 * objects that claimed to be function-free and were not, on conversational
 * skills specifically.
 *
 * Nothing had sent one over IPC yet, which is why nobody had seen it. The first
 * handler to try would have got a `DataCloneError` on conversational skills
 * only, against a signature promising a clean payload — the sort of bug whose
 * type annotation actively argues against the diagnosis.
 *
 * `structuredClone` is the assertion that matters here rather than a
 * `typeof === 'function'` sweep: it is the same algorithm the IPC bridge runs,
 * so a payload that survives it is one the bridge can carry, whatever the
 * shape of the leak.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  registerTool,
  unregisterTool,
  getAllToolInfos,
  getToolInfosByCategory,
  getSlashCommands,
  getTool,
  getToolDef,
} from '../../../src/shared/tools/registry';
import type { ThinkingToolDef, ThinkingToolMeta } from '../../../src/shared/tools/types';

const ONE_SHOT_ID = 'analysis.one-shot-probe';
const CONVERSATIONAL_ID = 'research.conversational-probe';

/** A one-shot skill: `buildPrompt` only, which the old strip did remove. */
function oneShot(): ThinkingToolDef {
  return {
    id: ONE_SHOT_ID,
    name: 'One Shot Probe',
    category: 'analysis',
    description: 'd',
    longDescription: 'ld',
    context: [],
    outputMode: 'newNote',
    slashCommand: '/one-shot-probe',
    buildPrompt: () => 'body',
  };
}

/** A conversational skill: what `skills/compile.ts` produces for
 *  `outputMode: 'openConversation'`, and what the old strip let through. */
function conversational(): ThinkingToolDef {
  return {
    id: CONVERSATIONAL_ID,
    name: 'Conversational Probe',
    category: 'research',
    description: 'd',
    longDescription: 'ld',
    context: [],
    outputMode: 'openConversation',
    slashCommand: '/conversational-probe',
    buildPrompt: () => '',
    buildSystemPrompt: () => 'system',
    buildFirstMessage: () => 'first',
    requiresTools: ['ask_user'],
  };
}

// The registry Map is process-global (see its own header), so register into a
// known state and clean up rather than assuming the suite owns it.
beforeEach(() => {
  registerTool(oneShot());
  registerTool(conversational());
});
afterEach(() => {
  unregisterTool(ONE_SHOT_ID);
  unregisterTool(CONVERSATIONAL_ID);
});

const probes = (infos: ThinkingToolMeta[]) =>
  infos.filter((i) => i.id === ONE_SHOT_ID || i.id === CONVERSATIONAL_ID);

describe('toInfo strips every builder, not just buildPrompt (#2235)', () => {
  it('getAllToolInfos output survives structuredClone — the IPC bridge\'s own algorithm', () => {
    for (const info of probes(getAllToolInfos())) {
      expect(() => structuredClone(info), `${info.id} is not cloneable`).not.toThrow();
    }
  });

  it('getSlashCommands output survives it too', () => {
    // The second projection through the same helper. Worth its own case
    // because it was a separate call site of the same broken strip.
    for (const info of probes(getSlashCommands())) {
      expect(() => structuredClone(info), `${info.id} is not cloneable`).not.toThrow();
    }
  });

  it('getToolInfosByCategory output survives it too', () => {
    for (const info of probes(getToolInfosByCategory('research'))) {
      expect(() => structuredClone(info)).not.toThrow();
    }
  });

  it('names the specific builders that used to leak', () => {
    // structuredClone above proves the payload is carryable; this says which
    // fields were the problem, so a regression reads as "buildSystemPrompt came
    // back" rather than an opaque DataCloneError.
    const info = getAllToolInfos().find((i) => i.id === CONVERSATIONAL_ID) as Record<string, unknown>;
    expect(info.buildPrompt).toBeUndefined();
    expect(info.buildSystemPrompt).toBeUndefined();
    expect(info.buildFirstMessage).toBeUndefined();
  });

  it('keeps the metadata the renderer actually consumes', () => {
    // A strip that threw away too much would also pass the clone check.
    const info = getAllToolInfos().find((i) => i.id === CONVERSATIONAL_ID)!;
    expect(info).toMatchObject({
      id: CONVERSATIONAL_ID,
      name: 'Conversational Probe',
      category: 'research',
      outputMode: 'openConversation',
      slashCommand: '/conversational-probe',
    });
  });
});

describe('getTool vs getToolDef (#2235)', () => {
  it('getToolDef hands back the runnable definition when the builders are there', () => {
    const def = getToolDef(CONVERSATIONAL_ID);
    expect(def?.buildSystemPrompt?.({})).toBe('system');
  });

  it('getToolDef returns undefined for a metadata-only registration', () => {
    // Exactly the renderer's situation: `skillInfoToToolMeta` produces this.
    // Before the split the renderer supplied `buildPrompt: () => ''` to satisfy
    // the type, so this case could not arise — and a caller got an empty prompt
    // instead of an answer it could check.
    const metaOnly: ThinkingToolMeta = {
      id: 'analysis.meta-only-probe',
      name: 'Meta Only',
      category: 'analysis',
      description: 'd',
      longDescription: 'ld',
      context: [],
      outputMode: 'newNote',
    };
    registerTool(metaOnly);
    try {
      expect(getTool('analysis.meta-only-probe')).toBeDefined();
      expect(getToolDef('analysis.meta-only-probe')).toBeUndefined();
    } finally {
      unregisterTool('analysis.meta-only-probe');
    }
  });

  it('both answer undefined for an unregistered id', () => {
    expect(getTool('nope.not-a-tool')).toBeUndefined();
    expect(getToolDef('nope.not-a-tool')).toBeUndefined();
  });
});
