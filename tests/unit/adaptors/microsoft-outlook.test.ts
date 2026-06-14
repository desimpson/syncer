import { describe, it, expect } from "vitest";
import { mapOutlookMessageToSyncItem } from "@/adaptors/microsoft-outlook";
import type { OutlookFlaggedMessage } from "@/services/outlook-mail";
import { MICROSOFT_OUTLOOK_SOURCE } from "@/sync/types";

describe("mapOutlookMessageToSyncItem", () => {
  const heading = "## Inbox";

  it("maps subject, sender, link, and id", () => {
    // Arrange
    const message: OutlookFlaggedMessage = {
      id: "msg-1",
      subject: "Hello",
      webLink: "https://outlook.office.com/mail/msg-1",
      from: { emailAddress: { name: "Ada", address: "ada@example.com" } },
    };

    // Act
    const item = mapOutlookMessageToSyncItem(heading)(message);

    // Assert
    expect(item).toEqual({
      source: MICROSOFT_OUTLOOK_SOURCE,
      id: "msg-1",
      title: "Hello (Ada)",
      link: "https://outlook.office.com/mail/msg-1",
      heading,
      completed: false,
    });
  });

  it("uses address when name is missing", () => {
    // Arrange
    const message: OutlookFlaggedMessage = {
      id: "msg-2",
      subject: "Ping",
      webLink: "https://outlook.office.com/mail/msg-2",
      from: { emailAddress: { address: "bob@example.com" } },
    };

    // Act
    const item = mapOutlookMessageToSyncItem(heading)(message);

    // Assert
    expect(item.title).toBe("Ping (bob@example.com)");
  });

  it("falls back when subject and webLink are missing", () => {
    // Arrange
    const message: OutlookFlaggedMessage = {
      id: "msg-3",
      subject: undefined,
      webLink: undefined,
      from: undefined,
    };

    // Act
    const item = mapOutlookMessageToSyncItem(heading)(message);

    // Assert
    expect(item.title).toBe("(No subject) (Unknown sender)");
    expect(item.link).toBe("https://outlook.office.com/mail/");
  });
});
