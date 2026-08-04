declare module "sql.js/dist/sql-wasm.js" {
  import type { BindParams, Database, SqlJsStatic } from "sql.js";

  export type { BindParams, Database, SqlJsStatic };

  export interface InitSqlJsConfig {
    locateFile?: (file: string) => string;
    wasmBinary?: ArrayLike<number> | Buffer;
  }

  export default function initSqlJs(config?: InitSqlJsConfig): Promise<SqlJsStatic>;
}

declare module "sql.js" {
  export interface SqlJsStatic {
    Database: new (data?: ArrayLike<number> | Buffer | null) => Database;
  }

  export interface Database {
    close(): void;
    prepare(sql: string): Statement;
  }

  export interface Statement {
    bind(values?: BindParams): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    free(): boolean;
  }

  export type BindParams = readonly unknown[] | Record<string, unknown>;
}
