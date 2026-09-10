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
