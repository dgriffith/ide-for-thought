/**
 * The colour tokens a theme may set (#2787): every custom property the
 * built-in themes define in `src/renderer/styles/global.css`, except type,
 * stacking order and blur — a theme recolours Minerva, it doesn't restyle
 * it. `tests/shared/theme-tokens.test.ts` checks this list against the
 * stylesheet in both directions, so a token added there must be added here.
 */
export const THEME_TOKENS: readonly string[] = [
  '--bg', '--bg-elev', '--bg-elev-2', '--bg-inset',
  '--text', '--text-muted', '--text-faint',
  '--border', '--border-strong',
  '--accent', '--accent-dim', '--accent-ink',
  '--sage', '--rust', '--iris',
  '--hl-yellow', '--hl-green', '--hl-blue', '--hl-pink', '--hl-orange',
  '--bg-titlebar', '--bg-sidebar', '--bg-button', '--bg-button-hover', '--bg-tabbar', '--bg-toolbar',
  '--titlebar-text', '--titlebar-text-muted', '--titlebar-button', '--titlebar-button-hover',
  '--bg-appbar', '--appbar-text', '--appbar-text-muted', '--appbar-text-faint', '--appbar-accent',
  '--appbar-border', '--appbar-border-strong', '--appbar-inset',
  '--bg-code',
  '--scrim-bg',
];

/**
 * The aliases `:root` declares (`--bg-titlebar: var(--bg-elev)`): a theme that
 * sets `--bg-elev` and not `--bg-titlebar` changes both, so the contrast check
 * follows them. Held to the stylesheet by the same test.
 */
export const THEME_TOKEN_ALIASES: Readonly<Record<string, string>> = {
  '--bg-titlebar': '--bg-elev',
  '--bg-sidebar': '--bg-elev',
  '--bg-button': '--bg-elev-2',
  '--bg-button-hover': '--border-strong',
  '--bg-tabbar': '--bg-elev',
  '--bg-toolbar': '--bg-elev',
  '--titlebar-text': '--text',
  '--titlebar-text-muted': '--text-muted',
  '--titlebar-button': '--bg-button',
  '--titlebar-button-hover': '--bg-button-hover',
  '--bg-appbar': '--bg',
  '--appbar-text': '--text',
  '--appbar-text-muted': '--text-muted',
  '--appbar-text-faint': '--text-faint',
  '--appbar-accent': '--accent',
  '--appbar-border': '--border',
  '--appbar-border-strong': '--border-strong',
  '--appbar-inset': '--bg-inset',
};

/** Text on surface, as the app pairs them — what the contrast check measures. */
export const THEME_CONTRAST_PAIRS: ReadonlyArray<readonly [text: string, surface: string]> = [
  ['--text', '--bg'],
  ['--text-muted', '--bg'],
  ['--text-faint', '--bg'],
  ['--text', '--bg-elev'],
  ['--text-muted', '--bg-elev'],
  ['--text', '--bg-elev-2'],
  ['--text', '--bg-inset'],
  ['--accent', '--bg'],
  ['--accent-ink', '--accent'],
  ['--titlebar-text', '--bg-titlebar'],
  ['--appbar-text', '--bg-appbar'],
];
