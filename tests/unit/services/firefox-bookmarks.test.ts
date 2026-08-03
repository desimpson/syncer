import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "sql.js";
import {
  FIREFOX_TAGS_ROOT_GUID,
  listPlacesHotCopyRelativeNames,
  resolveFirefoxTagsRootId,
} from "@/services/firefox-bookmarks";
import { loadSqlJs, resetSqlJsForTests } from "@/services/sql-js-loader";

vi.mock("@/utils/desktop-fs", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- Vitest importOriginal typing
  const actual = await importOriginal<typeof import("@/utils/desktop-fs")>();
  return {
    ...actual,
    getDesktopNodeModules: () => ({
      fs,
      path,
      os,
    }),
  };
});

const runSql = (database: Database, sql: string, parameters?: readonly unknown[]): void => {
  const statement = database.prepare(sql);
  try {
    if (parameters !== undefined) {
      statement.bind(parameters);
    }
    statement.step();
  } finally {
    statement.free();
  }
};

describe("listPlacesHotCopyRelativeNames", () => {
  it("never includes places.sqlite-shm (Firefox live WAL index)", () => {
    expect(listPlacesHotCopyRelativeNames(false)).toEqual(["places.sqlite"]);
    expect(listPlacesHotCopyRelativeNames(true)).toEqual(["places.sqlite", "places.sqlite-wal"]);
    expect(listPlacesHotCopyRelativeNames(true)).not.toContain("places.sqlite-shm");
    expect(listPlacesHotCopyRelativeNames(false)).not.toContain("places.sqlite-shm");
  });
});

describe("resolveFirefoxTagsRootId", () => {
  beforeEach(() => {
    resetSqlJsForTests();
  });

  it("finds the tags root without moz_bookmarks_roots (modern Places schema)", async () => {
    const SQL = await loadSqlJs(path.join(process.cwd()));
    const database = new SQL.Database();
    runSql(
      database,
      `
      CREATE TABLE moz_bookmarks (
        id INTEGER PRIMARY KEY,
        guid TEXT NOT NULL,
        parent INTEGER,
        type INTEGER,
        fk INTEGER,
        title TEXT
      )
    `,
    );
    runSql(
      database,
      `INSERT INTO moz_bookmarks (id, guid, parent, type, fk, title) VALUES
        (1, 'root________', 0, 2, NULL, ''),
        (4, ?, 1, 2, NULL, 'tags')`,
      [FIREFOX_TAGS_ROOT_GUID],
    );

    expect(resolveFirefoxTagsRootId(database)).toBe(4);
    database.close();
  });
});
