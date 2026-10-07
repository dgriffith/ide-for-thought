/**
 * A `link-to-type` property holding plain text (#2612).
 *
 * Meeting's `attendees` was a `text` property; as an Event subtype it inherits
 * Event's `attendees` (link-to-type → Person). Every existing meeting note
 * holds names, not links — `attendees: Alice, Bob`, or a YAML list of names —
 * and is not rewritten. So a plain-text value on a link-to-type property has
 * to keep indexing and reading back as text.
 *
 * These were written against Event (already link-to-type) BEFORE Meeting
 * changed, to pin what the graph already did; the Meeting cases below them
 * hold the same behaviour for the notes the change actually reaches.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  indexAllNotes,
  queryGraph,
  getNoteTypedProperties,
  getTypeInstances,
} from '../../../src/main/graph/index';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

const project = useGraphProject('minerva-link-text-');
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

async function attendeeTerms(title: string): Promise<Array<{ v: string; isLiteral: boolean }>> {
  const { results, error } = await queryGraph(ctx, `
    SELECT ?v (isLiteral(?v) AS ?lit) WHERE { ?e dc:title "${title}" ; types:attendees ?v } ORDER BY ?v
  `);
  expect(error).toBeUndefined();
  return (results as Array<{ v: string; lit: string }>).map((r) => ({ v: r.v, isLiteral: r.lit === 'true' }));
}

for (const typeId of ['event', 'meeting'] as const) {
  describe(`plain-text names on a ${typeId}'s link-to-type attendees`, () => {
    it('a comma-separated string indexes as one plain literal, read back as written', async () => {
      writeNote('Sync.md', `---\ntitle: Sync\ntype: ${typeId}\nattendees: Alice, Bob\n---\n`);
      await expect(indexAllNotes(ctx)).resolves.not.toThrow();

      expect(await attendeeTerms('Sync')).toEqual([{ v: 'Alice, Bob', isLiteral: true }]);

      const props = await getNoteTypedProperties(ctx, 'Sync.md');
      const attendees = props.properties.find((p) => p.name === 'attendees');
      expect(attendees).toMatchObject({ type: 'link-to-type', targetType: 'person', value: 'Alice, Bob' });

      const view = await getTypeInstances(ctx, typeId);
      expect(view.instances.find((i) => i.path === 'Sync.md')?.values.attendees).toBe('Alice, Bob');
    });

    it('a YAML list of names indexes one literal per name', async () => {
      writeNote('Sync.md', `---\ntitle: Sync\ntype: ${typeId}\nattendees:\n  - Alice\n  - Bob\n---\n`);
      await indexAllNotes(ctx);

      expect(await attendeeTerms('Sync')).toEqual([
        { v: 'Alice', isLiteral: true },
        { v: 'Bob', isLiteral: true },
      ]);
      // First value wins in the projections (as for any multi-valued key).
      const props = await getNoteTypedProperties(ctx, 'Sync.md');
      expect(['Alice', 'Bob']).toContain(props.properties.find((p) => p.name === 'attendees')?.value);
    });

    it('a list mixing a link and a name keeps the link an edge and the name text', async () => {
      writeNote('Alice.md', `---\ntitle: Alice\ntype: person\n---\n`);
      writeNote('Sync.md', `---\ntitle: Sync\ntype: ${typeId}\nattendees: ["[[Alice]]", Carol]\n---\n`);
      await indexAllNotes(ctx);

      const terms = await attendeeTerms('Sync');
      expect(terms).toHaveLength(2);
      expect(terms.find((t) => t.v === 'Carol')).toEqual({ v: 'Carol', isLiteral: true });
      const link = terms.find((t) => !t.isLiteral)!;
      expect(link.v).toMatch(/\/note\/Alice$/);
    });

    it('a name that happens to match a Person stays text until it is linked', async () => {
      // No implicit linking: indexing never guesses that "Alice" means Alice.md.
      writeNote('Alice.md', `---\ntitle: Alice\ntype: person\n---\n`);
      writeNote('Sync.md', `---\ntitle: Sync\ntype: ${typeId}\nattendees: Alice\n---\n`);
      await indexAllNotes(ctx);
      expect(await attendeeTerms('Sync')).toEqual([{ v: 'Alice', isLiteral: true }]);
    });
  });
}
