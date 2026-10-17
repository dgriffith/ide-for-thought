/**
 * PDF style profiles (#2429): how a note is typeset when it's exported as a
 * PDF. Chosen in the export dialog for the PDF formats, remembered per
 * thoughtbase. Each is a print stylesheet over the same rendered note
 * (`main/publish/pdf-profiles.ts`), so links, images and the CSL
 * bibliography come through every one.
 */

export const PDF_PROFILES = [
  { id: 'notes', label: 'Notes', description: 'The page as it looks in Minerva.' },
  { id: 'essay', label: 'Essay', description: 'A single-column reading layout, with a title block from the note\'s title, author and date.' },
  { id: 'academic', label: 'Academic', description: 'Compact and two-column, with numbered headings and an abstract.' },
] as const;

export type PdfProfile = (typeof PDF_PROFILES)[number]['id'];

export const DEFAULT_PDF_PROFILE: PdfProfile = 'notes';

export function isPdfProfile(value: unknown): value is PdfProfile {
  return typeof value === 'string' && PDF_PROFILES.some((p) => p.id === value);
}
