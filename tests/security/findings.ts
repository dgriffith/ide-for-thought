/**
 * Every High and Medium finding of the 2026-10-02 whole-project security
 * review, mapped to the hostile-thoughtbase fixture that reproduces it and
 * the tests that fail if its fix regresses (#2570).
 * `findings-coverage.test.ts` holds this list to the code: each test file
 * must exist, and must use the named fixture.
 *
 * A finding whose attack doesn't travel inside a thoughtbase (a main-process
 * environment, a session's permission handler, the app bundle) has
 * `fixture: null` and says why. Its regression tests still have to exist.
 */
export interface SecurityFinding {
  id: string;
  summary: string;
  /** The issue whose fix closed it. */
  fixedBy: number;
  /** An export of tests/helpers/hostile-thoughtbase.ts, or null with `noFixture`. */
  fixture: string | null;
  noFixture?: string;
  /** Repo-relative test files; at least one must use `fixture` when it is set. */
  tests: string[];
}

export const FINDINGS: SecurityFinding[] = [
  {
    id: 'H1',
    summary: 'The main window navigates to arbitrary file:// HTML, which inherits the preload bridge',
    fixedBy: 2552,
    fixture: 'writeLocalHtmlLureThoughtbase',
    tests: ['tests/security/local-html-lure.test.ts', 'tests/main/security-helpers.test.ts', 'tests/e2e/navigation-guard.spec.ts'],
  },
  {
    id: 'H2',
    summary: 'Thoughtbase .py files run in the Python kernel before any consented code',
    fixedBy: 2555,
    fixture: 'writePythonShadowThoughtbase',
    tests: ['tests/main/compute/python-kernel-shadowing.test.ts'],
  },
  {
    id: 'H3',
    summary: 'The publish credential is sent to a remote URL the shared thoughtbase chose',
    fixedBy: 2556,
    fixture: 'writeForeignPublishRemoteConfig',
    tests: ['tests/main/publish/publish-foreign-remote.test.ts'],
  },
  {
    id: 'M1',
    summary: '<style> survives note sanitization (UI redress of the approval controls)',
    fixedBy: 2557,
    fixture: 'STYLE_REDRESS_NOTE',
    tests: ['tests/renderer/preview/sanitize-note-html.test.ts', 'tests/e2e/note-style-redress.spec.ts'],
  },
  {
    id: 'M2',
    summary: 'Annotated-reading export renders a clipped source body\'s HTML live',
    fixedBy: 2558,
    fixture: 'writeClippedScriptSourceThoughtbase',
    tests: ['tests/security/clipped-source-export.test.ts', 'tests/main/publish/annotated-reading.test.ts'],
  },
  {
    id: 'M3',
    summary: 'Login-window partitions grant every permission',
    fixedBy: 2559,
    fixture: null,
    noFixture: 'The page that asks for the permission is a website in a login window, not a thoughtbase file.',
    tests: ['tests/main/security.test.ts', 'tests/e2e/session-permissions.spec.ts'],
  },
  {
    id: 'M4',
    summary: 'The Python kernel inherits main\'s whole environment (API keys from the login shell)',
    fixedBy: 2560,
    fixture: null,
    noFixture: 'What leaks is main\'s process environment. The tests plant canary variables in it instead.',
    tests: ['tests/main/compute/python-kernel-env-leak.test.ts', 'tests/main/subprocess-env.test.ts'],
  },
  {
    id: 'M5',
    summary: 'RunAsNode plus disable-library-validation let local code run as Minerva',
    fixedBy: 2566,
    fixture: null,
    noFixture: 'A property of the signed app bundle and its fuses, not of any thoughtbase.',
    tests: ['tests/architecture/electron-fuses.test.ts'],
  },
  {
    id: 'M6',
    summary: 'A file dropped outside the editor navigates the window to it',
    fixedBy: 2554,
    fixture: null,
    noFixture: 'The file arrives by drag and drop from anywhere on disk. The tests build the drop events directly.',
    tests: ['tests/renderer/app/navigation-guard.test.ts', 'tests/e2e/navigation-guard.spec.ts'],
  },
];
