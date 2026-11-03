/**
 * Whether this OS has POSIX permission bits (#2180). Windows doesn't: a
 * `chmod 0o600` reads back as `0o666`, and `chmod 0o000` doesn't make a file
 * unreadable. A test that asserts a mode, or simulates an unreadable file with
 * chmod, can only mean something where this is true. What Windows should do
 * instead (an ACL, or saying "protected by your Windows account") is #2190's.
 */
export const HAS_POSIX_MODES = process.platform !== 'win32';
