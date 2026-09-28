import { projectContext } from '../../project-context-types';
import * as tables from '../../sources/tables';
import { coerceDuckBigInt } from '../../compute/duck-values';
import type { NotebaseTool, ToolContext } from './types';

// A cheap first pass. The real gate is `tables.checkModelSql` (#2442), which
// parses the statement with DuckDB and admits only registered relations.
const SQL_READONLY_FIRST_WORDS = new Set([
  'SELECT', 'WITH', 'DESCRIBE', 'SHOW', 'SUMMARIZE', 'TABLE', 'FROM', 'VALUES',
]);
const QUERY_SQL_ROW_CAP = 200;

/**
 * JSON.stringify replacer that survives DuckDB's integer columns. The node-api
 * returns BIGINT/HUGEINT (and COUNT(*), which SUMMARIZE is full of) as JS
 * `bigint`, which plain JSON.stringify refuses to serialize ("Do not know how to
 * serialize a BigInt"). `coerceDuckBigInt` renders it as a real number when it
 * fits in a double without precision loss, else as a string so a 19-digit id
 * isn't silently rounded. (Date columns are already handled — Date.toJSON emits
 * ISO before the replacer sees them.)
 */
function bigintSafeReplacer(_key: string, value: unknown): unknown {
  return typeof value === 'bigint' ? coerceDuckBigInt(value) : value;
}

/** query_sql (#781): immediate read-only SQL over the project's DuckDB. */
async function runQuerySql(ctx: ToolContext, input: unknown): Promise<{ content: string; isError: boolean }> {
  const { sql } = input as { sql: string };
  if (typeof sql !== 'string' || !sql.trim()) {
    throw new Error('sql is required');
  }
  // Read-only gate: single statement whose leading keyword is a query form.
  // CSV tables are a read surface; mutations go through propose_compute.
  const trimmed = sql.trim().replace(/;\s*$/, '');
  if (/;/.test(trimmed)) {
    return {
      content: 'query_sql runs one statement at a time — remove the extra `;`-separated statements.',
      isError: true,
    };
  }
  const firstWord = trimmed.match(/^\s*(\w+)/)?.[1]?.toUpperCase();
  if (!firstWord || !SQL_READONLY_FIRST_WORDS.has(firstWord)) {
    return {
      content:
        'query_sql is read-only — start with SELECT / WITH / FROM / DESCRIBE / SHOW / SUMMARIZE. ' +
        'Use propose_compute to propose a cell for anything that modifies state.',
      isError: true,
    };
  }
  const pctx = projectContext(ctx.rootPath);
  // Only registered tables/views, never a file — `.minerva/` is inside the
  // root the DuckDB lockdown allows (#2442). See sources/llm-sql-guard.ts.
  const verdict = await tables.checkModelSql(pctx, trimmed);
  if (!verdict.ok) return { content: verdict.reason, isError: true };
  const response = await tables.runQuery(pctx, trimmed);
  if (!response.ok) {
    return {
      content: `SQL error: ${response.error}\n\nCall describe_tables to see available tables and columns.`,
      isError: true,
    };
  }
  if (response.rows.length === 0) {
    return { content: 'No rows.', isError: false };
  }
  const shown = response.rows.slice(0, QUERY_SQL_ROW_CAP);
  const body = JSON.stringify(shown, bigintSafeReplacer, 2);
  const note =
    response.rows.length > QUERY_SQL_ROW_CAP
      ? `\n\n(${response.rows.length} rows total; showing the first ${QUERY_SQL_ROW_CAP}. Add LIMIT or aggregate to narrow.)`
      : '';
  return { content: body + note, isError: false };
}

export const querySql: NotebaseTool = {
  definition: {
    name: 'query_sql',
    description:
      'Run a read-only SQL query against the thoughtbase\'s DuckDB and get ' +
      'the rows back. Use this to actually inspect CSV table data (count, ' +
      'filter, join, aggregate) and reason over the result. This is the SQL ' +
      'counterpart to query_graph. Read-only: only SELECT / WITH / FROM / ' +
      'DESCRIBE / SUMMARIZE / SHOW TABLES queries run, one statement at a ' +
      'time, over the registered tables and views (plus range() / ' +
      'generate_series() / unnest()) — file functions like read_csv are not ' +
      'available here. If ' +
      'you are unsure about table or column names, call describe_tables ' +
      'first. (Use propose_compute instead when the user should review and ' +
      'keep the query as a cell.)',
    input_schema: {
      type: 'object',
      properties: {
        sql: {
          type: 'string',
          description: 'A read-only SQL query (SELECT / WITH / DESCRIBE / SHOW / …).',
        },
      },
      required: ['sql'],
    },
  },
  run: (ctx, input) => runQuerySql(ctx, input),
};
