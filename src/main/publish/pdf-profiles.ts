/**
 * PDF style profiles (#2429): Notes / Essay / Academic, each a print
 * stylesheet layered on the shared note-html body. Pure CSS paged media, so
 * text stays selectable, links work and the CSL bibliography is the HTML
 * pipeline's own. Used by the single-note PDF (through note-html, when the
 * plan is `paged`) and the note-tree PDF.
 *
 * - **Notes** is the export as it was: the body passes through untouched.
 * - **Essay**: a book face at a ~65ch measure, a title block from the
 *   frontmatter (title, author, date), headings kept with what follows,
 *   figures, tables and code kept whole where they fit.
 * - **Academic**: compact and two-column, with a full-width title block and
 *   abstract (frontmatter `abstract:`, else the first paragraph),
 *   counter-numbered headings, and the references across the full width at
 *   the end.
 *
 * Kept outside both exporters because note-html applies it and note-pdf /
 * tree-pdf choose it, and note-pdf already imports note-html.
 */
import type { PdfProfile } from '../../shared/export-pdf-profiles';
import { escapeHtmlFull as escapeHtml } from '../../shared/text-escape';

export interface ProfiledBody {
  body: string;
  /** Added to the shell's `<style>`, after the base stylesheet. */
  style: string;
  /** Added to `<body>`'s class list; empty for Notes. */
  bodyClass: string;
}

const FIELD = (fm: Record<string, unknown>, key: string): string | null => {
  const v = fm[key];
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (Array.isArray(v)) {
    const parts = v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
    return parts.length ? parts.join(', ') : null;
  }
  return null;
};

/** A leading `<h1>` that repeats the title: the title block says it once. */
function dropLeadingTitle(body: string, title: string): string {
  const m = /^\s*<h1\b[^>]*>([\s\S]*?)<\/h1>\s*/i.exec(body);
  if (!m) return body;
  const text = m[1]!.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').trim();
  return text === title.trim() ? body.slice(m[0].length) : body;
}

/** The first top-level paragraph, taken out of the body to stand as the abstract. */
function takeFirstParagraph(body: string): { abstract: string | null; rest: string } {
  const m = /^\s*<p\b[^>]*>([\s\S]*?)<\/p>/i.exec(body);
  return m ? { abstract: m[1]!, rest: body.slice(m[0].length) } : { abstract: null, rest: body };
}

function titleBlock(title: string, fm: Record<string, unknown>, abstractHtml: string | null): string {
  const author = FIELD(fm, 'author') ?? FIELD(fm, 'authors');
  const date = FIELD(fm, 'date');
  const meta = [author, date].filter((x): x is string => x !== null).map((x) => escapeHtml(x)).join(' · ');
  return `<header class="doc-title-block">
  <h1 class="doc-title">${escapeHtml(title)}</h1>${meta ? `\n  <p class="doc-meta">${meta}</p>` : ''}${abstractHtml ? `\n  <section class="doc-abstract"><h2>Abstract</h2><p>${abstractHtml}</p></section>` : ''}
</header>`;
}

/**
 * Lay a rendered note out for a profile. `title` and `frontmatter` are the
 * note's; `body` is note-html's rendered body, references included.
 * `titleBlock: false` for a body that already has its own title page (the
 * tree PDF's chapters).
 */
export function applyPdfProfile(
  profile: PdfProfile,
  input: { title: string; frontmatter: Record<string, unknown>; body: string; titleBlock?: boolean },
): ProfiledBody {
  if (profile === 'notes') return { body: input.body, style: '', bodyClass: '' };
  const withBlock = input.titleBlock !== false;
  let body = withBlock ? dropLeadingTitle(input.body, input.title) : input.body;
  let abstractHtml: string | null = null;
  if (profile === 'academic' && withBlock) {
    const declared = FIELD(input.frontmatter, 'abstract');
    if (declared) abstractHtml = escapeHtml(declared);
    else ({ abstract: abstractHtml, rest: body } = takeFirstParagraph(body));
  }
  const block = withBlock ? `${titleBlock(input.title, input.frontmatter, abstractHtml)}\n` : '';
  return {
    body: `${block}<div class="doc-body">\n${body}\n</div>`,
    style: profile === 'essay' ? ESSAY_STYLE : ACADEMIC_STYLE,
    bodyClass: `profile-${profile}`,
  };
}

/** What every typeset profile shares: keeping things whole across pages. */
const PAGED = `
.doc-body h1, .doc-body h2, .doc-body h3, .doc-body h4 { break-after: avoid; page-break-after: avoid; }
.doc-body p, .doc-body li { orphans: 3; widows: 3; }
.doc-body figure, .doc-body img, .doc-body pre, .doc-body blockquote, .doc-body .callout { break-inside: avoid; page-break-inside: avoid; }
.doc-body table { break-inside: auto; }
.doc-body tr, .doc-body thead { break-inside: avoid; page-break-inside: avoid; }
.doc-body thead { display: table-header-group; }
.doc-title-block { text-align: center; margin: 0 0 2.4em; }
.doc-title-block .doc-title { font-family: inherit; border-bottom: none; margin: 0 0 0.3em; }
.doc-title-block .doc-meta { margin: 0; color: #555; font-style: italic; }
.export-meta { display: none; }
`;

const ESSAY_STYLE = `${PAGED}
body.profile-essay {
  font-family: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
  font-size: 11.5pt;
  line-height: 1.55;
}
.profile-essay article { max-width: 65ch; }
.profile-essay h1, .profile-essay h2, .profile-essay h3, .profile-essay h4 { font-family: inherit; }
.profile-essay .doc-body h2 { border-bottom: none; font-size: 1.3em; margin-top: 1.8em; }
.profile-essay .doc-title-block .doc-title { font-size: 2.1em; font-weight: normal; }
.profile-essay .doc-body img { max-width: 100%; max-height: 60vh; object-fit: contain; }
.profile-essay .doc-body p { hyphens: auto; }
`;

const ACADEMIC_STYLE = `${PAGED}
body.profile-academic {
  font-family: "Times New Roman", Times, "Iowan Old Style", Georgia, serif;
  font-size: 9.5pt;
  line-height: 1.4;
}
.profile-academic article { max-width: none; }
.profile-academic h1, .profile-academic h2, .profile-academic h3, .profile-academic h4 { font-family: inherit; }
.profile-academic .doc-title-block { margin-bottom: 1.6em; }
.profile-academic .doc-title-block .doc-title { font-size: 1.7em; }
.profile-academic .doc-abstract { max-width: 80%; margin: 1.2em auto 0; text-align: justify; font-size: 0.95em; }
.profile-academic .doc-abstract h2 { font-size: 1em; text-transform: uppercase; letter-spacing: 0.06em; border-bottom: none; text-align: center; margin: 0 0 0.4em; }
.profile-academic .doc-body { column-count: 2; column-gap: 1.8em; text-align: justify; hyphens: auto; counter-reset: sec; }
.profile-academic .doc-body h1, .profile-academic .doc-body h2 { font-size: 1.15em; border-bottom: none; margin: 1.2em 0 0.4em; counter-increment: sec; counter-reset: sub; }
.profile-academic .doc-body h3 { font-size: 1em; counter-increment: sub; }
.profile-academic .doc-body h1::before, .profile-academic .doc-body h2::before { content: counter(sec) ". "; }
.profile-academic .doc-body h3::before { content: counter(sec) "." counter(sub) " "; }
.profile-academic .doc-body .references h2::before, .profile-academic .doc-body .footnotes h2::before { content: none; }
.profile-academic .doc-body .references, .profile-academic .doc-body .footnotes { column-span: all; text-align: left; }
.profile-academic .doc-body img, .profile-academic .doc-body table, .profile-academic .doc-body pre { max-width: 100%; }
.profile-academic .doc-body pre { font-size: 0.85em; white-space: pre-wrap; }
`;
