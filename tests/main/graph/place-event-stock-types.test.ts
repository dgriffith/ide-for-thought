/**
 * Place and Event stock object types (#2065, epic #2063). Place introduces the
 * `geo` PropertyType (#2064 design spike — a plain "<lat>,<lng>" string, no
 * geocoding); Event reuses link-to-type to point at Place/Person rather than
 * duplicating a location field or inventing a new relation shape.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { indexAllNotes, queryGraph, getNoteTypedProperties } from '../../../src/main/graph/index';
import { loadTypeCatalog } from '../../../src/main/types/loader';
import fs from 'node:fs';
import path from 'node:path';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

const project = useGraphProject('minerva-place-event-');
let root: string;
let ctx: ProjectContext;

function writeNote(rel: string, content: string): void {
  const fp = path.join(root, rel);
  fs.mkdirSync(path.dirname(fp), { recursive: true });
  fs.writeFileSync(fp, content, 'utf-8');
}

beforeEach(() => {
  root = project.root;
  ctx = project.ctx;
});

describe('stock Place/Event types load (#2065)', () => {
  it('both load with PascalCase class names and their declared properties', async () => {
    const cat = await loadTypeCatalog(root);
    const place = cat.types.find((t) => t.id === 'place')!;
    const event = cat.types.find((t) => t.id === 'event')!;
    expect(place.classLocalName).toBe('Place');
    expect(place.source).toBe('stock');
    expect(place.properties.map((p) => p.name)).toEqual(['location', 'address', 'notes']);
    expect(place.properties.find((p) => p.name === 'location')?.type).toBe('geo');

    expect(event.classLocalName).toBe('Event');
    expect(event.properties.map((p) => p.name)).toEqual(['date', 'end', 'location', 'attendees']);
    expect(event.properties.find((p) => p.name === 'location')).toMatchObject({ type: 'link-to-type', targetType: 'place' });
    expect(event.properties.find((p) => p.name === 'attendees')).toMatchObject({ type: 'link-to-type', targetType: 'person' });

    expect(cat.errors.filter((e) => e.source === 'stock')).toEqual([]);
  });

  it('does not disturb the original six stock types', async () => {
    const cat = await loadTypeCatalog(root);
    for (const id of ['book', 'person', 'meeting', 'project', 'idea', 'article']) {
      expect(cat.types.find((t) => t.id === id)?.source).toBe('stock');
    }
  });
});

describe('a `type: place` note indexes correctly (#2065)', () => {
  it('is an instance of types:Place, keeping minerva:Note too', async () => {
    writeNote('SF.md', `---\ntitle: San Francisco\ntype: place\nlocation: "37.7749,-122.4194"\naddress: California, USA\n---\n`);
    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `SELECT ?t WHERE { ?n dc:title "San Francisco" ; a ?t }`);
    const types = (results as Array<{ t: string }>).map((r) => r.t);
    expect(types.some((t) => t.endsWith('ontology#Note'))).toBe(true);
    expect(types.some((t) => t.endsWith('types#Place'))).toBe(true);
  });

  it('stores the geo property as a plain literal string, read back unchanged', async () => {
    writeNote('SF.md', `---\ntitle: San Francisco\ntype: place\nlocation: "37.7749,-122.4194"\n---\n`);
    await indexAllNotes(ctx);

    const props = await getNoteTypedProperties(ctx, 'SF.md');
    expect(props.type?.id).toBe('place');
    const location = props.properties.find((p) => p.name === 'location');
    expect(location?.type).toBe('geo');
    expect(location?.value).toBe('37.7749,-122.4194');
  });
});

describe('a `type: event` note links to Place and multiple Person attendees (#2065)', () => {
  it('location resolves to the Place note via link-to-type', async () => {
    writeNote('SF.md', `---\ntitle: San Francisco\ntype: place\nlocation: "37.7749,-122.4194"\n---\n`);
    writeNote('Launch Party.md', `---\ntitle: Launch Party\ntype: event\ndate: 2026-06-01\nlocation: "[[SF]]"\n---\n`);
    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `
      SELECT ?place WHERE {
        ?e dc:title "Launch Party" ; types:location ?place .
        ?place a types:Place .
      }
    `);
    expect((results as Array<{ place: string }>).length).toBe(1);
  });

  it('a YAML list of attendees produces one edge per person (multi-value, no new plumbing)', async () => {
    writeNote('Alice.md', `---\ntitle: Alice\ntype: person\n---\n`);
    writeNote('Bob.md', `---\ntitle: Bob\ntype: person\n---\n`);
    writeNote('Launch Party.md', `---\ntitle: Launch Party\ntype: event\nattendees: ["[[Alice]]", "[[Bob]]"]\n---\n`);
    await indexAllNotes(ctx);

    const { results } = await queryGraph(ctx, `
      SELECT ?name WHERE {
        ?e dc:title "Launch Party" ; types:attendees ?person .
        ?person dc:title ?name .
      }
      ORDER BY ?name
    `);
    expect((results as Array<{ name: string }>).map((r) => r.name)).toEqual(['Alice', 'Bob']);
  });
});

describe('Event\'s date and end are datetime (#2613)', () => {
  it('declares both as datetime', async () => {
    const event = (await loadTypeCatalog(root)).types.find((t) => t.id === 'event')!;
    expect(event.properties.find((p) => p.name === 'date')?.type).toBe('datetime');
    expect(event.properties.find((p) => p.name === 'end')?.type).toBe('datetime');
  });

  it('types a timed event xsd:dateTime, and keeps date-only and partial values valid', async () => {
    writeNote('Talk.md', `---\ntitle: Talk\ntype: event\ndate: 2026-10-05T14:30\nend: 2026-10-05T15:15\n---\n`);
    writeNote('Launch Party.md', `---\ntitle: Launch Party\ntype: event\ndate: 2026-06-01\n---\n`);
    writeNote('Moon.md', `---\ntitle: Moon\ntype: event\ndate: 1969-07\nend: 1969\n---\n`);
    await indexAllNotes(ctx);
    const value = async (path: string, name: string) =>
      (await getNoteTypedProperties(ctx, path)).properties.find((p) => p.name === name)?.value;
    expect(await value('Talk.md', 'date')).toBe('2026-10-05T14:30:00');
    expect(await value('Talk.md', 'end')).toBe('2026-10-05T15:15:00');
    expect(await value('Launch Party.md', 'date')).toBe('2026-06-01');
    expect(await value('Moon.md', 'date')).toBe('1969-07');
    expect(await value('Moon.md', 'end')).toBe('1969');

    const { results } = await queryGraph(ctx, `
      SELECT ?title (DATATYPE(?d) AS ?dt) WHERE { ?e a types:Event ; dc:title ?title ; dc:issued ?d } ORDER BY ?title`);
    expect((results as Array<{ title: string; dt: string }>).map((r) => [r.title, r.dt.split('#')[1]])).toEqual([
      ['Launch Party', 'date'], ['Moon', 'gYearMonth'], ['Talk', 'dateTime'],
    ]);
  });
});

describe('materializes types:Place and types:Event as rdfs:Class (#2065)', () => {
  it('both classes carry a typeId, alongside the original six', async () => {
    await indexAllNotes(ctx);
    const { results } = await queryGraph(ctx, `SELECT ?id WHERE { ?c a rdfs:Class ; minerva:typeId ?id } ORDER BY ?id`);
    const ids = (results as Array<{ id: string }>).map((r) => r.id);
    expect(ids).toContain('place');
    expect(ids).toContain('event');
    expect(ids).toContain('book');
  });
});
