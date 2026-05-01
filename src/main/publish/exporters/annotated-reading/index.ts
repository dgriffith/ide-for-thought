/**
 * Annotated-reading exporter (#253).
 *
 * Source body on the left, excerpt highlights aligned to their cited
 * passages, margin pane with citation block + related notes +
 * per-excerpt cards on the right. The "my annotated copy" artifact
 * Minerva is uniquely shaped to produce.
 *
 * v1 ships HTML only. PDF inherits via the PDF exporter's general
 * "rasterise an HTML file" path; a dedicated `annotated-reading-pdf`
 * exporter that hand-tunes page-break behaviour is a follow-up.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { resolveAnnotatedReading } from './resolve';
import { renderAnnotatedReading } from './render';
import type { Exporter, ExportPlanFile } from '../../types';

export const annotatedReadingExporter: Exporter = {
  id: 'annotated-reading-html',
  label: 'Annotated Source as HTML',
  // Source-only — needs a single source's body + its excerpts.
  accepts: (input) => input.kind === 'source',
  acceptedKinds: ['source'],
  async run(plan) {
    const rootPath = plan.rootPath ?? '';
    // The pipeline puts the source body in a single ExportPlanFile
    // when input.kind is 'source'. Pull it out + derive the source id
    // from the path shape (`.minerva/sources/<id>/body.md`).
    const sourceFile = plan.inputs.find((f) => f.kind === 'source');
    if (!sourceFile) {
      return { files: [], summary: 'No source body found.' };
    }
    const sourceId = sourceIdFromPath(sourceFile.relativePath);
    if (!sourceId) {
      return { files: [], summary: `Couldn't derive source id from path: ${sourceFile.relativePath}` };
    }

    // We also want every project note for backlink resolution.
    // resolvePlan only loaded the source body for input.kind 'source',
    // so walk the project here for inbound-link analysis.
    const projectNotes = await loadProjectNotes(rootPath);

    const data = await resolveAnnotatedReading(rootPath, sourceId, sourceFile.content, projectNotes);
    // CSL renderer for the source citation block — text-or-html flips
    // depending on output. Annotated reading is HTML-shaped.
    const renderer = plan.citations?.createRenderer() ?? null;
    const sourceTitle = sourceFile.title || sourceId;
    const { html, unalignedExcerpts } = renderAnnotatedReading({
      data,
      sourceTitle,
      renderer,
    });

    const files = [{ path: `${slugify(sourceTitle)}-annotated.html`, contents: html }];
    const unalignedSuffix = unalignedExcerpts.length > 0
      ? ` (${unalignedExcerpts.length} excerpt${unalignedExcerpts.length === 1 ? '' : 's'} couldn't align to body)`
      : '';
    const summary = `Annotated reading for "${sourceTitle}" — ${data.excerpts.length} excerpt${data.excerpts.length === 1 ? '' : 's'}, ${data.relatedNotes.length} related note${data.relatedNotes.length === 1 ? '' : 's'}${unalignedSuffix}.`;
    return { files, summary };
  },
};

/**
 * `.minerva/sources/<id>/body.md` → `<id>`. Returns null when the
 * path doesn't match the expected shape.
 */
function sourceIdFromPath(relativePath: string): string | null {
  const m = relativePath.match(/^\.minerva\/sources\/([^/]+)\/body\.md$/);
  return m ? m[1] : null;
}

/**
 * Walk the project root for every `.md` file, parse minimal headers,
 * and return ExportPlanFile shells. Keeps the resolver decoupled
 * from `resolvePlan`'s exclusion logic — annotation resolution
 * doesn't need to know about private filtering since the source-mode
 * pipeline already gives us a vetted source body, and the resolver
 * filters its own backlink list.
 */
async function loadProjectNotes(rootPath: string): Promise<ExportPlanFile[]> {
  const notes: ExportPlanFile[] = [];
  await walk(rootPath, '', notes);
  return notes;
}

async function walk(rootPath: string, sub: string, out: ExportPlanFile[]): Promise<void> {
  const dir = path.join(rootPath, sub);
  let entries: Array<{ name: string; isFile: () => boolean; isDirectory: () => boolean }>;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const rel = sub ? `${sub}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      await walk(rootPath, rel, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      let content: string;
      try { content = await fs.readFile(path.join(rootPath, rel), 'utf-8'); } catch { continue; }
      out.push({
        relativePath: rel,
        kind: 'note',
        content,
        frontmatter: {},
        title: titleFromContent(content, entry.name),
      });
    }
  }
}

function titleFromContent(content: string, fallbackName: string): string {
  // Frontmatter title wins; first H1 fallback; else filename stem.
  const fm = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fm) {
    const t = fm[1].match(/^title:\s*(.+)$/m);
    if (t) return t[1].trim().replace(/^['"]|['"]$/g, '');
  }
  const h1 = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '').match(/^#\s+(.+?)\s*$/m);
  if (h1) return h1[1];
  return fallbackName.replace(/\.md$/i, '');
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'source';
}
