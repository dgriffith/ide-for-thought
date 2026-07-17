import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  readThoughtbaseDoc,
  thoughtbaseDocPromptBlock,
  THOUGHTBASE_DOC_FILENAME,
} from '../../../src/main/llm/thoughtbase-doc';

describe('readThoughtbaseDoc', () => {
  let root: string;
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-thoughtbase-'));
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('returns the trimmed contents when the file exists', async () => {
    await fs.writeFile(path.join(root, THOUGHTBASE_DOC_FILENAME), '\n# My thoughtbase\n\nConventions here.\n', 'utf-8');
    expect(await readThoughtbaseDoc(root)).toBe('# My thoughtbase\n\nConventions here.');
  });

  it('returns null when the file is absent (opt-in)', async () => {
    expect(await readThoughtbaseDoc(root)).toBeNull();
  });

  it('returns null for an empty / whitespace-only file', async () => {
    await fs.writeFile(path.join(root, THOUGHTBASE_DOC_FILENAME), '   \n\t\n', 'utf-8');
    expect(await readThoughtbaseDoc(root)).toBeNull();
  });
});

describe('thoughtbaseDocPromptBlock', () => {
  it('is empty when there is nothing to inject', () => {
    expect(thoughtbaseDocPromptBlock(null)).toBe('');
    expect(thoughtbaseDocPromptBlock('')).toBe('');
  });

  it('labels the block and includes the doc contents verbatim', () => {
    const block = thoughtbaseDocPromptBlock('Prefer wiki-links over tags.');
    expect(block).toContain(THOUGHTBASE_DOC_FILENAME);
    expect(block).toContain('written by the user');
    expect(block).toContain('Prefer wiki-links over tags.');
    // The contents come last so the model reads the label, then the doc.
    expect(block.trimEnd().endsWith('Prefer wiki-links over tags.')).toBe(true);
  });
});
