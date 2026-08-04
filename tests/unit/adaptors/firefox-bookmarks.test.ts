import { describe, expect, it } from "vitest";
import { mapFirefoxBookmarkToSyncItem } from "@/adaptors/firefox-bookmarks";
import type { FirefoxBookmark } from "@/services/firefox-bookmarks";
import { FIREFOX_BOOKMARKS_SOURCE } from "@/sync/types";

describe("mapFirefoxBookmarkToSyncItem", () => {
  const heading = "## Inbox";

  it("maps guid, title, url, and source", () => {
    const bookmark: FirefoxBookmark = {
      guid: "bookmark-guid-1",
      title: "Example",
      url: "https://example.com",
    };

    const item = mapFirefoxBookmarkToSyncItem(heading)(bookmark);

    expect(item).toEqual({
      source: FIREFOX_BOOKMARKS_SOURCE,
      id: "bookmark-guid-1",
      title: "Example",
      link: "https://example.com",
      heading,
      completed: false,
    });
  });
});
