/**
 * A structured tool argument sent as a JSON-encoded string is decoded against
 * the tool's schema at dispatch.
 *
 * The case that prompted it: a model proposing a "Retail" object type sent
 * `properties` as a string five times. Each time the tool answered "must be a
 * non-empty array", the model was sure it had sent one, and the conversation
 * ended with "something is preventing the parameters from being passed
 * correctly" and no proposal.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { queryGraph } from '../../../../src/main/graph/index';
import { executeNotebaseTool } from '../../../../src/main/llm/tools';
import { normalizeToolInput } from '../../../../src/main/llm/tools/normalize-input';
import { useGraphProject } from '../../../helpers/temp-project';

const SCHEMA = {
  type: 'object',
  properties: {
    label: { type: 'string' },
    note: { type: 'string' },
    card: { type: 'array', items: { type: 'string' } },
    meta: { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } } },
    properties: {
      type: 'array',
      items: {
        type: 'object',
        properties: { name: { type: 'string' }, options: { type: 'array', items: { type: 'string' } } },
      },
    },
  },
};

describe('normalizeToolInput', () => {
  it('decodes an array parameter sent as JSON text', () => {
    const out = normalizeToolInput(SCHEMA, { label: 'Retail', properties: '[{"name":"hours"}]' }) as Record<string, unknown>;
    expect(out.properties).toEqual([{ name: 'hours' }]);
  });

  it('decodes nested parameters too — an enum\'s options inside properties', () => {
    const out = normalizeToolInput(SCHEMA, { properties: [{ name: 'price', options: '["$","$$"]' }] }) as Record<string, unknown>;
    expect(out.properties).toEqual([{ name: 'price', options: ['$', '$$'] }]);
  });

  it('decodes an object parameter sent as JSON text', () => {
    const out = normalizeToolInput(SCHEMA, { meta: '{"tags":"[\\"a\\"]"}' }) as Record<string, unknown>;
    expect(out.meta).toEqual({ tags: ['a'] });
  });

  it('never touches a parameter the schema declares as a string, even when it looks like JSON', () => {
    const note = '[{"name":"x"}] is how the property list looks';
    const label = '{"literally":"braces"}';
    expect(normalizeToolInput(SCHEMA, { note, label })).toEqual({ note, label });
  });

  it('leaves a string that does not parse — or parses to the wrong kind — for the tool to reject', () => {
    expect(normalizeToolInput(SCHEMA, { properties: '[not json' })).toEqual({ properties: '[not json' });
    // An object where the schema wants an array is the model's error to see.
    expect(normalizeToolInput(SCHEMA, { card: '{"a":1}' })).toEqual({ card: '{"a":1}' });
    expect(normalizeToolInput(SCHEMA, { card: 'name, type' })).toEqual({ card: 'name, type' });
  });

  it('is a no-op on well-formed input, and passes through without a schema', () => {
    const input = { label: 'Retail', properties: [{ name: 'hours', options: ['a'] }], card: ['hours'] };
    expect(normalizeToolInput(SCHEMA, input)).toEqual(input);
    expect(normalizeToolInput(undefined, { properties: '[1]' })).toEqual({ properties: '[1]' });
  });
});

describe('dispatch: the Retail case end to end', () => {
  const project = useGraphProject('minerva-normalize-input-');
  beforeEach(() => { /* project set up by useGraphProject */ });

  const PROPERTIES = [
    { name: 'category', type: 'enum', options: ['Clothing', 'Books', 'Market'] },
    { name: 'price-range', type: 'enum', options: ['$', '$$', '$$$'] },
    { name: 'hours', type: 'text' },
  ];

  it('files the proposal when `properties` arrives as JSON text', async () => {
    const out = await executeNotebaseTool({ rootPath: project.root, conversationId: 'conv-1' }, 'propose_object_type', {
      label: 'Retail',
      icon: '🛍️',
      note: 'Retail shops for the Prague and Budapest trip',
      properties: JSON.stringify(PROPERTIES),
      card: JSON.stringify(['category', 'price-range']),
    });
    expect(out.isError).toBe(false);
    expect(JSON.parse(out.content).status).toBe('proposed');
    const r = await queryGraph(project.ctx, 'SELECT (COUNT(?p) AS ?n) WHERE { ?p a thought:Proposal ; thought:proposalStatus thought:pending }');
    expect(Number((r.results as Array<{ n: string }>)[0]!.n)).toBe(1);
  });

  it('says what arrived when properties really is unusable, so the model can fix it', async () => {
    const out = await executeNotebaseTool({ rootPath: project.root, conversationId: 'conv-1' }, 'propose_object_type', {
      label: 'Retail',
      properties: 'category, price-range, hours',
    });
    expect(out.isError).toBe(true);
    expect(out.content).toContain('received a string');
    expect(out.content).toContain('pass the array itself');

    const missing = await executeNotebaseTool({ rootPath: project.root, conversationId: 'conv-1' }, 'propose_object_type', { label: 'Retail' });
    expect(missing.content).toContain('the field was missing');
  });
});
