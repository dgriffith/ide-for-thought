/**
 * Type-registry loader + parser (#1062). Stock loads; in-tree user types load
 * additively; user can't shadow stock; malformed defs fail soft.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { loadTypeCatalog } from '../../../src/main/types/loader';
import { parseType } from '../../../src/main/types/parse';

let root: string;

function writeUserType(name: string, content: string): void {
  const dir = path.join(root, '.minerva', 'types');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), content, 'utf-8');
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-types-'));
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe('loadTypeCatalog (#1062)', () => {
  it('loads the stock types as classes with PascalCase IRIs', async () => {
    const cat = await loadTypeCatalog(root);
    const ids = cat.types.map((t) => t.id);
    for (const id of ['book', 'person', 'meeting', 'project', 'idea', 'article']) {
      expect(ids).toContain(id);
    }
    const book = cat.types.find((t) => t.id === 'book')!;
    expect(book.classLocalName).toBe('Book');
    expect(book.source).toBe('stock');
    expect(book.properties.map((p) => p.name)).toContain('author');
    expect(cat.errors.filter((e) => e.source === 'stock')).toEqual([]);
  });

  it('loads an in-tree user type additively', async () => {
    writeUserType('recipe.md', `---\nlabel: Recipe\nicon: 🍳\nproperties:\n  - name: servings\n    type: number\n---\n## Ingredients\n`);
    const cat = await loadTypeCatalog(root);
    const recipe = cat.types.find((t) => t.id === 'recipe');
    expect(recipe?.source).toBe('user');
    expect(recipe?.classLocalName).toBe('Recipe');
    expect(recipe?.properties[0]).toMatchObject({ name: 'servings', type: 'number' });
  });

  it("rejects a user type that shadows a stock id (stock wins)", async () => {
    writeUserType('book.md', `---\nlabel: Book\n---\n`);
    const cat = await loadTypeCatalog(root);
    const books = cat.types.filter((t) => t.id === 'book');
    expect(books).toHaveLength(1);
    expect(books[0]!.source).toBe('stock'); // stock kept
    expect(cat.errors.some((e) => /already a stock type/.test(e.message))).toBe(true);
  });

  it('fails soft on a malformed user type (logged, skipped, stock intact)', async () => {
    writeUserType('bad.md', `no frontmatter here`);
    const cat = await loadTypeCatalog(root);
    expect(cat.types.some((t) => t.id === 'book')).toBe(true); // stock unaffected
    expect(cat.errors.some((e) => e.source === 'user')).toBe(true);
  });

  it('missing user-types dir is fine (just stock)', async () => {
    const cat = await loadTypeCatalog(root);
    expect(cat.types.length).toBeGreaterThanOrEqual(6);
  });

  // Non-stock ids throughout — a user type sharing a stock id (e.g. `book`) is
  // shadowed by stock, which carries no parent.
  it('keeps a parent that resolves to a known type (#1586)', async () => {
    writeUserType('reference.md', `---\nlabel: Reference\n---\n`);
    writeUserType('monograph.md', `---\nlabel: Monograph\nparent: reference\n---\n`);
    const cat = await loadTypeCatalog(root);
    expect(cat.types.find((t) => t.id === 'monograph')?.parent).toBe('reference');
    expect(cat.errors.filter((e) => /parent/.test(e.message))).toEqual([]);
  });

  it('flags + clears a parent that does not exist (#1586)', async () => {
    writeUserType('monograph.md', `---\nlabel: Monograph\nparent: ghost\n---\n`);
    const cat = await loadTypeCatalog(root);
    expect(cat.types.find((t) => t.id === 'monograph')?.parent).toBeUndefined(); // cleared
    expect(cat.errors.some((e) => /parent type "ghost" does not exist/.test(e.message))).toBe(true);
  });

  it('flags + clears a self-referential parent (#1586)', async () => {
    writeUserType('monograph.md', `---\nlabel: Monograph\nparent: monograph\n---\n`);
    const cat = await loadTypeCatalog(root);
    expect(cat.types.find((t) => t.id === 'monograph')?.parent).toBeUndefined();
    expect(cat.errors.some((e) => /can't be its own parent/.test(e.message))).toBe(true);
  });
});

describe('parseType (#1062)', () => {
  it('parses properties incl. enum options and link-to-type target', () => {
    const r = parseType(
      `---\nlabel: Task\nproperties:\n  - name: status\n    type: enum\n    options: [todo, done]\n  - name: owner\n    type: link-to-type\n    targetType: Person\n---\nbody`,
      'user',
      '/x/task.md',
    );
    expect(r.type?.id).toBe('task');
    const status = r.type!.properties.find((p) => p.name === 'status')!;
    expect(status.options).toEqual(['todo', 'done']);
    const owner = r.type!.properties.find((p) => p.name === 'owner')!;
    expect(owner.targetType).toBe('person'); // slugified
    expect(r.type!.template).toBe('body');
  });

  it('rejects a def with no label', () => {
    const r = parseType(`---\nicon: 📦\n---\n`, 'user', '/x/nolabel.md');
    expect(r.type).toBeUndefined();
    expect(r.errors.some((e) => /label/.test(e))).toBe(true);
  });

  it('soft-errors an enum with no options but still loads the type', () => {
    const r = parseType(`---\nlabel: Thing\nproperties:\n  - name: kind\n    type: enum\n---\n`, 'user', '/x/thing.md');
    expect(r.type?.id).toBe('thing');
    expect(r.errors.some((e) => /no `options`/.test(e))).toBe(true);
  });

  it('skips an unknown property type with an error', () => {
    const r = parseType(`---\nlabel: Thing\nproperties:\n  - name: x\n    type: bogus\n---\n`, 'user', '/x/thing.md');
    expect(r.type?.properties).toHaveLength(0);
    expect(r.errors.some((e) => /unknown type/.test(e))).toBe(true);
  });

  it('carries a `cover` that names a declared property (#1070)', () => {
    const r = parseType(`---\nlabel: Gadget\ncover: image\nproperties:\n  - name: image\n    type: text\n---\n`, 'user', '/x/gadget.md');
    expect(r.type?.cover).toBe('image');
    expect(r.errors).toHaveLength(0);
  });

  it('still loads but flags a `cover` that is not a declared property (#1070)', () => {
    const r = parseType(`---\nlabel: Gadget\ncover: missing\nproperties:\n  - name: image\n    type: text\n---\n`, 'user', '/x/gadget.md');
    expect(r.type?.cover).toBe('missing'); // house UX: no hand-holding — still loads
    expect(r.errors.some((e) => /not a declared property/.test(e))).toBe(true);
  });

  it('parses a `card:` list of declared property names (#1071)', () => {
    const r = parseType(
      `---\nlabel: Book\ncard: [author, rating]\nproperties:\n  - name: author\n    type: text\n  - name: rating\n    type: number\n---\n`,
      'user',
      '/x/book.md',
    );
    expect(r.type?.card).toEqual(['author', 'rating']);
    expect(r.errors).toHaveLength(0);
  });

  it('drops unknown `card:` entries with a soft error but keeps the valid ones (#1071)', () => {
    const r = parseType(
      `---\nlabel: Book\ncard: [author, bogus]\nproperties:\n  - name: author\n    type: text\n---\n`,
      'user',
      '/x/book.md',
    );
    expect(r.type?.card).toEqual(['author']);
    expect(r.errors.some((e) => /"bogus".*not a declared property/.test(e))).toBe(true);
  });

  it('reads a parent type reference from `parent` or `extends`, slugified (#1586)', () => {
    expect(parseType(`---\nlabel: Book\nparent: Reference Work\n---\n`, 'user', '/x/b.md').type?.parent).toBe('reference-work');
    expect(parseType(`---\nlabel: Book\nextends: reference\n---\n`, 'user', '/x/b.md').type?.parent).toBe('reference');
    expect(parseType(`---\nlabel: Book\n---\n`, 'user', '/x/b.md').type?.parent).toBeUndefined();
  });
});
