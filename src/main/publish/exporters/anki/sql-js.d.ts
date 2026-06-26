/**
 * Type shim for sql.js (#853 Anki .apkg writer).
 *
 * sql.js ships without @types; we touch only the slice the apkg builder needs —
 * `initSqlJs({ wasmBinary })` → a `Database` we can `run` / `prepare` / `export`.
 */
declare module 'sql.js' {
  export interface SqlJsStatement {
    run(params?: unknown[]): void;
    free(): void;
  }
  export interface SqlJsDatabase {
    run(sql: string, params?: unknown[]): void;
    prepare(sql: string): SqlJsStatement;
    export(): Uint8Array;
    close(): void;
  }
  export interface SqlJsStatic {
    Database: new () => SqlJsDatabase;
  }
  const initSqlJs: (config: { wasmBinary: Uint8Array }) => Promise<SqlJsStatic>;
  export default initSqlJs;
}
