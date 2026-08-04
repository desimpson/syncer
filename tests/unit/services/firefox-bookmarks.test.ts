import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIREFOX_TAGS_ROOT_GUID,
  listPlacesHotCopyRelativeNames,
  resolveFirefoxTagsRootId,
} from "@/services/firefox-bookmarks";
import { resetSqlJsForTests } from "@/services/sql-js-loader";

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

  it("finds the tags root without moz_bookmarks_roots (modern Places schema)", () => {
    let boundGuid: string | undefined;
    let stepped = false;
    const database = {
      prepare: () => ({
        bind: (values?: readonly unknown[]) => {
          boundGuid = typeof values?.[0] === "string" ? values[0] : undefined;
          return true;
        },
        step: () => {
          if (stepped) {
            return false;
          }
          stepped = true;
          return boundGuid === FIREFOX_TAGS_ROOT_GUID;
        },
        getAsObject: () => ({ id: 4 }),
        free: () => true,
      }),
    };

    expect(resolveFirefoxTagsRootId(database as never)).toBe(4);
  });
});
