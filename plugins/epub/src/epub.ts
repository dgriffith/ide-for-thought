/**
 * An EPUB 3 book from an export plan (#2648): one chapter per note, in the
 * plan's order, with a table of contents. Pure — the files of the book as
 * text; `logic.ts` zips them.
 *
 * Minerva hands each note as the HTML it renders for export. EPUB wants
 * XHTML, so every tag is rewritten: attributes quoted, void elements closed,
 * named entities made numeric. A link to another exported note goes to its
 * chapter; an image that isn't embedded (`data:`) becomes its alt text, since
 * the book can't carry the file.
 */
import type { PluginExportPlan } from '../../../src/shared/plugins/format';

export interface EpubFile {
  path: string;
  text: string;
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
/** XML knows these five; every other named entity is written as a number. */
const XML_ENTITIES = new Set(['amp', 'lt', 'gt', 'quot', 'apos']);
const NAMED: Record<string, number> = {
  nbsp: 0xa0, copy: 0xa9, reg: 0xae, trade: 0x2122, hellip: 0x2026, mdash: 0x2014, ndash: 0x2013,
  lsquo: 0x2018, rsquo: 0x2019, ldquo: 0x201c, rdquo: 0x201d, laquo: 0xab, raquo: 0xbb, times: 0xd7,
  middot: 0xb7, bull: 0x2022, deg: 0xb0, para: 0xb6, sect: 0xa7, shy: 0xad, thinsp: 0x2009, larr: 0x2190, rarr: 0x2192,
};

export function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fixEntities(text: string): string {
  return text.replace(/&(#?[A-Za-z0-9]+);?/g, (whole, name: string) => {
    if (name.startsWith('#')) return whole.endsWith(';') ? whole : `&${name};`;
    if (XML_ENTITIES.has(name)) return `&${name};`;
    const code = NAMED[name];
    return code !== undefined ? `&#${code};` : `&amp;${whole.slice(1)}`;
  });
}

const ATTR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

/** One HTML tag's attributes, each with a value (a bare one gets its own name, as XHTML spells `checked`). */
function attributes(src: string): [string, string][] {
  const out: [string, string][] = [];
  for (const m of src.matchAll(ATTR)) {
    const name = m[1]!.toLowerCase();
    if (out.some(([n]) => n === name)) continue;
    out.push([name, m[2] ?? m[3] ?? m[4] ?? name]);
  }
  return out;
}

/**
 * HTML as XHTML. `rewrite` may change an element's attributes, or replace
 * the element with text (returning a string).
 */
export function toXhtml(html: string, rewrite: (tag: string, attrs: [string, string][]) => [string, string][] | string = (_t, a) => a): string {
  let out = '';
  let last = 0;
  const TAG = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][A-Za-z0-9:-]*)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/g;
  for (const m of html.matchAll(TAG)) {
    out += fixEntities(html.slice(last, m.index));
    last = m.index + m[0].length;
    if (m[0].startsWith('<!--')) continue; // a comment: dropped, it may hold "--"
    const [, close, rawName, rawAttrs = ''] = m;
    const tag = rawName!.toLowerCase();
    if (close) {
      if (!VOID.has(tag)) out += `</${tag}>`;
      continue;
    }
    const attrs = rewrite(tag, attributes(rawAttrs));
    if (typeof attrs === 'string') {
      out += escapeXml(attrs);
      continue;
    }
    const written = attrs.map(([n, v]) => ` ${n}="${escapeXml(fixEntitiesInValue(v))}"`).join('');
    out += VOID.has(tag) || m[4] ? `<${tag}${written}/>` : `<${tag}${written}>`;
  }
  return out + fixEntities(html.slice(last));
}

/** An attribute value as text: its entities decoded, so `escapeXml` writes each once. */
function fixEntitiesInValue(v: string): string {
  return v.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    if (name[0] === '#') {
      const code = name[1] === 'x' || name[1] === 'X' ? parseInt(name.slice(2), 16) : parseInt(name.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    const known: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    return known[name] ?? (NAMED[name] !== undefined ? String.fromCodePoint(NAMED[name]) : whole);
  });
}

/** `a/b/c.md` → `a/b/c.html`: where the HTML exporter would have put it, which is what its links point at. */
const htmlPathOf = (notePath: string) => notePath.replace(/\.md$/i, '.html');

function resolveRelative(fromFile: string, href: string): string {
  const parts = fromFile.split('/').slice(0, -1);
  for (const seg of href.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.' && seg !== '') parts.push(seg);
  }
  return parts.join('/');
}

const chapterFile = (i: number) => `chapter-${String(i + 1).padStart(3, '0')}.xhtml`;

/** A file name for the book, from its title. */
export function bookFilename(title: string): string {
  const printable = [...title].map((c) => (c < ' ' ? ' ' : c)).join('');
  const safe = printable.replace(/[\\/:*?"<>|]+/g, ' ').replace(/^[.\s]+/, '').replace(/\s+/g, ' ').trim();
  return `${(safe || 'Export').slice(0, 100)}.epub`;
}

/** A stable id for the same notes exported twice (FNV-1a over the paths and title). */
function bookId(plan: PluginExportPlan): string {
  let h = 0x811c9dc5;
  for (const ch of `${plan.title}\n${plan.notes.map((n) => n.path).join('\n')}`) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `urn:minerva:epub:${h.toString(16).padStart(8, '0')}`;
}

const STYLE = `body { font-family: serif; line-height: 1.5; margin: 0 5%; }
h1, h2, h3 { font-family: sans-serif; line-height: 1.2; }
pre, code { font-family: monospace; font-size: 0.9em; }
pre { white-space: pre-wrap; }
blockquote { margin-left: 1.5em; font-style: italic; }
table { border-collapse: collapse; }
td, th { border: 1px solid #999; padding: 0.2em 0.5em; }
img { max-width: 100%; }
`;

function chapter(title: string, body: string, lang: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}" xml:lang="${lang}">
<head>
<meta charset="UTF-8"/>
<title>${escapeXml(title)}</title>
<link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
<section epub:type="chapter">
${body}
</section>
</body>
</html>
`;
}

/** The book's language: a note's `lang` or `language`, else English. */
function bookLanguage(plan: PluginExportPlan): string {
  for (const n of plan.notes) {
    const v = n.frontmatter.lang ?? n.frontmatter.language;
    if (typeof v === 'string' && /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(v)) return v;
  }
  return 'en';
}

/** The book's files, `mimetype` first, as an EPUB's zip needs them. */
export function buildEpub(plan: PluginExportPlan, now = new Date()): EpubFile[] {
  const lang = bookLanguage(plan);
  const chapters = new Map(plan.notes.map((n, i) => [htmlPathOf(n.path), chapterFile(i)]));
  const files: EpubFile[] = [
    { path: 'mimetype', text: 'application/epub+zip' },
    {
      path: 'META-INF/container.xml',
      text: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles>
</container>
`,
    },
    { path: 'OEBPS/style.css', text: STYLE },
  ];

  plan.notes.forEach((note, i) => {
    const from = htmlPathOf(note.path);
    let body = toXhtml(note.html ?? '', (tag, attrs) => {
      if (tag === 'img') {
        const src = attrs.find(([n]) => n === 'src')?.[1] ?? '';
        if (!src.startsWith('data:')) return attrs.find(([n]) => n === 'alt')?.[1] ?? '';
      }
      if (tag === 'a') {
        return attrs.map(([n, v]): [string, string] => {
          if (n !== 'href' || /^[a-z][a-z0-9+.-]*:/i.test(v) || v.startsWith('#')) return [n, v];
          const [target, hash] = v.split('#') as [string, string | undefined];
          const ch = chapters.get(resolveRelative(from, decodeURI(target)));
          return [n, ch ? `${ch}${hash ? `#${hash}` : ''}` : v];
        });
      }
      return attrs;
    });
    if (!/^\s*<h1[\s>]/.test(body)) body = `<h1>${escapeXml(note.title)}</h1>\n${body}`;
    files.push({ path: `OEBPS/${chapterFile(i)}`, text: chapter(note.title, body, lang) });
  });

  const nav = plan.notes.map((n, i) => `      <li><a href="${chapterFile(i)}">${escapeXml(n.title)}</a></li>`).join('\n');
  files.push({
    path: 'OEBPS/nav.xhtml',
    text: chapter('Contents', `<nav epub:type="toc" id="toc">\n  <h1>Contents</h1>\n  <ol>\n${nav}\n  </ol>\n</nav>`, lang),
  });

  const author = plan.notes.map((n) => n.frontmatter.author).find((a): a is string => typeof a === 'string' && a.trim() !== '');
  const modified = now.toISOString().replace(/\.\d+Z$/, 'Z');
  const items = plan.notes.map((_n, i) => `    <item id="c${i + 1}" href="${chapterFile(i)}" media-type="application/xhtml+xml"/>`).join('\n');
  const spine = plan.notes.map((_n, i) => `    <itemref idref="c${i + 1}"/>`).join('\n');
  files.push({
    path: 'OEBPS/content.opf',
    text: `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="book-id">${bookId(plan)}</dc:identifier>
    <dc:title>${escapeXml(plan.title)}</dc:title>
    <dc:language>${lang}</dc:language>
${author ? `    <dc:creator>${escapeXml(author)}</dc:creator>\n` : ''}    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="style" href="style.css" media-type="text/css"/>
${items}
  </manifest>
  <spine>
${spine}
  </spine>
</package>
`,
  });
  return files;
}
