/**
 * Renderer-side platform detection.
 *
 * The renderer has no `process.platform`, so this sniffs the UA. Determined
 * once at module load — it can't change within a session. Callers that need to
 * vary behaviour in tests should take the flag as a parameter rather than
 * re-reading this.
 */
export const IS_MAC = typeof navigator !== 'undefined'
  ? /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '')
  : process.platform === 'darwin';

export const IS_WINDOWS = typeof navigator !== 'undefined'
  ? /Win/i.test(navigator.platform || navigator.userAgent || '')
  : process.platform === 'win32';

/** The OS has an emoji picker the app can raise: macOS's, and Windows' Win+. panel (#2194). */
export const HAS_EMOJI_PANEL = IS_MAC || IS_WINDOWS;
