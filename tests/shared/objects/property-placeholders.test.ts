/**
 * Property placeholders in an object type's default body (#2490): the one rule
 * creation, property edits (#2491) and the LLM path (#2492) share.
 */
import { describe, it, expect } from 'vitest';
import {
  fillPropertyPlaceholders,
  propertyPlaceholderName,
  renderPropertyValue,
} from '../../../src/shared/objects/property-placeholders';
import { substituteTemplate } from '../../../src/shared/templates';

const NAMES = new Set(['city', 'price-range', 'date', 'tags', 'neighbour']);

describe('propertyPlaceholderName', () => {
  it('reads a bare declared property', () => {
    expect(propertyPlaceholderName('city', NAMES)).toBe('city');
    expect(propertyPlaceholderName(' price-range ', NAMES)).toBe('price-range');
  });
  it('lets a built-in win over a same-named property, with prop: as the escape hatch', () => {
    expect(propertyPlaceholderName('date', NAMES)).toBeNull();
    expect(propertyPlaceholderName('prop:date', NAMES)).toBe('date');
  });
  it('ignores unknown names and other colon forms', () => {
    expect(propertyPlaceholderName('rating', NAMES)).toBeNull();
    expect(propertyPlaceholderName('prop:rating', NAMES)).toBeNull();
    expect(propertyPlaceholderName('date:YYYY', NAMES)).toBeNull();
    expect(propertyPlaceholderName('prompt:City', NAMES)).toBeNull();
  });
});

describe('renderPropertyValue', () => {
  it('renders scalars, joins lists, keeps wiki-links, skips empties', () => {
    expect(renderPropertyValue('Prague')).toBe('Prague');
    expect(renderPropertyValue(4)).toBe('4');
    expect(renderPropertyValue(false)).toBe('false');
    expect(renderPropertyValue(['books', 'maps'])).toBe('books, maps');
    expect(renderPropertyValue('[[Old Town Square]]')).toBe('[[Old Town Square]]');
    expect(renderPropertyValue('')).toBeNull();
    expect(renderPropertyValue('   ')).toBeNull();
    expect(renderPropertyValue([])).toBeNull();
    expect(renderPropertyValue(null)).toBeNull();
    expect(renderPropertyValue(undefined)).toBeNull();
    expect(renderPropertyValue({ lat: 1 })).toBeNull();
  });
});

describe('fillPropertyPlaceholders', () => {
  const body = 'In {{city}} ({{price-range}}), near {{neighbour}}. Seen {{prop:date}}; made {{date}}. {{rating}}';

  it('fills only placeholders whose property has a value, leaving the rest literal', () => {
    expect(fillPropertyPlaceholders(body, { city: 'Prague', date: '2026-10-02' }, NAMES))
      .toBe('In Prague ({{price-range}}), near {{neighbour}}. Seen 2026-10-02; made {{date}}. {{rating}}');
  });

  it('leaves escapes and text untouched, and returns the same string when nothing filled', () => {
    const escaped = 'Literal \\{{city}} and {{city}}';
    expect(fillPropertyPlaceholders(escaped, { city: 'Brno' }, NAMES)).toBe('Literal \\{{city}} and Brno');
    const unchanged = 'No values: {{city}}';
    expect(fillPropertyPlaceholders(unchanged, {}, NAMES)).toBe(unchanged);
  });

  it('never re-fills text that was filled before (fill once, don\'t bind)', () => {
    const once = fillPropertyPlaceholders('City: {{city}}', { city: 'Prague' }, NAMES);
    expect(fillPropertyPlaceholders(once, { city: 'Budapest' }, NAMES)).toBe('City: Prague');
  });

  it('survives an unclosed placeholder', () => {
    expect(fillPropertyPlaceholders('{{city}} then {{oops', { city: 'Prague' }, NAMES)).toBe('Prague then {{oops');
  });
});

describe('substituteTemplate with a type\'s properties', () => {
  it('fills properties with values, keeps the rest for later, and still resolves built-ins', async () => {
    const out = await substituteTemplate('# {{title}}\n{{city}} / {{neighbour}} / {{prop:date}}', {
      title: 'Kantýna',
      properties: { names: NAMES, values: { city: 'Prague' } },
    });
    expect(out.content).toBe('# Kantýna\nPrague / {{neighbour}} / {{prop:date}}');
  });

  it('without a properties context, property placeholders survive as before', async () => {
    const out = await substituteTemplate('{{city}}', { title: 't' });
    expect(out.content).toBe('{{city}}');
  });
});
