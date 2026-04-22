/**
 * Page-setup option assembly for the PDF exporter (#249).
 *
 * Pure so the default-selection logic is unit-testable without an
 * Electron runtime. `printToPDF` accepts a rich options object; this
 * module normalises the user's preferences (or the locale-based
 * defaults) into the shape Electron expects.
 */

export type PageSize = 'Letter' | 'A4' | 'Legal' | 'Tabloid';
export type Margins = 'normal' | 'narrow' | 'wide' | 'none';
export type Orientation = 'portrait' | 'landscape';

export interface PdfRenderOptions {
  pageSize: PageSize;
  margins: Margins;
  orientation: Orientation;
  /** Percent zoom; 100 = no scaling. Clamped to 50–200 at assembly time. */
  scale: number;
  /** Include page-number footer + title header. Both are off by default. */
  headerFooter: boolean;
  /** Visible in header/footer when `headerFooter` is on. */
  title?: string;
}

/**
 * Normalised shape handed to `webContents.printToPDF`. Kept in sync with
 * Electron's documented option names so the renderer module is thin.
 */
export interface PrintToPdfArgs {
  pageSize: PageSize;
  landscape: boolean;
  scale: number;
  margins: { top: number; right: number; bottom: number; left: number };
  /** 0 = off (Electron docs use a boolean-ish `displayHeaderFooter`). */
  displayHeaderFooter: boolean;
  headerTemplate?: string;
  footerTemplate?: string;
  /** Tell Electron to emit a selectable-text PDF, not a rasterized image. */
  generateDocumentOutline?: boolean;
  printBackground?: boolean;
}

/**
 * Resolve defaults for a given locale. en-US uses Letter; everyone else
 * gets A4. Locale strings that don't carry a country code still match
 * — `en` or `en-GB` → A4.
 */
export function defaultsForLocale(locale: string): Pick<PdfRenderOptions, 'pageSize'> {
  const norm = locale.toLowerCase().replace('_', '-');
  const letterLocales = ['en-us', 'en-ca'];
  return {
    pageSize: letterLocales.includes(norm) ? 'Letter' : 'A4',
  };
}

/**
 * Merge user preferences with locale defaults into a canonical
 * PdfRenderOptions. Clamps scale and falls back to portrait + normal
 * margins when a caller passes garbage.
 */
export function resolveRenderOptions(
  locale: string,
  overrides: Partial<PdfRenderOptions> = {},
): PdfRenderOptions {
  const localeDefaults = defaultsForLocale(locale);
  return {
    pageSize: overrides.pageSize ?? localeDefaults.pageSize,
    margins: overrides.margins ?? 'normal',
    orientation: overrides.orientation ?? 'portrait',
    scale: clamp(overrides.scale ?? 100, 50, 200),
    headerFooter: overrides.headerFooter ?? false,
    title: overrides.title,
  };
}

/**
 * Convert resolved options into the exact shape Electron's
 * `webContents.printToPDF` wants. Margin presets are in inches.
 */
export function toPrintToPdfArgs(opts: PdfRenderOptions): PrintToPdfArgs {
  const margins = MARGIN_PRESETS[opts.margins];
  const args: PrintToPdfArgs = {
    pageSize: opts.pageSize,
    landscape: opts.orientation === 'landscape',
    scale: opts.scale / 100,
    margins,
    displayHeaderFooter: opts.headerFooter,
    generateDocumentOutline: true,
    printBackground: true,
  };
  if (opts.headerFooter) {
    // Electron's header/footer templates are HTML strings. Common
    // class-names — `title`, `pageNumber`, `totalPages` — are
    // substituted by Chromium at print time.
    const safeTitle = escapeHtml(opts.title ?? '');
    args.headerTemplate = `<div style="font-size:9px;width:100%;padding:0 12mm;color:#666;"><span class="title">${safeTitle}</span></div>`;
    args.footerTemplate = `<div style="font-size:9px;width:100%;padding:0 12mm;color:#666;text-align:center;"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`;
  }
  return args;
}

const MARGIN_PRESETS: Record<Margins, PrintToPdfArgs['margins']> = {
  none: { top: 0, right: 0, bottom: 0, left: 0 },
  narrow: { top: 0.5, right: 0.5, bottom: 0.5, left: 0.5 },
  normal: { top: 1.0, right: 1.0, bottom: 1.0, left: 1.0 },
  wide: { top: 1.5, right: 1.5, bottom: 1.5, left: 1.5 },
};

function clamp(n: number, min: number, max: number): number {
  if (Number.isNaN(n)) return min;
  return Math.min(max, Math.max(min, n));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
