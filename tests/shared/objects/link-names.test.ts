/**
 * *Link attendees* (#2612) — the pure planner behind the Properties panel's
 * action: which names match a note of the target type, what each becomes,
 * and that the rewrite keeps everything else about the note.
 */
import { describe, it, expect } from 'vitest';
import {
  buildNameMatcher,
  describeLinkPlan,
  planLinkNames,
  type LinkCandidate,
} from '../../../src/shared/objects/link-names';

const PEOPLE: LinkCandidate[] = [
  { path: 'people/Alice.md', title: 'Alice' },
  { path: 'people/bob-jones.md', title: 'Bob Jones' },
  { path: 'people/p-007.md', title: 'Dana Scully' },
  { path: 'people/Erin.md', title: 'Erin' },
];
const FILES = [
  ...PEOPLE.map((p) => ({ relativePath: p.path, isDirectory: false })),
  { relativePath: 'projects/Carol.md', isDirectory: false }, // a note, but not a Person
  { relativePath: 'projects/multi-frank.md', isDirectory: false },
  { relativePath: 'people', isDirectory: true },
];
const ALIASES = { 'erin m.': 'people/Erin.md', 'carl': 'projects/Carol.md' };

const match = buildNameMatcher(PEOPLE, FILES, ALIASES);

function meeting(attendees: string, eol = '\n'): string {
  return ['---', 'title: Standup', 'type: meeting', attendees, '---', '', '## Agenda', ''].join(eol);
}

describe('buildNameMatcher', () => {
  it('matches a filename as written', () => {
    expect(match('Alice')).toBe('[[Alice]]');
  });
  it("matches by the filename's slug, keeping the name's wording", () => {
    expect(match('Bob Jones')).toBe('[[Bob Jones]]');
  });
  it('matches a frontmatter alias (case-insensitively)', () => {
    expect(match('Erin M.')).toBe('[[Erin M.]]');
  });
  it('matches a title the filename does not carry, linking with the name as display text', () => {
    expect(match('dana scully')).toBe('[[p-007|dana scully]]');
  });
  it('leaves a name that names a note of another type', () => {
    expect(match('Carol')).toBeNull();
    expect(match('Carl')).toBeNull(); // an alias of that other note
  });
  it('leaves a name that matches nothing, and one that only matches by path coincidence', () => {
    expect(match('Zed')).toBeNull();
    expect(match('frank')).toBeNull(); // multi-frank.md, by path-suffix slug only
  });
  it('leaves a name it could not write inside [[…]]', () => {
    expect(match('Alice|x')).toBeNull();
    expect(match('Alice#1')).toBeNull();
  });
  it('leaves an ambiguous title', () => {
    const m = buildNameMatcher([...PEOPLE, { path: 'people/p-008.md', title: 'Dana Scully' }], FILES, ALIASES);
    expect(m('Dana Scully')).toBeNull();
  });
});

describe('planLinkNames', () => {
  it('splits a comma-separated string into a list of links and names', () => {
    const plan = planLinkNames(meeting('attendees: Alice, Zed, Bob Jones'), 'attendees', match)!;
    expect(plan.linked).toEqual([
      { name: 'Alice', link: '[[Alice]]' },
      { name: 'Bob Jones', link: '[[Bob Jones]]' },
    ]);
    expect(plan.unmatched).toEqual(['Zed']);
    expect(plan.content).toBe(meeting('attendees:\n  - "[[Alice]]"\n  - Zed\n  - "[[Bob Jones]]"'));
  });

  it('links a single matching name in place', () => {
    const plan = planLinkNames(meeting('attendees: Alice'), 'attendees', match)!;
    expect(plan.content).toBe(meeting('attendees: "[[Alice]]"'));
    expect(plan.unmatched).toEqual([]);
  });

  it('rewrites a YAML list item by item, keeping its style', () => {
    const block = planLinkNames(meeting('attendees:\n  - Alice\n  - Zed'), 'attendees', match)!;
    expect(block.content).toBe(meeting('attendees:\n  - "[[Alice]]"\n  - Zed'));
    const flow = planLinkNames(meeting('attendees: [Alice, Zed]'), 'attendees', match)!;
    expect(flow.content).toBe(meeting('attendees: [ "[[Alice]]", Zed ]'));
  });

  it('leaves an already-linked value alone, and links the names beside it', () => {
    expect(planLinkNames(meeting('attendees: "[[Zed]]"'), 'attendees', match)).toBeNull();
    const plan = planLinkNames(meeting('attendees:\n  - "[[Zed]]"\n  - Alice'), 'attendees', match)!;
    expect(plan.content).toBe(meeting('attendees:\n  - "[[Zed]]"\n  - "[[Alice]]"'));
    expect(plan.linked.map((l) => l.name)).toEqual(['Alice']);
    expect(plan.unmatched).toEqual([]);
  });

  it('does not split a string that already holds a link', () => {
    expect(planLinkNames(meeting('attendees: "[[Smith, Jo]], Alice"'), 'attendees', match)).toBeNull();
  });

  it('returns null when nothing matches, the key is absent, or the frontmatter is unparseable', () => {
    expect(planLinkNames(meeting('attendees: Zed, Yan'), 'attendees', match)).toBeNull();
    expect(planLinkNames(meeting('organizer: Alice'), 'attendees', match)).toBeNull();
    expect(planLinkNames('---\nattendees: [Alice\n---\n', 'attendees', match)).toBeNull();
    expect(planLinkNames('No frontmatter', 'attendees', match)).toBeNull();
  });

  it('keeps a CRLF note CRLF, with its byte-order mark', () => {
    const crlf = '﻿' + meeting('attendees: Alice, Zed', '\r\n');
    const plan = planLinkNames(crlf, 'attendees', match)!;
    expect(plan.content.startsWith('﻿---\r\n')).toBe(true);
    expect(plan.content).toBe('﻿' + meeting('attendees:\n  - "[[Alice]]"\n  - Zed', '\n').replace(/\n/g, '\r\n'));
    expect(plan.content.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('keeps comments and the other keys', () => {
    const content = ['---', '# the weekly one', 'title: Standup', 'attendees: Alice # from the invite', 'date: 2026-10-01', '---', 'Body', ''].join('\n');
    const plan = planLinkNames(content, 'attendees', match)!;
    expect(plan.content).toContain('# the weekly one');
    expect(plan.content).toContain('date: 2026-10-01');
    expect(plan.content).toContain('attendees: "[[Alice]]"');
    expect(plan.content.endsWith('---\nBody\n')).toBe(true);
  });
});

describe('describeLinkPlan', () => {
  it('names what is linked and what stays text', () => {
    expect(describeLinkPlan({ linked: [{ name: 'Alice', link: '' }, { name: 'Bob', link: '' }], unmatched: ['Zed'] }, 'Person'))
      .toBe('Link Alice and Bob to their Person notes? Zed stays as text.');
    expect(describeLinkPlan({ linked: [{ name: 'Alice', link: '' }], unmatched: [] }, 'Person'))
      .toBe('Link Alice to its Person note?');
    expect(describeLinkPlan({ linked: [{ name: 'A', link: '' }, { name: 'B', link: '' }, { name: 'C', link: '' }], unmatched: ['Y', 'Z'] }, 'Person'))
      .toBe('Link A, B and C to their Person notes? Y and Z stay as text.');
  });
});
