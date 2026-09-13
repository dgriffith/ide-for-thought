/**
 * run_skill (#2165) — lets the model run an authored skill's prompt template
 * on its own judgment. Unlike every other conversation tool that reaches the
 * graph/notebase, this one never writes anything itself: it renders the
 * skill's template and hands the text back so the model follows it with its
 * own propose_notes / propose_note_body call, which is what actually goes
 * through the review card. These tests register fixture ThinkingToolDefs
 * directly into the shared registry (the same singleton skills/register.ts
 * populates in the real app) and clean up afterward, per the "process-global
 * Map" caveat documented in shared/tools/registry.ts.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { useTempDir } from '../../../helpers/temp-project';
import { registerTool, unregisterTool } from '../../../../src/shared/tools/registry';
import type { ThinkingToolDef } from '../../../../src/shared/tools/types';
import { runSkill, describeSkillCatalog } from '../../../../src/main/llm/tools/run-skill';

const project = useTempDir('minerva-run-skill-');

const registered: string[] = [];
function register(def: ThinkingToolDef): void {
  registerTool(def);
  registered.push(def.id);
}
afterEach(() => {
  for (const id of registered.splice(0)) unregisterTool(id);
});

const NEW_NOTE_SKILL: ThinkingToolDef = {
  id: 'test.steelman-fixture',
  name: 'Steelman Fixture',
  category: 'analysis',
  description: 'Construct the strongest opposing argument.',
  longDescription: 'Fixture skill mirroring the real steelman skill\'s shape.',
  context: ['selectedText', 'fullNote'],
  outputMode: 'newNote',
  outputNotePrefix: 'steelman',
  buildPrompt: (ctx) => `Steelman this note titled "${ctx.fullNoteTitle}":\n${ctx.fullNoteContent}`,
};

const APPEND_SKILL: ThinkingToolDef = {
  id: 'test.append-fixture',
  name: 'Append Fixture',
  category: 'analysis',
  description: 'Appends findings to the note.',
  longDescription: 'Fixture skill for the appendToNote output mode.',
  context: ['fullNote'],
  outputMode: 'appendToNote',
  buildPrompt: (ctx) => `Findings for ${ctx.fullNotePath}.`,
};

const PARAM_SKILL: ThinkingToolDef = {
  id: 'test.taboo-fixture',
  name: 'Taboo Fixture',
  category: 'analysis',
  description: 'Ban a term and restate without it.',
  longDescription: 'Fixture skill with a required + a defaulted parameter.',
  context: ['fullNote'],
  outputMode: 'newNote',
  parameters: [
    { id: 'term', label: 'Term', type: 'text', required: true },
    { id: 'depth', label: 'Depth', type: 'select', defaultValue: 'standard' },
  ],
  buildPrompt: (ctx) => `term=${ctx.parameterValues?.term ?? ''} depth=${ctx.parameterValues?.depth ?? ''}`,
};

const NO_NOTE_SKILL: ThinkingToolDef = {
  id: 'test.whole-thoughtbase-fixture',
  name: 'Whole Thoughtbase Fixture',
  category: 'analysis',
  description: 'Operates with no note context at all.',
  longDescription: 'Fixture skill with an empty context array.',
  context: [],
  outputMode: 'newNote',
  requiresNote: false,
  buildPrompt: () => 'Whole-thoughtbase analysis.',
};

const OPEN_CONVERSATION_SKILL: ThinkingToolDef = {
  id: 'test.open-conversation-fixture',
  name: 'Open Conversation Fixture',
  category: 'analysis',
  description: 'Should never appear in the run_skill catalog.',
  longDescription: 'Fixture skill using the conversational output mode.',
  context: ['fullNote'],
  outputMode: 'openConversation',
  buildPrompt: () => '',
  buildSystemPrompt: () => 'system prompt',
  buildFirstMessage: () => 'first message',
};

const SELECTION_REQUIRED_SKILL: ThinkingToolDef = {
  id: 'test.selection-required-fixture',
  name: 'Selection Required Fixture',
  category: 'analysis',
  description: 'Should never appear — no live selection mid-conversation.',
  longDescription: 'Fixture skill that requires an editor selection.',
  context: ['selectedText'],
  outputMode: 'newNote',
  requiresSelection: true,
  buildPrompt: (ctx) => ctx.selectedText ?? '',
};

const SOURCE_SCOPED_SKILL: ThinkingToolDef = {
  id: 'test.source-scoped-fixture',
  name: 'Source Scoped Fixture',
  category: 'research',
  description: 'Should never appear — source context not wired up yet.',
  longDescription: 'Fixture skill scoped to the Source viewer.',
  scope: 'source',
  context: ['sourceMetadata', 'sourceBody'],
  outputMode: 'newNote',
  buildPrompt: () => '',
};

const NOTE_PARAM_SKILL: ThinkingToolDef = {
  id: 'test.note-param-fixture',
  name: 'Note Param Fixture',
  category: 'analysis',
  description: 'Should never appear — note-type params need a picker.',
  longDescription: 'Fixture skill with a note-type parameter.',
  context: ['fullNote'],
  outputMode: 'newNote',
  parameters: [{ id: 'opponent', label: 'Opponent note', type: 'note' }],
  buildPrompt: () => '',
};

async function writeNote(root: string, relativePath: string, content: string): Promise<void> {
  const abs = path.join(root, relativePath);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content, 'utf-8');
}

describe('run_skill catalog (describeSkillCatalog)', () => {
  it('lists a runnable skill with its params and note/output hints', () => {
    register(PARAM_SKILL);
    const text = describeSkillCatalog();
    expect(text).toContain('test.taboo-fixture (Taboo Fixture): Ban a term and restate without it. [needs notePath] [produces a new note] (params: term*, depth)');
  });

  it('marks an appendToNote skill accordingly', () => {
    register(APPEND_SKILL);
    expect(describeSkillCatalog()).toContain('[appends to notePath]');
  });

  it('omits a skill needing no note from the [needs notePath] hint', () => {
    register(NO_NOTE_SKILL);
    const text = describeSkillCatalog();
    expect(text).toContain('test.whole-thoughtbase-fixture');
    expect(text).not.toMatch(/whole-thoughtbase-fixture.*needs notePath/);
  });

  it('excludes openConversation, requiresSelection, source-scoped, and note-param skills', () => {
    register(OPEN_CONVERSATION_SKILL);
    register(SELECTION_REQUIRED_SKILL);
    register(SOURCE_SCOPED_SKILL);
    register(NOTE_PARAM_SKILL);
    const text = describeSkillCatalog();
    expect(text).not.toContain('open-conversation-fixture');
    expect(text).not.toContain('selection-required-fixture');
    expect(text).not.toContain('source-scoped-fixture');
    expect(text).not.toContain('note-param-fixture');
  });

  it('returns empty string when no skill is runnable', () => {
    register(OPEN_CONVERSATION_SKILL);
    expect(describeSkillCatalog()).toBe('');
  });
});

describe('run_skill run()', () => {
  it('requires a non-empty skillId', async () => {
    const res = await runSkill.run({ rootPath: project.root }, {}, {});
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/skillId/);
  });

  it('errors on an unknown skill', async () => {
    const res = await runSkill.run({ rootPath: project.root }, { skillId: 'no.such.skill' }, {});
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/Unknown or unsupported skill/);
  });

  it('errors on a registered but unrunnable skill (e.g. openConversation)', async () => {
    register(OPEN_CONVERSATION_SKILL);
    const res = await runSkill.run({ rootPath: project.root }, { skillId: OPEN_CONVERSATION_SKILL.id }, {});
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/Unknown or unsupported skill/);
  });

  it('requires notePath when the skill needs a note', async () => {
    register(NEW_NOTE_SKILL);
    const res = await runSkill.run({ rootPath: project.root }, { skillId: NEW_NOTE_SKILL.id }, {});
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/needs a note/);
  });

  it('errors when notePath does not exist', async () => {
    register(NEW_NOTE_SKILL);
    const res = await runSkill.run(
      { rootPath: project.root },
      { skillId: NEW_NOTE_SKILL.id, notePath: 'notes/missing.md' },
      {},
    );
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/No such note/);
  });

  it('renders the skill prompt with the note content and returns it as text, not a filed result', async () => {
    register(NEW_NOTE_SKILL);
    await writeNote(project.root, 'notes/thesis.md', 'Central claim goes here.');
    const res = await runSkill.run(
      { rootPath: project.root },
      { skillId: NEW_NOTE_SKILL.id, notePath: 'notes/thesis.md' },
      {},
    );
    expect(res.isError).toBe(false);
    expect(res.content).toContain('Steelman this note titled "thesis"');
    expect(res.content).toContain('Central claim goes here.');
    expect(res.content).toContain('propose_notes');
    expect(res.content).toMatch(/nothing has been (generated or filed|written)/i);
  });

  it('tells the model to use propose_note_body for an appendToNote skill', async () => {
    register(APPEND_SKILL);
    await writeNote(project.root, 'notes/log.md', 'Existing log content.');
    const res = await runSkill.run(
      { rootPath: project.root },
      { skillId: APPEND_SKILL.id, notePath: 'notes/log.md' },
      {},
    );
    expect(res.isError).toBe(false);
    expect(res.content).toContain('propose_note_body');
    expect(res.content).toContain('notes/log.md');
  });

  it('runs a skill with no note requirement without a notePath', async () => {
    register(NO_NOTE_SKILL);
    const res = await runSkill.run({ rootPath: project.root }, { skillId: NO_NOTE_SKILL.id }, {});
    expect(res.isError).toBe(false);
    expect(res.content).toContain('Whole-thoughtbase analysis.');
  });

  it('fills an omitted parameter with its authored default', async () => {
    register(PARAM_SKILL);
    await writeNote(project.root, 'notes/x.md', 'x');
    const res = await runSkill.run(
      { rootPath: project.root },
      { skillId: PARAM_SKILL.id, notePath: 'notes/x.md', parameterValues: { term: 'consciousness' } },
      {},
    );
    expect(res.isError).toBe(false);
    expect(res.content).toContain('term=consciousness depth=standard');
  });

  it('lets an explicit parameter value override the default', async () => {
    register(PARAM_SKILL);
    await writeNote(project.root, 'notes/x.md', 'x');
    const res = await runSkill.run(
      { rootPath: project.root },
      { skillId: PARAM_SKILL.id, notePath: 'notes/x.md', parameterValues: { term: 'fair', depth: 'deep' } },
      {},
    );
    expect(res.content).toContain('term=fair depth=deep');
  });

  it('is registered in the default conversation toolset', async () => {
    const { NOTEBASE_TOOLS } = await import('../../../../src/main/llm/tools');
    expect(NOTEBASE_TOOLS.map((t) => t.name)).toContain('run_skill');
  });
});
