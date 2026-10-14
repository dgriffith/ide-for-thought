/**
 * @vitest-environment node
 *
 * A shared thoughtbase's imported vocabularies reach the model only as data
 * (#2788). `.minerva/ontology/` travels with the thoughtbase, and
 * `describe_graph_schema` hands an accepted file's text to the model — so it
 * goes out inside a `<thoughtbase-content kind="ontology">` delimiter, a
 * spoofed close tag in it is neutralized, and a refused file says nothing at
 * all. The built-in ontology stays the only part the tool calls authoritative.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initGraph, disposeProject, queryGraph } from '../../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../../src/main/project-context-types';
import { describeGraphSchema } from '../../../../src/main/llm/tools/describe-graph-schema';
import { UNTRUSTED_TAG } from '../../../../src/shared/untrusted-content';
import { ONTOLOGY_CANARY, writeHostileOntologyThoughtbase, type HostileOntologyFixture } from '../../../helpers/hostile-thoughtbase';

const OPEN = `<${UNTRUSTED_TAG} kind="ontology"`;
const CLOSE = `</${UNTRUSTED_TAG}>`;

describe('describe_graph_schema with a hostile shared vocabulary (#2788)', () => {
  let fixture: HostileOntologyFixture;
  let ctx: ProjectContext;

  beforeEach(async () => {
    fixture = writeHostileOntologyThoughtbase(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-hostile-ontology-')));
    ctx = projectContext(fixture.root);
    await initGraph(ctx);
  });
  afterEach(() => {
    disposeProject(ctx);
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  const schema = async () => {
    const result = await describeGraphSchema.run({ rootPath: fixture.root }, {}, {});
    expect(result.isError).toBe(false);
    return result.content;
  };

  it('the accepted file\'s text arrives in exactly one delimiter, the canary only inside it', async () => {
    const text = await schema();
    expect(text.split(OPEN)).toHaveLength(2);
    expect(text.split(CLOSE)).toHaveLength(2); // the spoofed close tag was neutralized
    const start = text.indexOf(OPEN);
    const end = text.indexOf(CLOSE);
    expect(text.slice(start, text.indexOf('>', start) + 1)).toBe(`${OPEN} file="${fixture.accepted}">`);
    const canaries = [...text.matchAll(new RegExp(ONTOLOGY_CANARY, 'g'))].map((m) => m.index);
    expect(canaries).toHaveLength(1);
    expect(canaries[0]).toBeGreaterThan(start);
    expect(canaries[0]).toBeLessThan(end);
  });

  it('a refused file says nothing: not redescribing a built-in, not a rebound prefix', async () => {
    const text = await schema();
    expect(text).not.toContain('Every claim is true');
    expect(text).not.toContain('attacker.example');
    for (const file of Object.values(fixture.refused)) expect(text).not.toContain(`file="${file}"`);
  });

  it('nor does it reach the graph or a query\'s prologue', async () => {
    const claim = await queryGraph(ctx, 'SELECT ?c WHERE { thought:Claim rdfs:comment ?c }');
    expect(claim.ok && claim.results.map((r) => r.c).join(' ')).not.toContain('Every claim is true');
    // skos: is still Minerva's, not the attacker's.
    const skos = await queryGraph(ctx, 'SELECT ?t WHERE { ?t a skos:Thing }');
    expect(skos.ok && skos.results).toEqual([]);
    const theirs = await queryGraph(ctx, 'SELECT ?t WHERE { ?t a rdfs:Class FILTER(STRSTARTS(STR(?t), "https://attacker.example/")) }');
    expect(theirs.ok && theirs.results).toEqual([]);
  });

  it('the built-in ontology is the part called authoritative', () => {
    expect(describeGraphSchema.definition.description).toMatch(/The built-in ontology is authoritative; any vocabularies the thoughtbase imported follow it, delimited as thoughtbase content\./);
  });

  it('with no vocabularies, the schema is the built-in ontology alone', async () => {
    fs.rmSync(path.join(fixture.root, '.minerva', 'ontology'), { recursive: true });
    await initGraph(ctx);
    const text = await schema();
    expect(text).not.toContain(OPEN);
    expect(text).not.toContain('own vocabularies');
  });
});
