/**
 * The `minerva` CLI's commands (#1440) — `src/cli/run.ts` dispatches each.
 *
 * Also how the app's own binary knows it was started as the CLI without the
 * `--minerva-cli` flag: Linux packages put that binary on PATH as `minerva`,
 * so `minerva sql …` from a shell reaches it directly, and `main/cli-mode.ts`
 * runs the CLI when the first argument is one of these. An app launch never
 * has a bare command word there — it has nothing, a file path, or switches.
 * `tests/main/cli-mode.test.ts` holds this list to run.ts's dispatch.
 */
export const CLI_COMMANDS = [
  'query', 'sql', 'search', 'grep', 'semantic', 'read', 'context', 'propose-note',
  'mcp', 'plugin', 'eval',
] as const;

export type CliCommand = (typeof CLI_COMMANDS)[number];

export function isCliCommand(word: string | undefined): word is CliCommand {
  return word !== undefined && (CLI_COMMANDS as readonly string[]).includes(word);
}
