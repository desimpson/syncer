import { describe, it, expect } from "vitest";
import { mapGmailMessageToSyncItem, parseGmailFromHeader } from "@/adaptors/gmail-starred";
import type { GmailStarredMessage } from "@/services/gmail-starred";
import { GMAIL_STARRED_SOURCE } from "@/sync/types";

describe("parseGmailFromHeader", () => {
  it("uses display name from angle-bracket format", () => {
    expect(parseGmailFromHeader('"Ada Lovelace" <ada@example.com>')).toBe("Ada Lovelace");
  });

  it("uses email when display name is empty", () => {
    expect(parseGmailFromHeader("<bob@example.com>")).toBe("bob@example.com");
  });

  it("returns bare email unchanged", () => {
    expect(parseGmailFromHeader("bob@example.com")).toBe("bob@example.com");
  });

  it("falls back to Unknown sender when missing", () => {
    expect(parseGmailFromHeader(undefined)).toBe("Unknown sender");
    expect(parseGmailFromHeader("   ")).toBe("Unknown sender");
  });
});

const makeMessage = (overrides: Partial<GmailStarredMessage> = {}): GmailStarredMessage => ({
  id: "msg-1",
  threadId: "thread-abc",
  internalDate: "123",
  payload: {
    headers: [
      { name: "Subject", value: "Hello" },
      { name: "From", value: "Ada Lovelace <ada@example.com>" },
    ],
  },
  ...overrides,
});

describe("mapGmailMessageToSyncItem", () => {
  const heading = "## Inbox";

  it("maps subject, sender, link, and id", () => {
    const item = mapGmailMessageToSyncItem(heading)(makeMessage());

    expect(item).toEqual({
      source: GMAIL_STARRED_SOURCE,
      id: "msg-1",
      title: "Hello (Ada Lovelace)",
      link: "https://mail.google.com/mail/u/0/#all/thread-abc",
      heading,
      completed: false,
    });
  });

  it("falls back when subject and from are missing", () => {
    const item = mapGmailMessageToSyncItem(heading)(
      makeMessage({ payload: { headers: [] }, threadId: undefined }),
    );

    expect(item.title).toBe("(No subject) (Unknown sender)");
    expect(item.link).toBe("https://mail.google.com/mail/u/0/#all");
  });
});
