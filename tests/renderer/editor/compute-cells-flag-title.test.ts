/**
 * Editor red-flag marker tooltip (#1413).
 *
 * `flagTitleFor` is the pure logic behind the gutter run-marker's flagged
 * state — the CodeMirror marker itself is trivial glue over it, so this pins
 * the behavior directly: clean cell → null (plain "Run cell"); risky cell →
 * a caution title listing the matched patterns.
 */
import { describe, it, expect } from 'vitest';
import { flagTitleFor } from '../../../src/renderer/lib/editor/compute-cells';

describe('flagTitleFor (#1413)', () => {
  it('returns null for a clean cell', () => {
    expect(flagTitleFor('python', 'x = 1 + 1\nprint(x)')).toBeNull();
    expect(flagTitleFor('sql', 'SELECT count(*) FROM notes')).toBeNull();
    expect(flagTitleFor('sparql', 'SELECT * WHERE { ?s ?p ?o }')).toBeNull();
  });

  it('lists the matched patterns (backticks stripped) for a risky Python cell', () => {
    const title = flagTitleFor('python', 'import subprocess\nsubprocess.run(["ls"])');
    expect(title).toContain('Risky patterns:');
    expect(title).toContain('subprocess');
    expect(title).not.toContain('`'); // plain-text tooltip, not markdown
  });

  it('flags a risky SQL cell too', () => {
    const title = flagTitleFor('sql', "COPY (SELECT * FROM t) TO 'https://x/y.csv'");
    expect(title).toContain('COPY');
  });
});
