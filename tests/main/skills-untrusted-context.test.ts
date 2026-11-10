/**
 * No thoughtbase text in a stock skill's system prompt (#2438).
 *
 * Every stock skill is rendered against contexts whose every thoughtbase-
 * derived field — note content/title/path, selection, claim, source, and a
 * `note`-type parameter's path/title/content — is a distinct canary. Then:
 *
 *   - no canary appears in the instruction channel (the system prompt, the
 *     one-shot instructions) or in the visible first message;
 *   - every canary that reaches the user-turn context sits inside a
 *     `<thoughtbase-content>` delimiter;
 *   - nothing was auto-routed: stock skills place their material in
 *     `{{#context}}` blocks explicitly, so the rendered prompt reads cleanly.
 *
 * Several contexts rather than one, because `{{#if selection}}…{{else}}…`
 * branches mean a single all-fields context would leave half of each skill
 * unrendered.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import path from 'node:path';
import { loadSkillCatalog } from '../../src/main/skills/loader';
import { compileSkill } from '../../src/main/skills/compile';
import { parseSkill } from '../../src/main/skills/parse';
import { renderTemplateDiagnostic, toRenderContext } from '../../src/main/skills/template';
import type { SkillDef } from '../../src/shared/skills/types';
import type { ToolContext } from '../../src/shared/tools/types';
import { UNTRUSTED_TAG } from '../../src/shared/untrusted-content';

const C = {
  noteContent: 'CANARY-NOTE-CONTENT',
  noteTitle: 'CANARY-NOTE-TITLE',
  notePath: 'notes/CANARY-NOTE-PATH.md',
  selection: 'CANARY-SELECTION',
  claimUri: 'https://x.test/c/claim-CANARY-CLAIM-URI',
  claimLabel: 'CANARY-CLAIM-LABEL',
  claimSource: 'CANARY-CLAIM-SOURCE',
  sourceId: 'CANARY-SOURCE-ID',
  sourceTitle: 'CANARY-SOURCE-TITLE',
  sourceBody: 'CANARY-SOURCE-BODY',
  paramPath: 'notes/CANARY-PARAM-PATH.md',
  paramTitle: 'CANARY-PARAM-TITLE',
  paramContent: 'CANARY-PARAM-CONTENT',
};
const CANARY = /CANARY-[A-Z-]+/g;

function paramValues(skill: SkillDef): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of skill.parameters) {
    if (p.type === 'note') {
      out[p.id] = C.paramPath;
      out[`${p.id}.title`] = C.paramTitle;
      out[`${p.id}.content`] = C.paramContent;
    } else {
      out[p.id] = p.defaultValue ?? 'user-typed value';
    }
  }
  return out;
}

const note = { fullNoteContent: C.noteContent, fullNoteTitle: C.noteTitle, fullNotePath: C.notePath };
const claim = { claimUri: C.claimUri, claimLabel: C.claimLabel, claimSourceText: C.claimSource };
const source = { sourceId: C.sourceId, sourceTitle: C.sourceTitle, sourceBody: C.sourceBody };

/** Each shape a skill can be invoked in; together they take every branch. */
const CONTEXTS: Record<string, ToolContext> = {
  everything: { ...note, selectedText: C.selection, ...claim, ...source },
  noteOnly: { ...note },
  selectionOnly: { selectedText: C.selection },
  sourceOnly: { ...source },
  claimOnly: { ...claim, ...note },
  empty: {},
};

/** The canaries left after removing every delimited span. */
function undelimitedCanaries(text: string): string[] {
  const stripped = text.replace(
    new RegExp(`<${UNTRUSTED_TAG}\\b[^>]*>[\\s\\S]*?</${UNTRUSTED_TAG}>`, 'g'),
    '',
  );
  return stripped.match(CANARY) ?? [];
}

let skills: SkillDef[];

beforeAll(async () => {
  const cat = await loadSkillCatalog(path.join(__dirname, '__no_user_skills__'));
  expect(cat.errors).toEqual([]);
  skills = cat.skills.filter((s) => s.source === 'stock');
});

describe('stock skills keep thoughtbase text out of the system prompt (#2438)', () => {
  it('loads the stock catalog', () => {
    expect(skills.length).toBeGreaterThan(50);
  });

  it('no stock skill auto-routes an untrusted variable (every one is in a {{#context}} block)', () => {
    const offenders: string[] = [];
    for (const skill of skills) {
      const noteParams = skill.parameters.filter((p) => p.type === 'note').map((p) => p.id);
      for (const [name, tc] of Object.entries(CONTEXTS)) {
        const ctx = toRenderContext({ ...tc, parameterValues: paramValues(skill) }, noteParams);
        const forkTemplates = [
          ...(skill.fork?.branches.map((b, i) => [`fork[${i}]`, b.instructions] as const) ?? []),
          ...(skill.fork?.join ? [['join', skill.fork.join] as const] : []),
        ];
        for (const [field, tpl] of [['body', skill.body], ['firstMessage', skill.firstMessage], ...forkTemplates] as const) {
          if (!tpl) continue;
          for (const v of renderTemplateDiagnostic(tpl, ctx).autoRouted) {
            offenders.push(`${skill.id} ${field} [${name}]: {{${v}}}`);
          }
        }
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });

  it('no canary reaches the system prompt, the one-shot instructions or the visible first message', () => {
    const leaks: string[] = [];
    for (const skill of skills) {
      const def = compileSkill(skill);
      for (const [name, tc] of Object.entries(CONTEXTS)) {
        const ctx = { ...tc, parameterValues: paramValues(skill) };
        const fork = def.buildFork?.(ctx);
        const channels: Array<[string, string]> = def.buildSystemPrompt
          ? [
            ['system', def.buildSystemPrompt(ctx)], ['firstMessage', def.buildFirstMessage?.(ctx) ?? ''],
            // A forking skill's branch instructions and join are sent as user turns of their own (#2974).
            ...(fork?.branches.map((b, i): [string, string] => [`fork[${i}]`, b.instructions ?? '']) ?? []),
            ...(fork?.join ? [['join', fork.join] as [string, string]] : []),
          ]
          : [['instructions', def.buildPrompt(ctx)]];
        for (const [channel, text] of channels) {
          for (const hit of text.match(CANARY) ?? []) leaks.push(`${skill.id} ${channel} [${name}]: ${hit}`);
        }
      }
    }
    expect([...new Set(leaks)]).toEqual([]);
  });

  it('every canary in the user-turn context is inside a delimiter', () => {
    const bare: string[] = [];
    let delimited = 0;
    for (const skill of skills) {
      const def = compileSkill(skill);
      for (const [name, tc] of Object.entries(CONTEXTS)) {
        const text = def.buildUserContext?.({ ...tc, parameterValues: paramValues(skill) }) ?? '';
        delimited += (text.match(CANARY) ?? []).length;
        for (const hit of undelimitedCanaries(text)) bare.push(`${skill.id} [${name}]: ${hit}`);
      }
    }
    expect([...new Set(bare)]).toEqual([]);
    // ...and the material did arrive somewhere: the check above is not vacuous.
    expect(delimited).toBeGreaterThan(100);
  });

  it('a skill that reads the note hands its content to the user turn', () => {
    const summarize = compileSkill(skills.find((s) => s.id === 'learning.summarize')!);
    const ctx = { ...note };
    expect(summarize.buildSystemPrompt!(ctx)).not.toContain(C.noteContent);
    expect(summarize.buildUserContext!(ctx)).toContain(
      `<${UNTRUSTED_TAG} kind="note" path="${C.notePath}">\n${C.noteContent}\n</${UNTRUSTED_TAG}>`,
    );
  });
});

describe('a forking skill\'s branch instructions and join route thoughtbase text the same way (#2974)', () => {
  const RAW = [
    '---',
    'name: Both sides',
    'description: Argue both sides of the note.',
    'menu: Analysis',
    'outputMode: openConversation',
    'context: [fullNote]',
    'firstMessage: Look at this note.',
    'fork:',
    '  - title: For',
    '    instructions: "Argue for what {{note.title}} claims: {{note.content}}"',
    '  - title: Against',
    '    instructions: Argue against it.',
    'join: "Weigh both sides of {{note.content}}"',
    '---',
    'You weigh arguments.',
  ].join('\n');

  it('keeps the note out of every branch\'s instructions and the join, and hands it to the first user turn, delimited', () => {
    const parsed = parseSkill(RAW, 'user', '/x/both-sides.md');
    expect(parsed.errors).toEqual([]);
    const def = compileSkill(parsed.skill!);
    const fork = def.buildFork!({ ...note });
    expect(fork.branches.map((b) => b.title)).toEqual(['For', 'Against']);
    for (const text of [...fork.branches.map((b) => b.instructions!), fork.join!]) {
      expect(text).not.toMatch(CANARY);
    }
    const userContext = def.buildUserContext!({ ...note });
    expect(userContext).toContain(C.noteContent);
    expect(undelimitedCanaries(userContext)).toEqual([]);
  });
});
