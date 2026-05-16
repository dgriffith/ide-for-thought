import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  loadCsvSchema,
  buildReadCsvSql,
  sidecarSchemaPath,
  companionMdPath,
} from '../../../src/main/sources/csv-schema';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-csv-schema-test-'));
}

async function writeFile(root: string, rel: string, content: string): Promise<void> {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, content, 'utf-8');
}

describe('sidecarSchemaPath / companionMdPath', () => {
  it('derives the sidecar path by appending .schema.yaml to the CSV', () => {
    expect(sidecarSchemaPath('data/foo.csv')).toBe('data/foo.csv.schema.yaml');
    expect(sidecarSchemaPath('foo.csv')).toBe('foo.csv.schema.yaml');
  });

  it('derives the companion .md path by swapping the .csv extension', () => {
    expect(companionMdPath('data/foo.csv')).toBe('data/foo.md');
    expect(companionMdPath('foo.csv')).toBe('foo.md');
  });
});

describe('loadCsvSchema', () => {
  let root: string;
  beforeEach(() => { root = mkTempProject(); });
  afterEach(async () => { await fsp.rm(root, { recursive: true, force: true }); });

  it('returns null when no companion + no sidecar exist', async () => {
    await writeFile(root, 'data/foo.csv', 'a,b\n1,2\n');
    expect(await loadCsvSchema(root, 'data/foo.csv')).toBeNull();
  });

  it('reads a sidecar `<stem>.csv.schema.yaml`', async () => {
    await writeFile(root, 'data/foo.csv', 'a,b\n1,2\n');
    await writeFile(root, 'data/foo.csv.schema.yaml', 'columns:\n  a: INTEGER\n  b: VARCHAR\n');
    const schema = await loadCsvSchema(root, 'data/foo.csv');
    expect(schema).toEqual({ columns: { a: 'INTEGER', b: 'VARCHAR' } });
  });

  it('reads a companion .md `csv:` frontmatter block', async () => {
    await writeFile(root, 'data/foo.csv', 'a,b\n1,2\n');
    await writeFile(
      root,
      'data/foo.md',
      [
        '---',
        'title: Foo readings',
        'csv:',
        '  columns:',
        '    a: BIGINT',
        '    b: DATE',
        '---',
        '# Foo',
      ].join('\n'),
    );
    const schema = await loadCsvSchema(root, 'data/foo.csv');
    expect(schema).toEqual({ columns: { a: 'BIGINT', b: 'DATE' } });
  });

  it('prefers the companion .md over the sidecar when both exist', async () => {
    await writeFile(root, 'data/foo.csv', 'a\n1\n');
    await writeFile(root, 'data/foo.csv.schema.yaml', 'columns:\n  a: VARCHAR\n');
    await writeFile(
      root,
      'data/foo.md',
      '---\ncsv:\n  columns:\n    a: INTEGER\n---\n',
    );
    const schema = await loadCsvSchema(root, 'data/foo.csv');
    expect(schema?.columns).toEqual({ a: 'INTEGER' });
  });

  it('parses optional delimiter + header overrides', async () => {
    await writeFile(root, 'data/tabs.csv', 'a\tb\n1\t2\n');
    await writeFile(
      root,
      'data/tabs.csv.schema.yaml',
      [
        'columns:',
        '  a: INTEGER',
        '  b: INTEGER',
        'delimiter: "\\t"',
        'header: false',
      ].join('\n'),
    );
    const schema = await loadCsvSchema(root, 'data/tabs.csv');
    expect(schema).toEqual({
      columns: { a: 'INTEGER', b: 'INTEGER' },
      delimiter: '\t',
      header: false,
    });
  });

  it('returns null when the companion .md has no `csv:` block', async () => {
    await writeFile(root, 'data/foo.csv', 'a\n1\n');
    await writeFile(root, 'data/foo.md', '---\ntitle: Foo\ntable_name: notrelevant\n---\n');
    expect(await loadCsvSchema(root, 'data/foo.csv')).toBeNull();
  });

  it('falls back to the sidecar when the companion .md exists but has no `csv:` block', async () => {
    await writeFile(root, 'data/foo.csv', 'a\n1\n');
    await writeFile(root, 'data/foo.md', '---\ntitle: Foo\n---\n');
    await writeFile(root, 'data/foo.csv.schema.yaml', 'columns:\n  a: VARCHAR\n');
    const schema = await loadCsvSchema(root, 'data/foo.csv');
    expect(schema?.columns).toEqual({ a: 'VARCHAR' });
  });

  it('returns null when `columns` is missing from the schema block', async () => {
    await writeFile(root, 'data/foo.csv', 'a\n1\n');
    await writeFile(root, 'data/foo.csv.schema.yaml', 'delimiter: ","\n');
    expect(await loadCsvSchema(root, 'data/foo.csv')).toBeNull();
  });

  it('returns null when the sidecar YAML is malformed', async () => {
    await writeFile(root, 'data/foo.csv', 'a\n1\n');
    await writeFile(root, 'data/foo.csv.schema.yaml', 'columns:\n  a: : :\n  bad indentation\n');
    expect(await loadCsvSchema(root, 'data/foo.csv')).toBeNull();
  });

  it('skips columns whose value is not a string', async () => {
    await writeFile(root, 'data/foo.csv', 'a,b\n1,2\n');
    await writeFile(
      root,
      'data/foo.csv.schema.yaml',
      'columns:\n  a: INTEGER\n  b: 42\n',
    );
    const schema = await loadCsvSchema(root, 'data/foo.csv');
    expect(schema?.columns).toEqual({ a: 'INTEGER' });
  });
});

describe('buildReadCsvSql', () => {
  it('emits a read_csv call with quoted column names and types', () => {
    const sql = buildReadCsvSql('/abs/foo.csv', {
      columns: { a: 'INTEGER', b: 'VARCHAR' },
    });
    expect(sql).toBe(
      `read_csv('/abs/foo.csv', columns = {'a': 'INTEGER', 'b': 'VARCHAR'})`,
    );
  });

  it('includes delim when set', () => {
    const sql = buildReadCsvSql('/abs/x.csv', {
      columns: { a: 'INTEGER' },
      delimiter: '\t',
    });
    expect(sql).toContain(`delim = '\t'`);
  });

  it('includes header when set', () => {
    const sql = buildReadCsvSql('/abs/x.csv', {
      columns: { a: 'INTEGER' },
      header: false,
    });
    expect(sql).toContain('header = false');
  });

  it("doubles single quotes inside the path so a name like it's.csv stays quoted", () => {
    const sql = buildReadCsvSql("/abs/it's.csv", { columns: { a: 'INTEGER' } });
    expect(sql).toContain(`'/abs/it''s.csv'`);
  });
});
