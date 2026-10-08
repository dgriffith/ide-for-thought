/**
 * Audio recordings in the graph (#2730): an embedded recording becomes a
 * minerva:AudioRecording with its path, start time, length and whether it has
 * a transcript, linked from the note that embeds it.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexNote, removeNote, queryGraph } from '../../../src/main/graph/index';
import { withWebmDuration } from '../../../src/shared/webm-duration';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';
import { mediaRecorderFile } from '../../helpers/webm-fixture';

type Row = Record<string, string>;

async function rows(ctx: ProjectContext, sparql: string): Promise<Row[]> {
  const { results } = await queryGraph(ctx, sparql);
  return results as Row[];
}

const RECORDINGS = `
  SELECT ?note ?path ?at ?secs ?t WHERE {
    ?n minerva:embeds ?r ; minerva:relativePath ?note .
    ?r a minerva:AudioRecording ; minerva:relativePath ?path .
    OPTIONAL { ?r minerva:recordedAt ?at }
    OPTIONAL { ?r minerva:durationSeconds ?secs }
    OPTIONAL { ?r minerva:hasTranscript ?t }
  } ORDER BY ?path
`;

describe('recordings in the graph (#2730)', () => {
  const project = useGraphProject('minerva-recordings-index-');
  let ctx: ProjectContext;
  let root: string;

  beforeEach(() => {
    ctx = project.ctx;
    root = project.root;
    const dir = path.join(root, 'assets/recordings');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '2026-10-08-1432.weba'), withWebmDuration(mediaRecorderFile(), 93_250));
  });

  it('indexes an embedded recording with its start time and length', async () => {
    await indexNote(ctx, 'meetings/standup.md', '# Standup\n\n![](../assets/recordings/2026-10-08-1432.weba)\n');
    expect(await rows(ctx, RECORDINGS)).toEqual([{
      note: 'meetings/standup.md',
      path: 'assets/recordings/2026-10-08-1432.weba',
      at: '2026-10-08T14:32:00',
      secs: '93.25',
    }]);
  });

  it('marks a recording that has a transcript, and finds the ones that do not', async () => {
    await indexNote(ctx, 'a.md', [
      '![](assets/recordings/2026-10-08-1432.weba)',
      '',
      '> [!transcript]- Transcript',
      '> We agreed to ship.',
      '',
      '![](assets/recordings/voice%20memo.mp3)',
    ].join('\n'));
    const all = await rows(ctx, RECORDINGS);
    expect(all.map((r) => [r.path, r.t ?? null])).toEqual([
      ['assets/recordings/2026-10-08-1432.weba', 'true'],
      ['assets/recordings/voice memo.mp3', null],
    ]);
    // A file Minerva didn't name has no start time, and one that isn't on disk no length.
    expect(all[1]!.at).toBeUndefined();
    expect(all[1]!.secs).toBeUndefined();

    const untranscribed = await rows(ctx, `
      SELECT ?path WHERE {
        ?r a minerva:AudioRecording ; minerva:relativePath ?path .
        FILTER NOT EXISTS { ?r minerva:hasTranscript true }
      }
    `);
    expect(untranscribed.map((r) => r.path)).toEqual(['assets/recordings/voice memo.mp3']);
  });

  it('drops the triples when the embed is removed or the note is deleted', async () => {
    await indexNote(ctx, 'a.md', '![](assets/recordings/2026-10-08-1432.weba)\n');
    await indexNote(ctx, 'b.md', '![](assets/recordings/2026-10-08-1432.weba)\n');
    expect(await rows(ctx, RECORDINGS)).toHaveLength(2);

    await indexNote(ctx, 'a.md', 'No recording any more.\n');
    expect((await rows(ctx, RECORDINGS)).map((r) => r.note)).toEqual(['b.md']);

    removeNote(ctx, 'b.md');
    expect(await rows(ctx, RECORDINGS)).toEqual([]);
  });

  it('ignores images, video, URLs and paths that leave the thoughtbase', async () => {
    await indexNote(ctx, 'a.md', [
      '![](pic.png)',
      '![](clip.webm)',
      '![](https://example.com/talk.mp3)',
      '![](../outside.weba)',
      '![](../../../etc/thing.mp3)',
    ].join('\n'));
    expect(await rows(ctx, RECORDINGS)).toEqual([]);
  });

  it('reads no length through an in-root symlink that points outside', async () => {
    const outside = path.join(root, '..', `outside-${path.basename(root)}.weba`);
    fs.writeFileSync(outside, withWebmDuration(mediaRecorderFile(), 5_000));
    fs.symlinkSync(outside, path.join(root, 'assets/recordings/linked.weba'));
    try {
      await indexNote(ctx, 'a.md', '![](assets/recordings/linked.weba)\n');
      const [rec] = await rows(ctx, RECORDINGS);
      expect(rec!.path).toBe('assets/recordings/linked.weba');
      expect(rec!.secs).toBeUndefined();
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });
});
