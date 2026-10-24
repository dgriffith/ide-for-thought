/**
 * Reading SHACL shapes as inspections (#2642): which shapes are checks, what
 * each says about itself, and every way a file is refused — above all, any
 * SPARQL in it that isn't a SELECT or an ASK.
 */
import { describe, it, expect } from 'vitest';
import { MAX_CHECKS_PER_FILE, MAX_SHAPES_FILE_BYTES, parseShapesFile, type ShapesOrigin } from '../../../src/main/graph/shacl/shapes';

const PLUGIN: ShapesOrigin = { kind: 'plugin', id: 'lab', name: 'Lab' };
const P = `@prefix sh: <http://www.w3.org/ns/shacl#> .
@prefix ex: <https://example.org/shapes#> .
@prefix minerva: <https://minerva.dev/ontology#> .
@prefix types: <https://minerva.dev/ontology/types#> .
`;
const problems = (ttl: string, origin: ShapesOrigin = PLUGIN) => {
  const r = parseShapesFile(P + ttl, origin);
  return r.ok ? [] : r.problems;
};

describe('parseShapesFile (#2642)', () => {
  it('a node shape with a target is a check, described by its SHACL terms and Minerva annotations', () => {
    const r = parseShapesFile(P + `
      ex:NeedsAuthor a sh:NodeShape ; sh:targetClass types:Book ;
        sh:name "Books without an author" ; sh:description "Every book should say who wrote it." ;
        sh:severity sh:Warning ; sh:message "{$this} has no author" ;
        minerva:inspectionGroup "sources" ; minerva:suggestedAction "Add an author" ;
        sh:property [ sh:path minerva:meta-author ; sh:minCount 1 ] .
      ex:Helper a sh:NodeShape ; sh:property [ sh:path minerva:meta-x ; sh:minCount 1 ] .`, PLUGIN);
    if (!r.ok) throw new Error(r.problems.join('\n'));
    expect(r.file.checks).toEqual([{
      type: 'plugin:lab/NeedsAuthor', shape: 'https://example.org/shapes#NeedsAuthor',
      label: 'Books without an author', description: 'Every book should say who wrote it.',
      group: 'sources', severity: 'warning', message: '{$this} has no author', suggestedAction: 'Add an author',
      plugin: { id: 'lab', name: 'Lab' },
    }]);
  });

  it("defaults: Violation is a concern, a plugin's group is plugins, the label is the shape's name", () => {
    const r = parseShapesFile(P + 'ex:Bare a sh:NodeShape ; sh:targetNode ex:x .', PLUGIN);
    if (!r.ok) throw new Error(r.problems.join('\n'));
    expect(r.file.checks[0]).toMatchObject({ severity: 'concern', group: 'plugins', label: 'Bare', description: '', message: null, suggestedAction: null });
  });

  it('a stock shape is typed by its minerva:inspectionId, and must have one', () => {
    const ok = parseShapesFile(P + 'ex:S a sh:NodeShape ; sh:targetNode ex:x ; minerva:inspectionId "stale_note" ; minerva:inspectionGroup "notes" .', { kind: 'stock' });
    expect(ok.ok && ok.file.checks[0]!.type).toBe('stale_note');
    expect(problems('ex:S a sh:NodeShape ; sh:targetNode ex:x ; minerva:inspectionGroup "notes" .', { kind: 'stock' }))
      .toEqual(['https://example.org/shapes#S has no minerva:inspectionId']);
  });

  it('refuses any SPARQL that could write, and any that is not SPARQL', () => {
    const shape = (q: string, kind = 'select') => `ex:S a sh:NodeShape ; sh:targetNode ex:x ; sh:sparql [ sh:${kind} """${q}""" ] .`;
    expect(problems(shape('INSERT DATA { <a:x> <a:p> "owned" }'))).toEqual(['a sh:select must be a SELECT query; a shape can only read the graph']);
    expect(problems(shape('DELETE WHERE { ?s ?p ?o }'))).toEqual(['a sh:select must be a SELECT query; a shape can only read the graph']);
    expect(problems(shape('SELECT $this WHERE { $this ?p ?o }', 'ask'))).toEqual(['a sh:ask must be an ASK query; a shape can only read the graph']);
    expect(problems(shape('SELEKT nothing'))[0]).toMatch(/^a sh:select isn't valid SPARQL/);
    expect(problems(shape('SELECT $this WHERE { $this ?p ?o }'))).toEqual([]);
    expect(problems(shape('ASK { $this ?p ?o }', 'ask'))).toEqual([]);
  });

  it("reads a query's prefixes from the file's sh:declare, as the validator does", () => {
    const ttl = `ex: sh:declare [ sh:prefix "dc" ; sh:namespace "http://purl.org/dc/terms/" ] .
      ex:S a sh:NodeShape ; sh:targetNode ex:x ; sh:sparql [ sh:prefixes ex: ; sh:select "SELECT $this WHERE { $this dc:title ?t }" ] .`;
    expect(problems(ttl)).toEqual([]);
    expect(problems(ttl.replace('sh:declare [ sh:prefix "dc" ; sh:namespace "http://purl.org/dc/terms/" ] .', 'a sh:NodeShape .'))[0]).toMatch(/isn't valid SPARQL/);
  });

  it('refuses what is not a shapes file of checks', () => {
    expect(parseShapesFile('not turtle {', PLUGIN)).toMatchObject({ ok: false, problems: [expect.stringMatching(/^it isn't valid Turtle/)] });
    expect(problems('ex:NoTarget a sh:NodeShape .')).toEqual(['it declares no sh:NodeShape with a target (sh:targetClass, sh:targetNode, …), so no inspection']);
    expect(parseShapesFile('#'.repeat(MAX_SHAPES_FILE_BYTES + 1), PLUGIN)).toEqual({ ok: false, problems: [`it's over ${MAX_SHAPES_FILE_BYTES} bytes`] });
    const many = Array.from({ length: MAX_CHECKS_PER_FILE + 1 }, (_, i) => `ex:S${i} a sh:NodeShape ; sh:targetNode ex:x .`).join('\n');
    expect(problems(many)).toEqual([`it declares ${MAX_CHECKS_PER_FILE + 1} shapes with targets; at most ${MAX_CHECKS_PER_FILE}`]);
  });

  it('refuses a bad severity, group or name', () => {
    expect(problems('ex:S a sh:NodeShape ; sh:targetNode ex:x ; sh:severity sh:Panic .')).toEqual(["S's sh:severity is <http://www.w3.org/ns/shacl#Panic>; use sh:Info, sh:Warning or sh:Violation"]);
    expect(problems('ex:S a sh:NodeShape ; sh:targetNode ex:x ; minerva:inspectionGroup "everything" .')).toEqual(['S\'s minerva:inspectionGroup is "everything"; use notes, links, sources, arguments, plugins']);
    expect(problems('<https://example.org/shapes#9lives> a sh:NodeShape ; sh:targetNode ex:x .')).toEqual(['the shape <https://example.org/shapes#9lives> needs a name of letters, digits, _ and -, starting with a letter']);
  });
});
