import { describe, it, expect } from 'vitest';
import { parseSkill } from '../../src/main/skills/parse';

const VALID = `---
name: Summarize
description: Summarize the active note
menu: Learning
outputMode: openConversation
context: [fullNote]
web: true
model: claude-sonnet-4-6
slashCommand: summarize
firstMessage: "Summarize."
---
You summarize the note.
{{#if note}}
## Note
{{note.content}}
{{/if}}`;

describe('parseSkill — valid', () => {
  // A user skill saved on Windows (#2690): the LF-only frontmatter match used
  // to reject it as "missing YAML frontmatter".
  it('parses a CRLF skill (and one behind a byte-order mark) exactly as its LF twin', () => {
    const lf = parseSkill(VALID, 'user', 'user/summarize.md');
    const crlf = parseSkill(VALID.replace(/\n/g, '\r\n'), 'user', 'user/summarize.md');
    const bom = parseSkill(`\uFEFF${VALID.replace(/\n/g, '\r\n')}`, 'user', 'user/summarize.md');
    expect(crlf.errors).toEqual([]);
    expect(crlf).toEqual(lf);
    expect(bom).toEqual(lf);
  });

  it('parses a complete skill and derives fields', () => {
    const { skill, errors } = parseSkill(VALID, 'stock', 'stock/summarize.md');
    expect(errors).toEqual([]);
    expect(skill).toBeDefined();
    expect(skill!.id).toBe('summarize'); // slug of name
    expect(skill!.menu).toBe('Learning');
    expect(skill!.outputMode).toBe('openConversation');
    expect(skill!.context).toEqual(['fullNote']);
    expect(skill!.web).toBe(true);
    expect(skill!.model).toBe('claude-sonnet-4-6');
    expect(skill!.slashCommand).toBe('/summarize'); // normalized leading slash
    expect(skill!.firstMessage).toBe('Summarize.');
    expect(skill!.body.startsWith('You summarize the note.')).toBe(true);
    expect(skill!.source).toBe('stock');
  });

  it('defaults longDescription to description and web to false', () => {
    const c = `---
name: Taboo
description: Restate without a banned word
menu: Analysis
outputMode: newNote
---
Body here {{selection}}`;
    const { skill } = parseSkill(c, 'user', '/u/taboo.md');
    expect(skill!.longDescription).toBe('Restate without a banned word');
    expect(skill!.web).toBe(false);
    expect(skill!.context).toEqual([]);
  });

  it('reads requiresNote as tri-state (absent → undefined, explicit false preserved)', () => {
    const base = (extra: string) => `---
name: T
description: d
menu: Learning
outputMode: openConversation
context: [fullNote]
${extra}---
body`;
    // Absent: left undefined so the requiresNote derivation (from context) applies.
    expect(parseSkill(base(''), 'stock', 'x.md').skill!.requiresNote).toBeUndefined();
    // Explicit false must survive (the create-learning-journey opt-out).
    expect(parseSkill(base('requiresNote: false\n'), 'stock', 'x.md').skill!.requiresNote).toBe(false);
    expect(parseSkill(base('requiresNote: true\n'), 'stock', 'x.md').skill!.requiresNote).toBe(true);
  });

  it('honors an explicit id', () => {
    const c = `---
id: learning.summarize
name: Summarize
description: d
menu: Learning
outputMode: openConversation
---
body`;
    expect(parseSkill(c, 'stock', 'x.md').skill!.id).toBe('learning.summarize');
  });
});

describe('parseSkill — parameters', () => {
  it('normalizes select options (string and object forms) and default', () => {
    const c = `---
name: ELI
description: d
menu: Learning
outputMode: openConversation
parameters:
  - id: audience
    label: Audience
    type: select
    default: undergrad
    options:
      - { label: "Child", value: "a curious 8-year-old" }
      - undergrad
---
body {{param.audience}}`;
    const { skill, errors } = parseSkill(c, 'stock', 'x.md');
    expect(errors).toEqual([]);
    const p = skill!.parameters[0];
    expect(p.defaultValue).toBe('undergrad');
    expect(p.options).toEqual([
      { label: 'Child', value: 'a curious 8-year-old' },
      { label: 'undergrad', value: 'undergrad' },
    ]);
  });

  it('rejects a select without options', () => {
    const c = `---
name: X
description: d
menu: Learning
outputMode: openConversation
parameters:
  - id: a
    type: select
---
body`;
    const { skill, errors } = parseSkill(c, 'stock', 'x.md');
    expect(skill).toBeUndefined();
    expect(errors.join(' ')).toMatch(/needs a non-empty `options`/);
  });
});

describe('parseSkill — validation failures', () => {
  it('flags missing frontmatter', () => {
    expect(parseSkill('no frontmatter here', 'user', 'x.md').errors[0]).toMatch(/frontmatter/);
  });

  it('collects all missing required fields', () => {
    const { skill, errors } = parseSkill(`---\nfoo: bar\n---\n`, 'user', 'x.md');
    expect(skill).toBeUndefined();
    const joined = errors.join(' ');
    expect(joined).toMatch(/`name` is required/);
    expect(joined).toMatch(/`description` is required/);
    expect(joined).toMatch(/`menu` is required/);
    expect(joined).toMatch(/`outputMode` is required/);
    expect(joined).toMatch(/body .* is empty/);
  });

  it('rejects invalid enum values', () => {
    const c = `---
name: X
description: d
menu: Wisdom
outputMode: telepathy
context: [moonPhase]
---
body`;
    const errors = parseSkill(c, 'user', 'x.md').errors.join(' ');
    expect(errors).toMatch(/`menu` must be one of/);
    expect(errors).toMatch(/`outputMode` is invalid/);
    expect(errors).toMatch(/`context` has invalid value "moonPhase"/);
  });

  it('catches template typos in body and firstMessage', () => {
    const c = `---
name: X
description: d
menu: Learning
outputMode: openConversation
firstMessage: "Go {{param}}"
---
Body {{note.body}} and {{selection | blockqote}}`;
    const errors = parseSkill(c, 'user', 'x.md').errors.join(' ');
    expect(errors).toMatch(/body: unknown variable "note.body"/);
    expect(errors).toMatch(/body: unknown filter "blockqote"/);
    expect(errors).toMatch(/firstMessage: unknown variable "param"/);
  });

  it('catches unbalanced template blocks', () => {
    const c = `---
name: X
description: d
menu: Learning
outputMode: openConversation
---
{{#if note}}unclosed`;
    expect(parseSkill(c, 'user', 'x.md').errors.join(' ')).toMatch(/body:.*unclosed/);
  });
});

describe('parseSkill — fork and join (#2974)', () => {
  const skillWith = (extra: string, outputMode = 'openConversation', firstMessage = 'firstMessage: "Look at this."') => `---
name: Both sides
description: Argue both sides
menu: Analysis
outputMode: ${outputMode}
${firstMessage}
${extra}
---
You weigh arguments.`;

  it('a list of branches, with a join', () => {
    const { skill, errors } = parseSkill(skillWith(`fork:
  - title: For
    instructions: Argue for it.
  - title: Against
    instructions: Argue against it.
join: Weigh them and name the cruxes.`), 'user', 'x.md');
    expect(errors).toEqual([]);
    expect(skill!.fork).toEqual({
      branches: [{ title: 'For', instructions: 'Argue for it.' }, { title: 'Against', instructions: 'Argue against it.' }],
      join: 'Weigh them and name the cruxes.',
    });
  });

  it('one instruction over a list: {{item}} filled in each title and instruction', () => {
    const { skill, errors } = parseSkill(skillWith(`fork:
  each: [cost, risk, time]
  instructions: Look at it only in terms of {{ item }}.
  title: "By {{item}}"`), 'user', 'x.md');
    expect(errors).toEqual([]);
    expect(skill!.fork!.branches).toEqual([
      { title: 'By cost', instructions: 'Look at it only in terms of cost.' },
      { title: 'By risk', instructions: 'Look at it only in terms of risk.' },
      { title: 'By time', instructions: 'Look at it only in terms of time.' },
    ]);
    expect(skill!.fork!.join).toBeUndefined();
    // The title defaults to the item.
    expect(parseSkill(skillWith('fork: { each: [a, b], instructions: "x {{item}}" }'), 'user', 'x.md').skill!.fork!.branches.map((b) => b.title)).toEqual(['a', 'b']);
  });

  it('refuses a malformed fork, a join without one, and a fork that can\'t run', () => {
    const errorsOf = (src: string) => parseSkill(src, 'user', 'x.md').errors.join(' | ');
    expect(errorsOf(skillWith('fork: [{ title: A }]'))).toMatch(/fork\[0\] needs a `title` and `instructions`/);
    expect(errorsOf(skillWith('fork: { each: [a, b] }'))).toMatch(/`fork.instructions` is required/);
    expect(errorsOf(skillWith('fork: { each: [a, ""], instructions: x }'))).toMatch(/`fork.each` must be a list of names/);
    expect(errorsOf(skillWith('fork: "two ways"'))).toMatch(/`fork` must be a list/);
    expect(errorsOf(skillWith('fork: [{ title: A, instructions: x }]'))).toMatch(/needs 2 to 8 branches \(got 1\)/);
    expect(errorsOf(skillWith(`fork: { each: [a, b, c, d, e, f, g, h, i], instructions: "x {{item}}" }`))).toMatch(/got 9/);
    expect(errorsOf(skillWith('join: Weigh them.'))).toMatch(/`join` only applies to a skill with `fork`/);
    const two = 'fork: [{ title: A, instructions: x }, { title: B, instructions: y }]';
    expect(errorsOf(skillWith(two, 'newNote'))).toMatch(/`fork` needs `outputMode: openConversation`/);
    expect(errorsOf(skillWith(two, 'openConversation', ''))).toMatch(/`fork` needs a `firstMessage`/);
    expect(errorsOf(skillWith(`${two}\njoin: "{{#if note}}unclosed"`))).toMatch(/join:.*unclosed/);
  });
});
