import { projectContext } from '../../project-context-types';
import * as tables from '../../sources/tables';
import type { NotebaseTool, ToolContext } from './types';

/** describe_tables (#780): list registered DuckDB/CSV tables + their columns. */
async function runDescribeTables(ctx: ToolContext): Promise<{ content: string; isError: boolean }> {
  const list = await tables.listTables(projectContext(ctx.rootPath));
  if (list.length === 0) {
    return {
      content:
        'No CSV tables are registered in this thoughtbase. Add a `.csv` file ' +
        '(optionally with a companion `.md` carrying a `table_name:` override) ' +
        'to create one.',
      isError: false,
    };
  }
  const lines = list.map((t) => {
    const cols = t.columns.length ? t.columns.join(', ') : '(no columns)';
    const rows = `${t.rowCount} row${t.rowCount === 1 ? '' : 's'}`;
    return `- ${t.name} — ${rows}, from ${t.relativePath}\n    columns: ${cols}`;
  });
  return {
    content:
      'Registered DuckDB tables (query with query_sql or a ```sql cell):\n\n' +
      lines.join('\n'),
    isError: false,
  };
}

export const describeTables: NotebaseTool = {
  definition: {
    name: 'describe_tables',
    description:
      'List the CSV-backed tables registered in DuckDB, with each table\'s ' +
      'columns and row count. This is the SQL counterpart to ' +
      'describe_graph_schema. Call it before writing a `query_sql` query (or ' +
      'a ```sql compute cell) when you are unsure what tables exist or what ' +
      'columns they have. Returns "no tables" when the thoughtbase has no ' +
      'CSV files registered.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
  run: (ctx) => runDescribeTables(ctx),
};
