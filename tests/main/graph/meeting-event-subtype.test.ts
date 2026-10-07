/**
 * Meeting is an Event subtype (#2612, epic #2606).
 *
 * Stock `meeting.md` sets `parent: event`, so it inherits Event's `date`,
 * `end`, `location` (→ Place) and `attendees` (→ Person), keeps its own
 * `organizer` (→ Person) and its Agenda / Notes / Decisions body. In the graph
 * that's `types:Meeting rdfs:subClassOf types:Event`, so anything asking for
 * Events — the Event type view, and the timeline built on it — gets meetings.
 *
 * Reach: an unmodified thoughtbase gets this on upgrade (stock loads from the
 * bundle); one that overrides `meeting.md` keeps its own definition.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  indexAllNotes,
  queryGraph,
  getNoteTypedProperties,
  getTypeInstances,
  reloadTypeCatalog,
} from '../../../src/main/graph/index';
import { loadTypeCatalog } from '../../../src/main/types/loader';
import { effectivePropertyDefs, effectiveTemplate } from '../../../src/shared/objects/inheritance';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

const project = useGraphProject('minerva-meeting-event-');
let root: string;
let ctx: ProjectContext;

function write(rel: string, content: string): void {
  const fp = path.join(root, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf-8');
}

beforeEach(() => {
  root = project.root;
  ctx = project.ctx;
});

async function rows(sparql: string): Promise<Record<string, string>[]> {
  const r = await queryGraph(ctx, sparql);
  expect(r.error, r.error ?? '').toBeUndefined();
  return r.results as Record<string, string>[];
}

/** The meeting as Minerva wrote it before #2612: text attendees, its own date. */
const OLD_MEETING_TYPE = [
  '---', 'label: Meeting', 'icon: 🗓️',
  'properties:',
  '  - name: date', '    type: date',
  '  - name: organizer', '    type: link-to-type', '    targetType: person',
  '  - name: attendees', '    type: text',
  '---', '', '## Agenda', '',
].join('\n');

describe('the stock Meeting type (#2612)', () => {
  it('has Event as its parent and only organizer as its own property', async () => {
    const cat = await loadTypeCatalog(root);
    const meeting = cat.types.find((t) => t.id === 'meeting')!;
    expect(meeting.source).toBe('stock');
    expect(meeting.parent).toBe('event');
    expect(meeting.properties.map((p) => p.name)).toEqual(['organizer']);
    expect(cat.errors.filter((e) => e.source === 'stock')).toEqual([]);
  });

  it("inherits Event's date, end, location and link-to-Person attendees, then its organizer", async () => {
    const cat = await loadTypeCatalog(root);
    const byId = new Map(cat.types.map((t) => [t.id, t]));
    const eff = effectivePropertyDefs('meeting', byId);
    expect(eff.map((p) => p.name)).toEqual(['date', 'end', 'location', 'attendees', 'organizer']);
    // Event's date and end are datetime since #2613, so Meeting's are too.
    expect(eff.find((p) => p.name === 'date')).toMatchObject({ type: 'datetime' });
    expect(eff.find((p) => p.name === 'end')).toMatchObject({ type: 'datetime' });
    expect(eff.find((p) => p.name === 'location')).toMatchObject({ type: 'link-to-type', targetType: 'place' });
    expect(eff.find((p) => p.name === 'attendees')).toMatchObject({ type: 'link-to-type', targetType: 'person' });
    expect(eff.find((p) => p.name === 'organizer')).toMatchObject({ type: 'link-to-type', targetType: 'person' });
  });

  it('keeps its own Agenda / Notes / Decisions body rather than inheriting Event’s', async () => {
    const cat = await loadTypeCatalog(root);
    const byId = new Map(cat.types.map((t) => [t.id, t]));
    const body = effectiveTemplate('meeting', byId)!;
    expect(body.fromTypeId).toBe('meeting');
    expect(body.template).toMatch(/## Agenda[\s\S]*## Notes[\s\S]*## Decisions/);
  });
});

describe('Meeting in the graph (#2612)', () => {
  it('materialises types:Meeting rdfs:subClassOf types:Event', async () => {
    await indexAllNotes(ctx);
    const found = await rows(`SELECT ?p WHERE { types:Meeting rdfs:subClassOf ?p }`);
    expect(found.map((r) => r.p)).toContain('https://minerva.dev/ontology/types#Event');
  });

  it('a meeting note is an Event by the subclass path, beside the events', async () => {
    write('Launch.md', `---\ntitle: Launch\ntype: event\ndate: 2026-06-01\n---\n`);
    write('Standup.md', `---\ntitle: Standup\ntype: meeting\ndate: 2026-06-02\nattendees: Alice, Bob\n---\n`);
    write('Dune.md', `---\ntitle: Dune\ntype: book\n---\n`);
    await indexAllNotes(ctx);

    const events = await rows(`
      SELECT ?title WHERE { ?e rdf:type/rdfs:subClassOf* types:Event ; dc:title ?title } ORDER BY ?title
    `);
    expect(events.map((r) => r.title)).toEqual(['Launch', 'Standup']);
  });

  it('the Event type view lists meetings among its instances, with their inherited values', async () => {
    write('Place/Office.md', `---\ntitle: Office\ntype: place\n---\n`);
    write('Launch.md', `---\ntitle: Launch\ntype: event\ndate: 2026-06-01\n---\n`);
    write('Standup.md', [
      '---', 'title: Standup', 'type: meeting', 'date: 2026-06-02', 'end: 2026-06-02',
      'location: "[[Office]]"', 'attendees: Alice, Bob', '---', '',
    ].join('\n'));
    await indexAllNotes(ctx);

    const view = await getTypeInstances(ctx, 'event');
    expect(view.instances.map((i) => i.title)).toEqual(['Launch', 'Standup']);
    const standup = view.instances.find((i) => i.title === 'Standup')!;
    expect(standup.values.date).toBe('2026-06-02');
    expect(standup.values.end).toBe('2026-06-02');
    expect(standup.values.location).toMatch(/\/note\/Place\/Office$/);
    expect(standup.values.attendees).toBe('Alice, Bob'); // text, not a broken link
  });

  it("a meeting's inherited date is a typed xsd:date, as on an Event", async () => {
    write('Standup.md', `---\ntitle: Standup\ntype: meeting\ndate: 2026-06\n---\n`);
    await indexAllNotes(ctx);
    const found = await rows(`SELECT (DATATYPE(?d) AS ?dt) WHERE { ?m dc:title "Standup" ; ?p ?d . FILTER(isLiteral(?d) && STR(?d) = "2026-06") }`);
    expect(found.map((r) => r.dt)).toContain('http://www.w3.org/2001/XMLSchema#gYearMonth');
  });

  it("a meeting's inherited date and end take a time, typed xsd:dateTime (#2613)", async () => {
    write('Standup.md', `---\ntitle: Standup\ntype: meeting\ndate: 2026-06-02T09:30\nend: 2026-06-02T09:45+02:00\n---\n`);
    await indexAllNotes(ctx);
    const found = await rows(`SELECT ?d WHERE { ?m dc:title "Standup" ; ?p ?d . FILTER(isLiteral(?d) && DATATYPE(?d) = xsd:dateTime) }`);
    const lexicals = found.map((r) => r.d); // also holds the note's own file-modified time
    expect(lexicals).toContain('2026-06-02T09:30:00');
    expect(lexicals).toContain('2026-06-02T09:45:00+02:00');
  });

  it("an organizer link still resolves to the Person, under its role predicate", async () => {
    write('Alice.md', `---\ntitle: Alice\ntype: person\n---\n`);
    write('Standup.md', `---\ntitle: Standup\ntype: meeting\norganizer: "[[Alice]]"\n---\n`);
    await indexAllNotes(ctx);
    const found = await rows(`SELECT ?name WHERE { ?m dc:title "Standup" ; types:organizer ?p . ?p a types:Person ; dc:title ?name }`);
    expect(found.map((r) => r.name)).toEqual(['Alice']);
    const props = await getNoteTypedProperties(ctx, 'Standup.md');
    expect(props.type).toMatchObject({ id: 'meeting', parent: 'event' });
    expect(props.properties.map((p) => p.name)).toEqual(['date', 'end', 'location', 'attendees', 'organizer']);
  });
});

describe('a thoughtbase that overrides meeting.md keeps its own Meeting (#2612)', () => {
  beforeEach(() => {
    write('.minerva/types/meeting.md', OLD_MEETING_TYPE);
  });

  it('loads the in-tree definition: no parent, text attendees', async () => {
    const cat = await loadTypeCatalog(root);
    const meeting = cat.types.find((t) => t.id === 'meeting')!;
    expect(meeting.source).toBe('user');
    expect(meeting.overridesStock).toBe(true);
    expect(meeting.parent).toBeUndefined();
    expect(meeting.properties.map((p) => p.name)).toEqual(['date', 'organizer', 'attendees']);
    expect(meeting.properties.find((p) => p.name === 'attendees')?.type).toBe('text');
  });

  it('is not an Event subclass, so its meetings stay out of the Event view', async () => {
    write('Launch.md', `---\ntitle: Launch\ntype: event\n---\n`);
    write('Standup.md', `---\ntitle: Standup\ntype: meeting\nattendees: Alice, Bob\n---\n`);
    await reloadTypeCatalog(ctx);
    await indexAllNotes(ctx);

    const sub = await rows(`SELECT ?p WHERE { types:Meeting rdfs:subClassOf ?p }`);
    expect(sub.map((r) => r.p)).not.toContain('https://minerva.dev/ontology/types#Event');
    const view = await getTypeInstances(ctx, 'event');
    expect(view.instances.map((i) => i.title)).toEqual(['Launch']);

    const props = await getNoteTypedProperties(ctx, 'Standup.md');
    expect(props.properties.find((p) => p.name === 'attendees')).toMatchObject({ type: 'text', value: 'Alice, Bob' });
  });

  it('deleting the override brings the stock (Event-subtype) Meeting back', async () => {
    fs.rmSync(path.join(root, '.minerva/types/meeting.md'));
    const cat = await loadTypeCatalog(root);
    expect(cat.types.find((t) => t.id === 'meeting')).toMatchObject({ source: 'stock', parent: 'event' });
  });
});
