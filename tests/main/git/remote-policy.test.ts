/**
 * Which publish remotes may receive credentials (#2556) — the pure rules.
 */
import { describe, it, expect } from 'vitest';
import {
  ambientTokenAllowed,
  normalizeRemoteToHttps,
  parsePublishRemote,
  publishRemoteHref,
} from '../../../src/main/git/remote-policy';

describe('parsePublishRemote (#2556)', () => {
  it('accepts https, and rewrites the SSH spellings to it', () => {
    expect(parsePublishRemote('https://github.com/o/r.git').href).toBe('https://github.com/o/r.git');
    expect(parsePublishRemote('git@github.com:o/r.git').href).toBe('https://github.com/o/r.git');
    expect(parsePublishRemote('ssh://git@gitlab.com/o/r').href).toBe('https://gitlab.com/o/r');
    expect(parsePublishRemote('  https://codeberg.org/o/r.git  ').host).toBe('codeberg.org');
  });

  it('refuses http:// — the token would travel in the clear', () => {
    expect(() => parsePublishRemote('http://github.com/o/r.git')).toThrow(/plain http:\/\/.*unencrypted/);
  });

  it('refuses other schemes, garbage, and URLs carrying their own credentials', () => {
    expect(() => parsePublishRemote('file:///tmp/repo')).toThrow(/https:\/\/ only/);
    expect(() => parsePublishRemote('git://github.com/o/r')).toThrow(/https:\/\/ only/);
    expect(() => parsePublishRemote('not a url')).toThrow(/isn't a git remote URL/);
    expect(() => parsePublishRemote('https://user:pw@github.com/o/r.git')).toThrow(/user name or password/);
  });

  it('publishRemoteHref is the same rule without throwing', () => {
    expect(publishRemoteHref('git@github.com:o/r.git')).toBe('https://github.com/o/r.git');
    expect(publishRemoteHref('http://github.com/o/r.git')).toBeNull();
    expect(publishRemoteHref('nope')).toBeNull();
    expect(publishRemoteHref('https://u@github.com/o/r')).toBeNull();
  });

  it('normalizeRemoteToHttps leaves http(s) alone for the policy to judge', () => {
    expect(normalizeRemoteToHttps('http://x.example/r')).toBe('http://x.example/r');
  });
});

describe('ambientTokenAllowed (#2556)', () => {
  it('allows github.com (and www.) only, judged by the parsed host', () => {
    expect(ambientTokenAllowed(new URL('https://github.com/o/r.git'))).toBe(true);
    expect(ambientTokenAllowed(new URL('https://GitHub.com/o/r.git'))).toBe(true);
    expect(ambientTokenAllowed(new URL('https://www.github.com/o/r.git'))).toBe(true);
    expect(ambientTokenAllowed(new URL('https://gitlab.com/o/r.git'))).toBe(false);
    expect(ambientTokenAllowed(new URL('https://github.com.attacker.example/r.git'))).toBe(false);
    expect(ambientTokenAllowed(new URL('https://attacker.example/github.com/r.git'))).toBe(false);
    // Userinfo that looks like a host is not the host.
    expect(ambientTokenAllowed(new URL('https://github.com@attacker.example/r.git'))).toBe(false);
  });
});
