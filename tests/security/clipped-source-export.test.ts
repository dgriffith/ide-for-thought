/**
 * @vitest-environment node
 *
 * M2 of the 2026-10-02 review (#2558), end to end from a hostile-thoughtbase
 * fixture. A clipped web source whose body is live HTML goes through
 * resolvePlan → runExporter for the annotated-reading export. The exported
 * file must carry that HTML as text, with the excerpt still highlighted and
 * the export's own script the only one.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { writeClippedScriptSourceThoughtbase, CLIPPED_SCRIPT_EXCERPT } from '../helpers/hostile-thoughtbase';
import { resolvePlan, runExporter } from '../../src/main/publish/pipeline';
import { annotatedReadingExporter } from '../../src/main/publish/exporters/annotated-reading';

let root = '';
afterEach(() => { if (root) fs.rmSync(root, { recursive: true, force: true }); });

describe('M2: a clipped source can\'t script the annotated-reading export (#2558)', () => {
  it('exports the body\'s HTML as text, keeps the highlight, adds no script', async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-m2-'));
    const fx = writeClippedScriptSourceThoughtbase(root);
    const plan = await resolvePlan(fx.root, { kind: 'source', relativePath: fx.sourceId }, { citationStyle: 'apa' });
    const out = await runExporter(annotatedReadingExporter, plan);
    const html = String(out.files[0]!.contents);
    const body = html.match(/<article class="source-body">([\s\S]*?)<\/article>/)![1]!;

    expect(body).not.toMatch(/<(img|script|svg)\b/i);
    expect(body).not.toMatch(/<[a-z][^>]*\son\w+\s*=/i);
    expect(body).not.toMatch(/<a\b[^>]*javascript:/i);
    expect(body).toContain('&lt;img src=x onerror=');
    expect(body).toMatch(new RegExp(`<mark class="excerpt-hl"[^>]*>${CLIPPED_SCRIPT_EXCERPT}`));
    expect(html.match(/<script>/g)).toHaveLength(1);
  });
});
